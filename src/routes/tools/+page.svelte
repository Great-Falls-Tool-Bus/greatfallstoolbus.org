<script lang="ts">
	import { base } from '$app/paths';
	import { Hammer } from '@lucide/svelte';
	// Inventory truth is the .svx tool tree at src/content/tools/**, globbed
	// at build time by $lib/data/cells.ts and shared with the printable
	// /cell-sheets route and the /wants gap list, so the web page, the
	// pinned-to-a-board sheet, and the wants list can never drift apart.
	// Inventory doctrine + the transfemme-tailoring citation-table pointer
	// live in the cells.ts header. Validate the tree with `just tools-validate`.
	//
	// This page LEADS with borrowing: a first-time neighbor sees the flat list
	// of every tool they can borrow and the one-line borrow path, without having
	// to parse the cell / captain / kit vocabulary first. Cells are an optional
	// lens, never a gate (agreed product principle): each row keeps a quiet cell
	// tag that links to that kit's printable cell sheet, so the by-kit / captain
	// view is one click away, and the sheets stay reachable from the footer. The
	// list is driven entirely by the shared cells data source; no per-tool data
	// was invented. The safety orientation + keyholder go-ahead is the
	// project-wide access model (see /safety, /contact#access).
	import { cells } from '$lib/data/cells';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SourceLink from '$lib/components/SourceLink.svelte';
	import DetailsNeeded from '$lib/components/DetailsNeeded.svelte';

	// Flatten the per-cell tree into ONE scannable inventory, sorted by name so
	// the list reads as a flat catalog and not a cell-clustered outline. Each
	// tool keeps its cell name + slug as a secondary tag (the cell lens), which
	// links to that cell's printable sheet.
	const tools = cells
		.flatMap((cell) => cell.tools.map((tool) => ({ ...tool, cellName: cell.name, cellSlug: cell.slug })))
		.sort((a, b) => a.name.localeCompare(b.name));

	const statusLabel: Record<'in-kit' | 'restoration', string> = {
		'in-kit': 'In the kit',
		restoration: 'Under restoration',
	};
</script>

<svelte:head>
	<title>Tools on the bus | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Everything on the tool bus you can borrow: a flat list of every tool, its blurb, and its status. Borrow one with a short safety orientation and a keyholder's go-ahead. Cells are an optional lens."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader title="Tools on the bus" icon={Hammer}>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			Everything here is a tool you can borrow. No membership fee and no paperwork wall: a short safety orientation,
			then a keyholder's go-ahead, and the tool is yours to take.
		</p>
	</PageHeader>

	<section class="border-surface-200-800 mt-8 border-y py-6" aria-label="How to borrow a tool">
		<p class="text-surface-700-300 leading-relaxed">
			To borrow one: read the short
			<a class="underline" href={`${base}/safety`}>safety &amp; responsible-use guide</a>, then
			<a class="underline" href={`${base}/contact#access`}>ask a keyholder for access</a>. Anyone may ask; a keyholder
			reviews each request and shares where to find the bus.
			<!-- Access model (ratified): stewarded access; anyone may request; non-member requests reach all keyholders. -->
		</p>
	</section>

	<section class="mt-12" aria-label="Tools you can borrow">
		<div class="flex items-baseline justify-between gap-4">
			<h2 class="text-2xl font-semibold">Every tool on the bus</h2>
			<p class="text-surface-600-400 shrink-0 text-sm">{tools.length} tools</p>
		</div>

		<ul class="mt-6">
			{#each tools as tool (tool.slug)}
				<li class="border-surface-200-800 border-t py-6">
					<div class="flex items-baseline justify-between gap-x-4">
						<a
							class="text-surface-600-400 hover:text-primary-600 text-sm underline-offset-2 hover:underline"
							href={`${base}/cells/${tool.cellSlug}`}
							aria-label={`${tool.cellName}: open the printable cell sheet`}>{tool.cellName}</a
						>
						<span
							class="shrink-0 text-sm {tool.status === 'restoration'
								? 'text-warning-700 dark:text-warning-400 font-medium'
								: 'text-surface-600-400'}">{statusLabel[tool.status]}</span
						>
					</div>
					<h3 class="mt-1 text-xl font-semibold">{tool.name}</h3>
					<p class="text-surface-700-300 mt-2 leading-relaxed">
						{tool.blurb}
						{#if tool.docUrl}
							<a
								class="underline"
								href={tool.docUrl}
								rel="external noopener"
								aria-label={`Open ${tool.name} documentation: ${tool.docLabel}`}>{tool.docLabel}</a
							>
						{/if}
					</p>
					{#if tool.detailsNeeded}
						<DetailsNeeded wanted={tool.detailsWanted} sourcePath={tool.sourcePath} name={tool.name} />
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		<p>
			Missing a tool? See the <a class="underline" href={`${base}/wants`}>wants list</a> or
			<a class="underline" href={`${base}/donate`}>donate a tool</a>. Prefer to browse by kit and captain? See the
			<a class="underline" href={`${base}/cells`}>tool cells</a>, each with a
			<a class="underline" href={`${base}/cell-sheets`}>printable cell sheet</a>.
		</p>
		<SourceLink routeId="/tools" />
	</footer>
</main>
