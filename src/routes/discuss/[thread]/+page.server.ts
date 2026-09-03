import { env } from '$env/dynamic/private';
import type { DiscussThreadDetail } from '$lib/data/discuss-snapshot';
import { fetchDiscussThread, publicThreadUrl } from '$lib/server/discuss-archive';
import type { PageServerLoad } from './$types';

// On-site thread reader, revived per ruling D15. Mirrors
// src/routes/discuss/+page.server.ts: a SERVER load (the fetch module is
// $lib/server-only) that reads ONE thread from the in-cluster HyperKitty
// archive, honoring the DISCUSS_ARCHIVE_ORIGIN override via
// $env/dynamic/private — so a reader follows a thread fully on-site, never
// dumped into unstyled HyperKitty/Postorius.
//
// NOT PRERENDERED — same serving split as the index (and as every member-tree
// server route, see src/routes/apply/+page.server.ts): the default
// adapter-static build does not emit the route (`strict: false` + 404
// fallback); the production ADAPTER=node origin (ADR 0010 + Amendment 1)
// serves each thread live per request. This supersedes the pre-deletion
// prerender + entries() enumeration: with no static serving lane left to bake
// pages for (ADR 0010 §3), enumerating build-time entries had no remaining
// consumer, so the generator is gone rather than carried as dead weight.
export const prerender = false;

export const load: PageServerLoad = async ({ params, fetch }) => {
	// fetchDiscussThread THROWS on any transport/shape/privacy failure; we swallow
	// it into a calm unavailable state (detail: null) — never a hard 500, never
	// invented content (fail-closed, per the lifecycle spec's privacy posture).
	// The public archive deep link is built from ids we control, so it is safe to
	// surface even when the live read failed.
	const archiveUrl = publicThreadUrl(params.thread);
	try {
		const detail: DiscussThreadDetail = await fetchDiscussThread(params.thread, {
			fetch,
			origin: env.DISCUSS_ARCHIVE_ORIGIN || undefined,
		});
		return { detail, archiveUrl };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(
			`[discuss-archive] thread read for "${params.thread}" failed (${reason}); rendering unavailable state.`,
		);
		return { detail: null, archiveUrl };
	}
};
