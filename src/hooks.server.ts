import type { Handle } from '@sveltejs/kit';

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
export const handle: Handle = async ({ event, resolve }) => {
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
