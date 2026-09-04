// Custom adapter-node production entrypoint (TIN-3959).
//
// WHY THIS FILE EXISTS: adapter-node's generated `build/index.js` chains three
// layers before any app code runs (see the SCOPE comment in
// src/hooks.server.ts): a `sirv` static layer over `build/client` (hashed
// `_app/immutable/**` assets — already correctly marked
// `public,max-age=31536000,immutable` by adapter-node itself, see
// node_modules/@sveltejs/adapter-node/files/handler.js `serve(..., true)`),
// then a SECOND `sirv` layer over `build/prerendered` (nearly the whole
// site — every prerendered route, including /, /log/, sitemap.xml,
// robots.txt-shaped un-hashed passthrough files), then SSR for the few
// per-request routes. Both sirv layers respond and return before
// hooks.server.ts's `handle` hook ever runs, so that hook CANNOT fix
// prerendered/static headers — there is nothing left to intercept.
//
// The `build/prerendered` sirv layer is constructed WITHOUT a `maxAge`
// option, so sirv never sets `Cache-Control` at all for prerendered HTML
// (and every other un-hashed static passthrough file under `build/client`
// outside `_app/immutable/`). Combined with the build zeroing file mtimes
// for reproducibility, `Last-Modified` comes out as the Unix epoch
// (`stats.mtime.toUTCString()` on an mtime of 0) — see
// node_modules/sirv/build.js `toHeaders()`. With no Cache-Control and an
// epoch Last-Modified, browsers fall back to RFC 7234 heuristic freshness
// (~10% of now-minus-last-modified), which for an epoch date is decades:
// returning visitors keep serving whatever the browser cached, effectively
// forever, and never revalidate on plain navigation. That is TIN-3959.
//
// sirv's own ETag (`W/"<size>-<mtimeMs>"`, node_modules/sirv/build.js
// `toHeaders()`) degrades to `W/"<size>-0"` once mtimes are zeroed — a real
// validator in name only, since it no longer reflects content, only byte
// size (two different builds that happen to produce a same-size file for a
// given route would collide). It is otherwise unused for revalidation here
// because Cache-Control is entirely absent, so browsers never even send
// `If-None-Match` on a heuristically-fresh hit.
//
// FIX: adapter-node's documented answer for exactly this ("I need to
// customize sirv's headers") is the "custom server" pattern
// (https://svelte.dev/docs/kit/adapter-node#Custom-server): keep the
// generated `handler` middleware completely intact (so file resolution,
// range requests, precompression negotiation, and the already-correct
// immutable-asset rule are untouched) and wrap it with a small server that
// corrects headers for everything the immutable-asset rule does not cover.
//
// Because sirv computes headers per-file at startup and writes them via a
// single synchronous `res.writeHead(code, headers)` call before the body is
// streamed (node_modules/sirv/build.js `send()`), headers cannot be patched
// AFTER that call — by the time a `res.writeHead` wrapper observes the call,
// the values must already be final. So this file:
//
//   1. At boot, walks `build/prerendered` and `build/client` (skipping
//      `_app/immutable/**`, which is already correct) and hashes every
//      real, servable file's bytes (sha256), building a
//      `pathname -> { etag, hash }` index that mirrors sirv's own
//      extension-resolution rules (`.html`/`.htm` implied, `/foo` and
//      `/foo/` both resolving to `foo.html` or `foo/index.html`).
//   2. Per request, resolves the pathname against that index BEFORE calling
//      `handler`. A matching `If-None-Match` short-circuits to a real 304
//      here — sirv's own internal 304 check uses its own weak
//      size+mtime etag, which will never match a content-hash value a
//      client is holding, so this repo's 304s have to be driven from here.
//   3. Wraps `res.writeHead` for the duration of the request so that, if the
//      resolved response is a 200 for an indexed path, `Cache-Control:
//      no-cache` and the real `ETag` get substituted in before the head is
//      actually written. Paths NOT in the index (chiefly
//      `_app/immutable/**`, and the few SSR routes hooks.server.ts already
//      covers) pass through completely unmodified.
//
// This intentionally does not reimplement adapter-node's systemd
// socket-activation / KEEP_ALIVE_TIMEOUT / SHUTDOWN_TIMEOUT / IDLE_TIMEOUT
// support (node_modules/@sveltejs/adapter-node/files/index.js) — none of
// those env vars are referenced anywhere else in this repo or its infra
// intent docs. HOST/PORT and a plain graceful `server.close()` on
// SIGTERM/SIGINT are preserved for the owner-constructed OCI runtime and its
// `/` health check.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handler } from './build/handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, 'build');
const PRERENDERED_DIR = path.join(BUILD_DIR, 'prerendered');
const CLIENT_DIR = path.join(BUILD_DIR, 'client');

// Extensions sirv assumes for extensionless lookups (its own default when no
// `extensions` option is passed — see node_modules/sirv/build.js). Mirrored
// here only to derive the SAME set of request pathnames a given .html file
// can be reached at.
const HTML_EXTENSIONS = ['html', 'htm'];
const PRECOMPRESSED_SUFFIXES = ['.br', '.gz'];

/**
 * Recursively collect real (non-precompressed-sibling) files under `dir`.
 * @param {string} dir
 * @param {(relPath: string) => boolean} skip
 * @returns {string[]} paths relative to `dir`, using `/` separators
 */
function walk(dir, skip) {
	/** @type {string[]} */
	const out = [];
	if (!fs.existsSync(dir)) return out;

	/** @param {string} current */
	function recurse(current) {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const abs = path.join(current, entry.name);
			const rel = path.relative(dir, abs).split(path.sep).join('/');
			if (skip(rel)) continue;
			if (entry.isDirectory()) {
				recurse(abs);
			} else if (entry.isFile()) {
				if (PRECOMPRESSED_SUFFIXES.some((s) => rel.endsWith(s))) continue;
				out.push(rel);
			}
		}
	}

	recurse(dir);
	return out;
}

/**
 * @param {string} absPath
 * @returns {string} a strong, content-hash ETag (quoted, per RFC 9110 §8.8.3)
 */
function hashFile(absPath) {
	const digest = crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
	// 16 hex chars (64 bits) is ample collision resistance for a per-file
	// validator and keeps the header short; full digest would work too.
	return `"${digest.slice(0, 16)}"`;
}

/**
 * Build the pathname -> etag index for the prerendered tree. Every prerendered
 * file is reachable both with and without its `.html`/`.htm` extension, and an
 * `index.html`/`index.htm` file is additionally reachable at its parent
 * directory (with and without a trailing slash) — the same shapes sirv's own
 * `toAssume()` resolves for a request.
 * @returns {Map<string, string>}
 */
function buildPrerenderedIndex() {
	/** @type {Map<string, string>} */
	const index = new Map();
	const files = walk(PRERENDERED_DIR, () => false);

	for (const rel of files) {
		const abs = path.join(PRERENDERED_DIR, rel);
		const etag = hashFile(abs);
		const pathnames = new Set([`/${rel}`]);

		const ext = HTML_EXTENSIONS.find((e) => rel.endsWith(`.${e}`));
		if (ext) {
			const withoutExt = rel.slice(0, -(ext.length + 1));
			if (withoutExt === 'index' || withoutExt.endsWith('/index')) {
				const dir = withoutExt === 'index' ? '' : withoutExt.slice(0, -'/index'.length);
				pathnames.add(`/${dir}`);
				pathnames.add(`/${dir}/`.replace(/\/{2,}/g, '/'));
			} else {
				pathnames.add(`/${withoutExt}`);
			}
		}

		for (const p of pathnames) index.set(p, etag);
	}

	return index;
}

/**
 * Build the pathname -> etag index for un-hashed static passthrough files
 * under build/client (everything except the already-correctly-marked
 * `_app/immutable/**`, e.g. /favicon.svg, /robots.txt, /llms.txt,
 * /photos/**, /optimized/**, /logo/**, self-hosted non-immutable assets).
 * @returns {Map<string, string>}
 */
function buildClientPassthroughIndex() {
	/** @type {Map<string, string>} */
	const index = new Map();
	const files = walk(CLIENT_DIR, (rel) => rel.startsWith('_app/immutable/'));

	for (const rel of files) {
		index.set(`/${rel}`, hashFile(path.join(CLIENT_DIR, rel)));
	}

	return index;
}

const etagIndex = new Map([...buildClientPassthroughIndex(), ...buildPrerenderedIndex()]);

console.log(`[cache-headers] indexed ${etagIndex.size} un-hashed path(s) with content-hash ETags`);

/** @param {string} rawPathname */
function normalisePathname(rawPathname) {
	try {
		return decodeURIComponent(rawPathname);
	} catch {
		return rawPathname;
	}
}

/** @type {import('http').RequestListener} */
function requestListener(req, res) {
	const url = req.url ?? '/';
	const [rawPathname] = url.split(/[?#]/);
	const pathname = normalisePathname(rawPathname);
	const etag = etagIndex.get(pathname);

	if (etag) {
		const inm = req.headers['if-none-match'];
		if (inm === etag) {
			res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
			res.end();
			return;
		}

		// Patch this response's writeHead so that, if it resolves to a 200,
		// the real Cache-Control + ETag land before headers are flushed.
		// (sirv computes/writes headers synchronously in one call — see the
		// file-level comment — so this has to happen inline, not after.)
		const originalWriteHead = res.writeHead.bind(res);
		// @ts-expect-error -- overriding a bound method with a compatible shape
		res.writeHead = (statusCode, statusMessageOrHeaders, maybeHeaders) => {
			if (statusCode === 200) {
				const headers = (typeof statusMessageOrHeaders === 'object' && statusMessageOrHeaders) || maybeHeaders || {};
				headers['Cache-Control'] = 'no-cache';
				headers['ETag'] = etag;
				delete headers['cache-control'];
				delete headers['etag'];
				// sirv also sets Last-Modified from the file's real (Nix-store
				// or OCI-layer, frozen-for-reproducibility) mtime — see the
				// file-level comment. This server never honors an incoming
				// If-Modified-Since itself (neither sirv nor the code above
				// checks that header — only If-None-Match, above, which is
				// content-hash-driven and safe), so a leaked frozen
				// Last-Modified is harmless to any compliant browser talking
				// directly to this process (RFC 9110 §13.1.3: a client with
				// both validators MUST prefer If-None-Match). It is still
				// dropped here rather than trusted to stay harmless forever:
				// a future front-end cache (e.g. Cloudflare, once it sits in
				// front of this origin per the on-cluster serving docs) could
				// implement If-Modified-Since against this exact value on its
				// own terms, and that value never changes across deploys —
				// the identical shape of bug TIN-3959/PR #34 B1 found in
				// gftb-site's Caddy layer, just not reachable through this
				// server's own code path today.
				delete headers['Last-Modified'];
				delete headers['last-modified'];
				if (typeof statusMessageOrHeaders === 'object') {
					return originalWriteHead(statusCode, headers);
				}
				return originalWriteHead(statusCode, statusMessageOrHeaders, headers);
			}
			// @ts-expect-error -- pass-through for non-200s (308 redirects, 4xx, ...)
			return originalWriteHead(statusCode, statusMessageOrHeaders, maybeHeaders);
		};
	}

	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
}

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

const server = http.createServer(requestListener);

server.listen(port, host, () => {
	console.log(`Listening on http://${host}:${port}`);
});

/** @param {NodeJS.Signals} signal */
function gracefulShutdown(signal) {
	console.log(`${signal} received, closing server`);
	server.close(() => process.exit(0));
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
