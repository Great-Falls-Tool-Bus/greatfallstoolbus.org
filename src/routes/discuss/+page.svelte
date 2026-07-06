<script lang="ts">
	import { base } from '$app/paths';
	import { MessagesSquare } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import DiscussThreads from '$lib/components/DiscussThreads.svelte';
	import { archiveVisible } from '$lib/flags';

	// Snapshot-driven archive index (TIN-2528). The thread data arrives through
	// the universal load in `+page.ts` (fixture today, swapped for a live
	// in-cluster HyperKitty fetch later); this page just renders `data.snapshot`
	// inside the archiveVisible branch. Full bodies stay on the Anubis-gated
	// archive — the rows deep-link out, and the outbound archive link stays below.
	let { data } = $props();
	const snapshot = $derived(data.snapshot);

	// Public community board surface (TIN-2528). This page always exists and
	// always explains what discuss@ is. What it gates on the fail-closed
	// `archiveVisible` predicate is the archive section and its single outbound
	// link to the HyperKitty archive. archiveVisible is on when EITHER gate is
	// set: gated PREVIEW testing inside the Access-gated deploy
	// (PUBLIC_ARCHIVE_PREVIEW) or the reserved PUBLIC go-live (PUBLIC_ARCHIVE_LIVE).
	// While both are false (the default), lists.latoolb.us is not reachable for
	// this audience, so linking to it would 404: the page shows a "coming" note
	// instead, and the "Discuss" nav entry is withheld (see $lib/nav-items).
	//
	// This surface only ever speaks about the PUBLIC discuss@ board. The private
	// keyholder role list and its archive are a separate, closed path and are
	// never linked or named here.
	// This HyperKitty instance serves list archives under /hyperkitty/, not the
	// conventional /archives/ prefix (verified live: /archives/list/... 404s,
	// /hyperkitty/list/... 200s for the public discuss@ board).
	const ARCHIVE_URL = 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/';
	const LIST_ADDRESS = 'discuss@latoolb.us';
</script>

<svelte:head>
	<title>Discuss | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="discuss@latoolb.us is the public community board for the Great Falls Tool Bus: an open place to talk tools, projects, and the bus in Lewiston-Auburn, Maine."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		eyebrow="Community board"
		title="Discuss"
		lead="discuss@latoolb.us is the public board for the Great Falls Tool Bus: an open, readable place for neighbors to talk tools, share projects, and help each other get things done."
		icon={MessagesSquare}
	/>

	<section class="mt-10 leading-relaxed" aria-label="What the board is">
		<h2 class="text-2xl font-semibold">An open place to talk</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4">
			The board is public. Anyone can read it, and once it is open you will be able to browse every thread here without
			an account. It is the place for the everyday back-and-forth of a shared tool library: what to build, how a repair
			went, which tool did the job, and who is up to what around Lewiston-Auburn.
		</p>
		<p class="text-surface-700 dark:text-surface-300 mt-4">
			Borrowing a tool works a little differently, and stays personal. If you want to use the bus, start with
			<a class="underline underline-offset-4" href={`${base}/contact#access`}>how access works</a>: a short safety
			orientation and a keyholder who says yes are the whole gate. The board is for talking; access is for doing, and
			the two live on their own paths.
		</p>
	</section>

	{#if archiveVisible}
		<!-- VISIBLE: gated preview (PUBLIC_ARCHIVE_PREVIEW) or public go-live
		     (PUBLIC_ARCHIVE_LIVE) is set. The archive host is reachable behind its
		     Anubis gate for this audience, so the outbound link is safe to render. -->
		<aside
			class="border-surface-200-800 bg-surface-100-900/70 mt-12 border-y px-6 py-8 backdrop-blur-sm"
			aria-label="Read the archive"
		>
			<h2 class="text-xl font-semibold">Read the board</h2>
			<p class="text-surface-700 dark:text-surface-300 mt-3">
				The full archive is open to read. Recent threads are indexed below — open any one to follow the whole
				conversation, or browse the complete archive.
			</p>

			<DiscussThreads {snapshot} />

			<p class="mt-8">
				<ExternalLink
					href={ARCHIVE_URL}
					class="text-primary-600 hover:text-primary-500 font-semibold underline underline-offset-4"
				>
					Browse the full {LIST_ADDRESS} archive
				</ExternalLink>
			</p>
			<p class="text-surface-500 mt-3 text-sm">
				The archive sits behind a quick browser check that keeps bulk scrapers out. A real browser passes it without
				doing anything.
			</p>
		</aside>
	{:else}
		<!-- DEFAULT / fail-closed: neither archive gate is set. The archive host is
		     not reachable for this audience yet, so we render NO outbound link (it
		     would 404) and say so plainly. Flipping a gate is an operator/deploy
		     step; nothing here needs editing when that happens. -->
		<aside
			class="border-surface-200-800 bg-surface-100-900/70 mt-12 border-y px-6 py-8 backdrop-blur-sm"
			aria-label="Board status"
		>
			<p class="text-surface-500 text-xs tracking-widest uppercase">Coming soon</p>
			<h2 class="mt-2 text-xl font-semibold">The board is not open yet</h2>
			<p class="text-surface-700 dark:text-surface-300 mt-3">
				We are still setting up the public board, so there is nothing to read here today. When it is ready, this page
				will link straight to the archive so you can browse every thread. Check back soon.
			</p>
			<p class="text-surface-700 dark:text-surface-300 mt-4">
				In the meantime, the best way to reach a person is on
				<a class="underline underline-offset-4" href={`${base}/contact`}>the contact page</a>.
			</p>
		</aside>
	{/if}

	<footer class="text-surface-500 pt-12 text-sm">
		A public board for a shared tool library. Be kind, be useful, and help a neighbor build something.
	</footer>
</main>
