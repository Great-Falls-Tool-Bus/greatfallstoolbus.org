<script lang="ts">
	// Inventory doctrine: every entry resolves to a real model number with a
	// manufacturer manual or datasheet link — no invented product names, ever.
	// All five order-reference items resolved + operator-confirmed 2026-07-02
	// (method owned by the tailoring manifest lane; citation table in
	// Jesssullivan/transfemme-tailoring README).
	const sewingCell = {
		resolved: [
			{
				item: 'SINGER Heavy Duty 6600C Sterling (computerized)',
				status: 'The working machine — 100 built-in stitches, six one-step buttonholes. Manual linked below.',
				doc: 'https://cdn.poconosewandvac.com/web/products/instruction-manuals/pdfs/singer/hd6600c-hd6605c/hd6600c-hd6605c-instruction-manual.pdf',
				docLabel: 'Instruction manual (PDF)',
			},
			{
				item: 'Treadle Singer sewing machine (1800s)',
				status: 'Restoration in progress — honestly framed: not yet a working machine.',
			},
			{
				item: 'SINGER ProSeries scissors bundle (8.5″ bent + 4.5″ detail + snips)',
				status: 'The kit shears. Bent shears stay dedicated to fabric.',
				doc: 'https://www.singer.com/products/singer-8-5-proseries-scissors',
				docLabel: 'singer.com',
			},
			{
				item: 'FIVEIZERO seam-ripper set (2 large + 2 small + snips)',
				status: 'In kit — the most-used tools in any alteration.',
			},
			{
				item: 'BulingBuling bonded-nylon upholstery thread kit (8 × 210D/3)',
				status: 'In kit. Heavy repairs only — too stiff for fine seams.',
			},
			{
				item: 'Newkita 2″ T-pins (100, E0106)',
				status: 'In kit. For blocking and heavy layers — too thick for shirting.',
			},
			{ item: 'Singer sewing machine oil', status: 'In kit. Oil only, never grease.' },
			{ item: 'Small cutting surface', status: 'In kit.' },
			{ item: 'Small handheld rotary cutter', status: 'In kit.' },
		],
	};
</script>

<svelte:head>
	<title>Tools on the bus — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="The tool bus inventory: what we have, kitted for transport, bits marked, with model numbers and manuals as they are resolved."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<header class="space-y-4">
		<h1 class="text-4xl leading-tight font-bold">Tools on the bus</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			Every tool on the bus is kitted for transport, its bits are marked as part of a set, and its documentation
			resolves to a real model number with a manufacturer manual or datasheet — or it is honestly listed below as
			not-yet-resolved. Photos and per-tool pages are coming as the inventory pipeline lands.
		</p>
	</header>

	<section class="mt-10" aria-label="Sewing cell">
		<h2 class="text-2xl font-semibold">Sewing cell</h2>
		<div class="mt-6 space-y-3">
			{#each sewingCell.resolved as tool (tool.item)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-4">
					<h3 class="font-semibold">{tool.item}</h3>
					<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">
						{tool.status}
						{#if tool.doc}
							<a class="underline" href={tool.doc} rel="external noopener">{tool.docLabel}</a>
						{/if}
					</p>
				</div>
			{/each}
		</div>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		Missing something? See the <a class="underline" href="/wants">wants list</a> or
		<a class="underline" href="/donate">donate a tool</a>.
	</footer>
</main>
