import { env } from '$env/dynamic/private';
import type { DiscussSnapshot } from '$lib/data/discuss-snapshot';
import { fetchDiscussSnapshot } from '$lib/server/discuss-archive';
import type { PageServerLoad } from './$types';

// /discuss — the on-site index of the public discuss@ community board, revived
// per ruling D15. Server load (not universal): the fetch module is
// $lib/server-only, so the in-cluster origin and raw HyperKitty responses
// never reach a client.
//
// NOT PRERENDERED — the same serving split every member-tree server route uses
// (see src/routes/apply/+page.server.ts). Under the default adapter-static
// build (local dev, CI gates) the route is simply not emitted
// (svelte.config.js sets `strict: false` + a 404 fallback); the production
// ADAPTER=node origin (ADR 0010 + Amendment 1) serves it live per request, so
// new list posts appear without a redeploy. This supersedes the pre-deletion
// adapter-conditional prerender + entries() design: with ADR 0010 ratified,
// the static build is a gate/fallback lane, not a public serving lane, so
// there is nothing left for a baked archive page to serve. Public debut waits
// on platform serving (great-falls-tool-bus-infra #121).
//
// Anonymous read is ratified and live (lifecycle spec
// docs/spec/discuss-board-lifecycle-2026-09-01.md §Public-nav gate, ADR 0019
// §2.2) — no preview/live flag gates this surface anymore; privacy is
// enforced by Mailman archive_policy plus this repo's fail-closed payload
// gates in $lib/server/discuss-archive.
export const prerender = false;

// SINGLE SWAP POINT for the data plane. The canonical type is
// $lib/data/discuss-snapshot's DiscussSnapshot; the fetch module consumes and
// re-exports the same type, so this is one source of truth. On any transport,
// shape, or privacy failure the fetch returns the honest EMPTY snapshot —
// never invented content, never a hard 500.
const loadDiscussSnapshot = async (fetchImpl: typeof fetch): Promise<DiscussSnapshot> =>
	fetchDiscussSnapshot({
		fetch: fetchImpl,
		origin: env.DISCUSS_ARCHIVE_ORIGIN || undefined,
	});

export const load: PageServerLoad = async ({ fetch }) => ({
	snapshot: await loadDiscussSnapshot(fetch),
});
