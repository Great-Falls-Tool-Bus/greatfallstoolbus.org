import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { AuthSession } from '$lib/server/auth';

// Cache-control defaults for the adapter-node production origin (TIN-2543
// on-cluster readiness; ADR 0008/0010). This `handle` hook is a SvelteKit
// server-request seam: it only ever executes at request time under
// `ADAPTER=node` (a real Node process running `node build/index.js`). Under
// the default adapter-static build it still runs once per route during
// prerendering, but the response it produces is written to a static HTML/JSON
// file — headers set here are discarded, not served — so the default `just
// build` stays green and unaffected either way.
//
// SCOPE, READ CAREFULLY: adapter-node's own generated server
// (`@sveltejs/adapter-node/files/handler.js`) chains, in order: (1) a `sirv`
// static-file layer over `build/client` — this is what actually serves every
// `static/**` passthrough asset (`/photos/**`, `/optimized/**`, `/logo/**`,
// `/favicon.svg`, `/og-image.png`, `robots.txt`, `llms.txt`, ...) plus every
// self-hosted @fontsource woff2 (those ARE content-hashed into
// `_app/immutable/assets/**` by Vite, so they already inherit rule (a) below
// for free); then (2) a second sirv layer serving PRERENDERED pages (which is
// nearly the whole site — the root `+layout.ts` sets `prerender = true` and
// only `/discuss` and `/discuss/[thread]` opt out under `ADAPTER=node`); only
// THEN (3) does a request reach this `handle` hook.
//
// Both sirv layers serve a matching file and return before this hook ever
// runs, so this hook CANNOT set headers for static assets or prerendered HTML
// — there is nothing left here to intercept for those paths. What it DOES
// cover: the small set of routes that are genuinely rendered per-request
// (currently `/discuss` + `/discuss/[thread]`, whose `+page.server.ts` flips
// `prerender` off under `ADAPTER=node` specifically so live archive content
// doesn't need a redeploy) and any SSR-rendered fallback/error response. See
// the PR description for the fuller cache-header finding, including why fixing
// the static/prerendered paths needs either Cloudflare edge Cache Rules (the
// planned post-Access-cutover CDN layer) or adapter-node's documented
// "custom server" wrapper — both out of scope for this hook.
// Legacy route redirects (TIN-2536: /access and /find-the-bus folded into
// /contact anchors). These 301s previously lived ONLY in static/_redirects — a
// Cloudflare Pages convention that adapter-node never reads — so on the
// on-cluster production origin the old public URLs 404'd (cross-model audit
// catch, 2026-07-06). Unmatched paths fall through both sirv layers to this
// hook, so redirecting here works under adapter-node; under the default
// adapter-static build these paths have no route and the (now-vestigial)
// _redirects file documents the same mapping.
const LEGACY_REDIRECTS: ReadonlyArray<readonly [RegExp, string]> = [
	[/^\/access(\/.*)?$/, '/contact#access'],
	[/^\/find-the-bus(\/.*)?$/, '/contact#find-the-bus'],
];

// Session resolution (TIN-3817 slice S2). Reads the session cookie and, when
// the runtime is actually configured for auth, resolves it to a live session
// inside `withTenant` — the GUC and the adapter share the transaction's
// connection (spec §1.3 B3, Fix A), so an unset GUC can never quietly read as
// "no session for anyone" in production while tests pass.
//
// THREE GUARDS BEFORE ANY DATABASE WORK, because this hook also runs during
// prerendering under the default adapter-static build (where headers are
// discarded and no database exists) and on the adapter-node origin before
// infra has supplied the runtime references:
//   1. `GFTB_TENANT_ID` set — the one configured tenant's id, a runtime NAME
//      supplied by great-falls-tool-bus-infra (TIN-3817: "one configured GFTB
//      tenant; there is no tenant UI").
//   2. `DATABASE_URL` set — same contract as src/lib/server/db/client.ts.
//   3. A session cookie present — anonymous requests never open a connection
//      (the pool in db/client.ts is lazy; importing it opens nothing).
// Guards 1–2 keep the default `just build` and every unconfigured process
// free of auth work entirely — absence of infra config means "auth disabled",
// not a crash — and guard 3 keeps anonymous traffic off the database.
//
// The imports are dynamic and inside the guarded branch for the same reason:
// the default static build should not pay for (or risk) loading pg + bcrypt
// on every prerendered page when no session can exist.
//
// FAIL-CLOSED, ANONYMOUSLY: a lookup error yields `authSession: null` (and a
// server-side log line), never a thrown 500 on public pages — an attacker who
// can induce a database error must not be able to take the public site down
// with it, and a guard that REQUIRES auth throws its own 401 downstream via
// requireSession rather than trusting this hook's null.
async function resolveAuthSession(event: RequestEvent): Promise<AuthSession | null> {
	const tenantId = process.env.GFTB_TENANT_ID?.trim();
	if (!tenantId || !process.env.DATABASE_URL?.trim()) return null;
	try {
		// Module-cached after the first configured request; never loaded at all
		// on an unconfigured (static/prerender) process.
		const [{ withTenant }, { SESSION_COOKIE, validateSession }] = await Promise.all([
			import('$lib/server/db/tenant'),
			import('$lib/server/auth'),
		]);
		const sessionId = event.cookies.get(SESSION_COOKIE);
		if (!sessionId) return null;
		return await withTenant(tenantId, (tx) => validateSession(tx, tenantId, sessionId));
	} catch (error) {
		console.error('auth: session resolution failed; treating request as anonymous', error);
		return null;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	for (const [pattern, target] of LEGACY_REDIRECTS) {
		if (pattern.test(event.url.pathname)) {
			return new Response(null, { status: 301, headers: { location: target } });
		}
	}

	event.locals.authSession = await resolveAuthSession(event);

	const response = await resolve(event);

	// Respect any cache-control a route already set for itself (e.g. a future
	// `+server.ts` with its own policy) rather than clobbering it.
	if (response.headers.has('cache-control')) {
		return response;
	}

	if (response.headers.get('content-type')?.includes('text/html')) {
		// Short + revalidate-on-every-use: safe for the live `/discuss` archive
		// pages (new posts should never sit behind a stale shared cache) and
		// still lets an in-front CDN (Cloudflare, once Access comes off) do
		// cheap conditional-GET revalidation instead of re-fetching the full
		// body on every hit.
		response.headers.set('cache-control', 'public, max-age=0, must-revalidate');
	}

	return response;
};
