<script lang="ts">
	import { base } from '$app/paths';
	import { MessagesSquare } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import DiscussThreads from '$lib/components/DiscussThreads.svelte';
	import { archiveVisible } from '$lib/flags';

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
		content="discuss@latoolb.us is the public HyperKitty board for the Great Falls Tool Bus: an open place to talk tools, projects, and the bus in Lewiston-Auburn, Maine."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		eyebrow="Community board"
		title="Discuss"
		lead="discuss@latoolb.us is the public HyperKitty board for the Great Falls Tool Bus."
		icon={MessagesSquare}
	/>

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
				The full archive is open to read. Recent threads are below.
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
				A quick browser check keeps bulk scrapers out; a real browser passes it automatically.
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
				We are still setting it up. When it is ready, this page links straight to the archive. Check back soon.
			</p>
			<p class="text-surface-700 dark:text-surface-300 mt-4">
				To reach a person now, use
				<a class="underline underline-offset-4" href={`${base}/contact`}>the contact page</a>.
			</p>
		</aside>
	{/if}

	<footer class="text-surface-500 pt-12 text-sm">Be kind, be useful, and help a neighbor build something.</footer>
</main>
