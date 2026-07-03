<script lang="ts">
	import { base } from '$app/paths';
	// Inventory truth is the .svx tool tree at src/content/tools/**, globbed
	// at build time by $lib/data/cells.ts and shared with the printable
	// /cell-sheets route and the /wants gap list, so the web page, the
	// pinned-to-a-board sheet, and the wants list can never drift apart.
	// Inventory doctrine + the transfemme-tailoring citation-table pointer
	// live in the cells.ts header. Validate the tree with `just tools-validate`.
	//
	// This page is the capability CATALOG: each tool cell is presented as a
	// capability (what it puts in your hands + how it rides the bus + the
	// safety gate before use), then the kitted tools underneath. The catalog is
	// driven entirely by the shared cells data source — no per-tool data was
	// invented for the capability framing; the safety gate is the project-wide
	// orientation model (see /safety, /access).
	import { cells } from '$lib/data/cells';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
</script>

<svelte:head>
	<title>Tools on the bus — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="The tool bus capability catalog: each cell is a kitted capability — what it puts in your hands, how it rides the bus, and the safety gate before use."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Tools on the bus"
		lead="A capability catalog. The bus is organized into cells — each cell is a capability: a kitted set of tools that puts a specific kind of work in your hands. Every tool is kitted for transport, its bits marked as part of a set, and its documentation resolves to a real model number and manufacturer manual — or it is honestly listed as not-yet-resolved."
	/>

	<section class="border-surface-200-800 mt-8 border-y py-6" aria-label="How the catalog works">
		<p class="text-surface-700 dark:text-surface-300 leading-relaxed">
			Each capability below lists what it enables, how the kit rides the bus, and its safety gate. Access is free and
			open once you have completed a short safety orientation for the capability you want to use — see
			<a class="underline" href={`${base}/safety`}>safety &amp; responsible use</a> and
			<a class="underline" href={`${base}/access`}>how access works</a>.
			<!-- OPERATOR-CONFIRM: free-after-safety-orientation access model is a recommended default, not operator-confirmed. -->
		</p>
	</section>

	{#each cells as cell (cell.slug)}
		<section class="mt-12" aria-label={cell.name}>
			<header class="space-y-3">
				<p class="text-surface-500 text-xs tracking-widest uppercase">Capability</p>
				<h2 class="text-2xl font-semibold">{cell.name}</h2>
				<p class="text-surface-700-300 leading-relaxed">
					<span class="font-semibold">Enables:</span>
					{cell.tools.length}
					{cell.tools.length === 1 ? 'tool' : 'tools'} kitted and documented for this kind of work.
					<span class="font-semibold">Rides:</span>
					{cell.travels}
				</p>
				<p class="text-surface-700-300 text-sm leading-relaxed">
					<span class="font-semibold">Safety gate:</span> a short safety orientation for this capability before first
					use, then it is yours to borrow.
					<a class="underline" href={`${base}/safety`}>Read the safety &amp; responsible-use guide</a>.
					<!-- OPERATOR-CONFIRM: per-capability safety-orientation gate is a recommended default, not operator-confirmed. -->
				</p>
			</header>

			<div class="mt-6 space-y-3">
				{#each cell.tools as tool (tool.slug)}
					<Card title={tool.name} headingLevel="h3" compact>
						<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">
							{tool.blurb}
							{#if tool.docUrl}
								<a class="underline" href={tool.docUrl} rel="external noopener">{tool.docLabel}</a>
							{/if}
						</p>
					</Card>
				{/each}
			</div>
		</section>
	{/each}

	<footer class="text-surface-500 pt-12 text-sm">
		Missing a capability? See the <a class="underline" href={`${base}/wants`}>wants list</a> or
		<a class="underline" href={`${base}/donate`}>donate a tool</a>. Want this on paper? Every cell has a
		<a class="underline" href={`${base}/cell-sheets`}>printable cell sheet</a>.
	</footer>
</main>
