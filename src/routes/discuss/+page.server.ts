import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import type { DiscussSnapshot } from '$lib/data/discuss-snapshot';
import { fetchDiscussSnapshot } from '$lib/server/discuss-archive';

// Server load (not universal): the fetch module is $lib/server-only, so this
// wiring lives in +page.server.ts. With prerender=true the fetch runs at BUILD
// time — the tinyland-nix builder is in-cluster and reaches the HyperKitty web
// tier directly (netpol: great-falls-tool-bus-infra #61), so every deploy bakes
// a fresh REAL thread index. Off-cluster builds (local dev, forks) fall back to
// the module's default EMPTY snapshot with a loud console warning — the page
// renders its honest empty state, never invented content. Post-cutover
// (TIN-2543, adapter-node) flipping prerender off makes this a per-request live
// fetch with zero further changes — that flip is a deliberate operator step.
export const prerender = true;

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
