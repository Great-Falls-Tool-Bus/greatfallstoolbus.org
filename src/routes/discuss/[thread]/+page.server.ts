import { env } from '$env/dynamic/private';
import type { DiscussThreadDetail } from '$lib/data/discuss-snapshot';
import { fetchDiscussSnapshot, fetchDiscussThread, publicThreadUrl } from '$lib/server/discuss-archive';
import type { EntryGenerator, PageServerLoad } from './$types';

// On-site thread reader (TIN-2528). Mirrors src/routes/discuss/+page.server.ts:
// a SERVER load (the fetch module is $lib/server-only) that reads ONE thread from
// the in-cluster HyperKitty archive, honoring the DISCUSS_ARCHIVE_ORIGIN override
// via $env/dynamic/private — so a reader follows a thread fully on-site, never
// dumped into unstyled HyperKitty/Postorius.
//
// PRERENDER + ENTRIES. With prerender=true adapter-static bakes one static page
// per live thread at build. `entries` enumerates those threads from the SAME
// snapshot the index renders: on-cluster it yields every current thread id; OFF
// cluster the snapshot fetch fails soft to an EMPTY snapshot (fetchDiscussSnapshot
// never throws), so entries yields [] and the route simply prerenders no pages —
// the build MUST NOT fail off-cluster. Post-cutover (adapter-node) flipping
// prerender off makes this a live per-request read with no other change.
// Adapter-conditional like the index (TIN-2559): live per-request reads under
// the ADAPTER=node production image; prerendered thread pages (via entries())
// under the default adapter-static build. entries() is only consulted when
// prerendering, so it needs no guard of its own.
export const prerender = process.env.ADAPTER !== 'node';

export const entries: EntryGenerator = async () => {
	const snapshot = await fetchDiscussSnapshot({ origin: env.DISCUSS_ARCHIVE_ORIGIN || undefined });
	return snapshot.threads.map((thread) => ({ thread: thread.threadId }));
};

export const load: PageServerLoad = async ({ params, fetch }) => {
	// fetchDiscussThread THROWS on any transport/shape/privacy failure; we swallow
	// it into a calm unavailable state (detail: null) — never a hard 500, never
	// invented content. The public archive deep link is built from ids we control,
	// so it is safe to surface even when the live read failed.
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
