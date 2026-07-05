<script lang="ts">
	import { base } from '$app/paths';
	import { MessagesSquare } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import { publicArchiveLive } from '$lib/flags';

	// Public community board surface (TIN-2528). This page always exists and
	// always explains what discuss@ is. What it gates on the fail-closed
	// PUBLIC_ARCHIVE_LIVE flag is the single outbound link to the live HyperKitty
	// archive: while the flag is false (the default), lists.latoolb.us is not open
	// yet, so linking to it would 404. So the page shows a "coming" note instead,
	// and the "Discuss" nav entry is withheld (see $lib/nav-items).
	//
	// This surface only ever speaks about the PUBLIC discuss@ board. The private
	// keyholder role list and its archive are a separate, closed path and are
	// never linked or named here.
	const ARCHIVE_URL = 'https://lists.latoolb.us/archives/list/discuss@latoolb.us/';
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

	{#if publicArchiveLive}
		<!-- LIVE: the operator has flipped PUBLIC_ARCHIVE_LIVE. The archive host is
		     open behind its Anubis gate, so the outbound link is safe to render. -->
		<aside
			class="border-surface-200-800 bg-surface-100-900/70 mt-12 border-y px-6 py-8 backdrop-blur-sm"
			aria-label="Read the archive"
		>
			<h2 class="text-xl font-semibold">Read the board</h2>
			<p class="text-surface-700 dark:text-surface-300 mt-3">
				The full archive is open to read. Browse threads, follow a conversation, and catch up on what the community is
				talking about.
			</p>
			<p class="mt-5">
				<ExternalLink
					href={ARCHIVE_URL}
					class="text-primary-600 hover:text-primary-500 font-semibold underline underline-offset-4"
				>
					Read the {LIST_ADDRESS} archive
				</ExternalLink>
			</p>
			<p class="text-surface-500 mt-3 text-sm">
				The archive sits behind a quick browser check that keeps bulk scrapers out. A real browser passes it without
				doing anything.
			</p>
		</aside>
	{:else}
		<!-- DEFAULT / fail-closed: PUBLIC_ARCHIVE_LIVE is off. The archive host is
		     not open yet, so we render NO outbound link (it would 404) and say so
		     plainly. Flipping the flag is an operator step gated on a go-live
		     checklist; nothing here needs editing when that happens. -->
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
