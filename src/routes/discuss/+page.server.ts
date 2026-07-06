import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import type { DiscussSnapshot } from '$lib/data/discuss-snapshot';
import { fetchDiscussSnapshot } from '$lib/server/discuss-archive';

// Server load (not universal): the fetch module is $lib/server-only, so this
// wiring lives in +page.server.ts.
//
// PRERENDER IS ADAPTER-CONDITIONAL (TIN-2559, the post-cutover flip). Under
// the ADAPTER=node production image the route is NOT prerendered: adapter-node
// serves it per-request, so the in-cluster fetch runs live and new list posts
// appear without a redeploy (the netpol allowance for the site namespace,
// great-falls-tool-bus-infra #61, is what makes the request-time read work).
// Under the default adapter-static build (local dev, CI gates) prerender stays
// on — adapter-static requires prerenderable routes — and off-cluster builds
// fall back to the module's default EMPTY snapshot with a loud warning: honest
// empty state, never invented content. ADAPTER is the same build-time switch
// svelte.config.js keys the adapter choice on.
export const prerender = process.env.ADAPTER !== 'node';

// SINGLE SWAP POINT, now wired to the real data plane (supersedes the fixture
// inline load and the earlier committed-snapshot-JSON pipeline plan). The
// canonical type is $lib/data/discuss-snapshot's DiscussSnapshot; the fetch
// module consumes and re-exports the same type, so this is one source of truth.
const loadDiscussSnapshot = async (fetchImpl: typeof fetch): Promise<DiscussSnapshot> =>
	fetchDiscussSnapshot({
		fetch: fetchImpl,
		origin: env.DISCUSS_ARCHIVE_ORIGIN || undefined,
	});

export const load: PageServerLoad = async ({ fetch }) => ({
	snapshot: await loadDiscussSnapshot(fetch),
});
