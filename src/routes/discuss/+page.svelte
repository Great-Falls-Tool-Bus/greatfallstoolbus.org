<script lang="ts">
	import { MessagesSquare } from '@lucide/svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import DiscussThreads from '$lib/components/DiscussThreads.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const snapshot = $derived(data.snapshot);

	// Public community board surface, revived per ruling D15. Authority:
	// docs/spec/discuss-board-lifecycle-2026-09-01.md.
	//
	// The pre-deletion PUBLIC_ARCHIVE_PREVIEW / PUBLIC_ARCHIVE_LIVE flag gate and
	// its "coming soon" branch are DROPPED: the merged spec records anonymous
	// read as ratified AND empirically live (spec §Public-nav gate — the list
	// page returns 200 to an anonymous reader; Anubis is anti-scrape, not
	// authentication). Route availability is now governed by serving instead:
	// this page only exists where the ADAPTER=node origin serves it (see
	// +page.server.ts), so there is no audience that can reach this page while
	// the archive host is unlinkable.
	//
	// This surface only ever speaks about the PUBLIC discuss@ board. The private
	// keyholder role list and its archive are a separate, closed path and are
	// never linked or named here (spec §Public-nav gate; leak-scan rule
	// `private-list-archive`).
	//
	// Archive URL + list address are read from the privacy-validated snapshot
	// (the server data plane pins both constants and gates every payload on
	// them) instead of re-declaring literals here.
</script>

<svelte:head>
	<title>Discuss | Great Falls Tool Bus</title>
	<meta
		name="description"
		content={`${snapshot.list} is the public HyperKitty board for the Great Falls Tool Bus: an open place to talk tools, projects, and the bus in Lewiston-Auburn, Maine.`}
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<header class="space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">Community board</p>
		<h1 class="flex items-start gap-3 text-3xl leading-tight font-bold sm:text-4xl">
			<MessagesSquare class="text-primary-500 mt-1 h-7 w-7 shrink-0" aria-hidden="true" />
			<span>Discuss</span>
		</h1>
		<p class="text-surface-700-300 text-lg leading-relaxed">
			{snapshot.list} is the public HyperKitty board for the Great Falls Tool Bus.
		</p>
		<!-- Disclosure duty (spec §Public-nav gate, ADR 0014 §0.5): the
		     read-is-free / write-requires-membership distinction, worded so it
		     promises only that POSTING rights come with membership — never that
		     subscription itself is members-only (spec §Open divergence). -->
		<p class="text-surface-600-400">
			Anyone can read the board — no account needed. Posting rights come with membership.
		</p>
	</header>

	<section
		class="border-surface-200-800 bg-surface-100-900/70 mt-12 border-y px-6 py-8 backdrop-blur-sm"
		aria-label="Read the board"
	>
		<h2 class="text-xl font-semibold">Recent conversations</h2>

		<DiscussThreads {snapshot} />

		<p class="mt-8">
			<ExternalLink
				href={snapshot.archiveUrl}
				class="text-primary-600 hover:text-primary-500 font-semibold underline underline-offset-4"
			>
				Browse the full {snapshot.list} archive
			</ExternalLink>
		</p>
		<!-- Caption re-derived from spec §Public-nav gate: the discuss read path
		     (list overview, thread permalinks, static assets) is EXEMPT from the
		     archive host's anti-scrape challenge (TIN-2559), so this link opens
		     directly — the copy must not claim a browser check gates it. -->
		<p class="text-surface-500 mt-3 text-sm">
			The archive opens directly — reading is public and anonymous, with nothing to pass first.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">Be kind, be useful, and help a neighbor build something.</footer>
</main>
