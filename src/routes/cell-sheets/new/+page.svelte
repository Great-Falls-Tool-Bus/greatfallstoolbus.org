<script lang="ts">
	// /cell-sheets/new — a blank, fillable, printable cell-sheet template for a
	// NEW cell that does not exist on the site yet. Same paper shape and spirit as
	// the data-driven sheets (/cells/network, /cell-sheets), but empty: type the
	// cell's identity, pick how many item rows you need, print it, then fill the
	// kit in by hand. Fully static, print-optimized (@media print strips the site
	// chrome and prints black-on-white). When the cell earns a captain and a spot
	// on the bus, promote it to a real .svx doc with the form at /cells/new.
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { ClipboardList, Printer } from '@lucide/svelte';

	let cellName = $state('');
	let captain = $state('');
	let travels = $state('');
	let rowCount = $state(10);

	// Keep the row count sane for a single printed page.
	const MIN_ROWS = 1;
	const MAX_ROWS = 30;
	const rows = $derived(Array.from({ length: Math.min(Math.max(rowCount || MIN_ROWS, MIN_ROWS), MAX_ROWS) }));

	const displayName = $derived(cellName.trim() ? cellName.trim().toUpperCase() : '');

	function print() {
		window.print();
	}
</script>

<svelte:head>
	<title>Blank cell sheet | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="A blank, printable cell-sheet template for starting a new tool cell: name it, pick your rows, print it, and fill the kit in by hand. Same paper shape as the live cell sheets."
	/>
</svelte:head>

<main class="mx-auto max-w-4xl px-6 py-16 md:py-24">
	<div class="no-print">
		<PageHeader title="Blank cell sheet" icon={ClipboardList}>
			<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
				Starting a new cell? This is the blank version of the sheet that lives in every kit. Name it, choose how many
				rows you need, and print it. Fill the kit in by hand, check it in and out, and keep it with the tools.
			</p>
			<p class="text-surface-700-300 leading-relaxed">
				Once the cell has a captain and a home on the bus, turn it into a real page with the
				<a class="underline" href={`${base}/cells/new`}>cell-doc form</a>. The live cell sheets are at
				<a class="underline" href={`${base}/cell-sheets`}>/cell-sheets</a>.
			</p>
		</PageHeader>

		<section
			class="border-surface-200-800 bg-surface-50-950/75 mt-8 border p-5 md:p-6"
			aria-label="Customize the sheet"
		>
			<h2 class="text-sm font-semibold tracking-wide uppercase text-surface-500">Before you print</h2>
			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<div class="grid gap-1">
					<label class="text-sm font-medium" for="tpl-name">Cell name</label>
					<input
						id="tpl-name"
						class="border-surface-300-700 bg-surface-50-950 border px-3 py-2"
						bind:value={cellName}
						placeholder="e.g. Woodworking cell"
					/>
				</div>
				<div class="grid gap-1">
					<label class="text-sm font-medium" for="tpl-captain">Captain (optional)</label>
					<input
						id="tpl-captain"
						class="border-surface-300-700 bg-surface-50-950 border px-3 py-2"
						bind:value={captain}
						placeholder="Leave blank to write it in by hand"
					/>
				</div>
				<div class="grid gap-1">
					<label class="text-sm font-medium" for="tpl-rows">Item rows</label>
					<input
						id="tpl-rows"
						class="border-surface-300-700 bg-surface-50-950 border px-3 py-2"
						type="number"
						min={MIN_ROWS}
						max={MAX_ROWS}
						bind:value={rowCount}
					/>
					<p class="text-surface-500 text-xs">Between {MIN_ROWS} and {MAX_ROWS} for one page.</p>
				</div>
				<div class="grid gap-1">
					<label class="text-sm font-medium" for="tpl-travels">How it travels (optional)</label>
					<textarea
						id="tpl-travels"
						class="border-surface-300-700 bg-surface-50-950 min-h-[2.75rem] border px-3 py-2"
						bind:value={travels}
						placeholder="The repack rule for this kit. Leave blank to write it in."></textarea>
				</div>
			</div>
			<button
				type="button"
				class="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white transition-colors"
				onclick={print}
			>
				<Printer class="h-4 w-4" aria-hidden="true" />
				Print this sheet
			</button>
		</section>
	</div>

	<article class="sheet border-surface-200-800 bg-surface-50-950/75 mt-10 border p-6 font-mono md:p-8">
		<header>
			<p class="sheet-kicker">GREAT FALLS TOOL BUS: CELL SHEET</p>
			<h2 class="sheet-title">
				{#if displayName}
					{displayName}
				{:else}
					<span class="blank wide" aria-label="write the cell name here"></span>
				{/if}
			</h2>
			<p class="sheet-sub">
				A shared tool library on wheels for Lewiston-Auburn, Maine.<br />
				This is a bus, the shop comes later :)
			</p>
		</header>

		<section aria-label="Cell captain">
			<h3 class="sheet-h">CELL CAPTAIN: one person who knows the kit</h3>
			{#if captain.trim()}
				<p>Captain: {captain.trim()}</p>
			{:else}
				<p>Captain: <span class="blank" aria-label="write the captain's name here"></span></p>
				<p class="sheet-note">Every cell needs one. It could be you. Ask a keyholder how to take it on.</p>
			{/if}
		</section>

		<section aria-label="Kit inventory checklist">
			<h3 class="sheet-h">THE KIT: check it in, check it out</h3>
			<div class="table-wrap">
				<table class="sheet-table">
					<thead>
						<tr>
							<th scope="col" class="col-item">Item</th>
							<th scope="col" class="col-inkit">In kit?</th>
							<th scope="col" class="col-cond">Condition</th>
							<th scope="col" class="col-notes">Notes</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as _, i (i)}
							<tr>
								<td class="col-item"><span class="writein" aria-label="write the item name here"></span></td>
								<td class="col-inkit"><span class="box" aria-hidden="true"></span></td>
								<td class="col-cond"><span class="writein" aria-label="write the condition here"></span></td>
								<td class="col-notes"><span class="writein" aria-label="write notes here"></span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="sheet-checkline">
				Kit last checked: <span class="blank short" aria-label="date"></span> by
				<span class="blank" aria-label="name"></span>
			</p>
		</section>

		<section aria-label="How it travels">
			<h3 class="sheet-h">HOW IT TRAVELS</h3>
			{#if travels.trim()}
				<p>{travels.trim()}</p>
			{:else}
				<p>
					<span class="blank line" aria-label="write the repack rule here"></span>
					<span class="blank line" aria-label="continued"></span>
				</p>
			{/if}
			<p class="sheet-note">
				The repack test: if the kit cannot be repacked and rolling in ten minutes, something is missing. Tell a
				keyholder.
			</p>
		</section>

		<section aria-label="Mark the bits">
			<h3 class="sheet-h">MARK THE BITS</h3>
			<p>
				Every piece is marked as part of this set. If you find an unmarked bit, mark it (paint pen, engraver, or tag)
				before it goes back in the box. You should always know this tool belongs to the kit it came in.
			</p>
		</section>

		<section aria-label="Who to ask">
			<h3 class="sheet-h">WHO TO ASK</h3>
			<ul class="sheet-list">
				<li>
					<span aria-hidden="true">*</span>
					<span>The cell captain (named above): anything about this kit.</span>
				</li>
				<li>
					<span aria-hidden="true">*</span>
					<span>A keyholder: access, borrowing, and the bus location. Ask at https://greatfallstoolbus.org</span>
				</li>
				<li>
					<span aria-hidden="true">*</span>
					<span>Ready to make this cell real? Write it up at https://greatfallstoolbus.org/cells/new</span>
				</li>
			</ul>
		</section>

		<footer class="sheet-foot">
			This kit belongs to the Great Falls Tool Bus: https://greatfallstoolbus.org<br />
			Print me, keep me in the kit, hand me to a friend.
		</footer>
	</article>
</main>

<style>
	/* ===== Sheet typography (screen facsimile + print truth) =====
	   Mirrors the live cell sheets (/cells/network, /cell-sheets) so the blank
	   template prints identically to the ones already in the kits. */
	.sheet {
		font-size: 0.85rem;
		line-height: 1.55;
	}
	.sheet-kicker {
		font-size: 0.75em;
		letter-spacing: 0.08em;
	}
	.sheet-title {
		font-size: 1.5em;
		font-weight: 700;
		border-bottom: 2px solid currentColor;
		padding-bottom: 0.25rem;
		margin-bottom: 0.5rem;
		min-height: 1.5em;
	}
	.sheet-sub {
		margin-bottom: 1.25rem;
	}
	.sheet-h {
		font-weight: 700;
		border-bottom: 1px solid currentColor;
		margin: 1.25rem 0 0.5rem;
		padding-bottom: 0.15rem;
	}
	.sheet-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.sheet-list li {
		display: flex;
		gap: 0.6em;
		align-items: baseline;
		margin-bottom: 0.4em;
	}
	.box {
		flex: none;
		display: inline-block;
		width: 0.85em;
		height: 0.85em;
		border: 1.5px solid currentColor;
		transform: translateY(0.08em);
	}
	.blank {
		display: inline-block;
		width: 14em;
		max-width: 45vw;
		border-bottom: 1px solid currentColor;
		height: 1em;
	}
	.blank.short {
		width: 7em;
	}
	.blank.wide {
		width: 18em;
		max-width: 70vw;
	}
	.blank.line {
		display: block;
		width: 100%;
		max-width: none;
		margin-bottom: 0.6em;
	}
	.sheet-note,
	.sheet-checkline {
		margin-top: 0.4em;
	}
	.sheet-foot {
		margin-top: 1.5rem;
		border-top: 1px solid currentColor;
		padding-top: 0.5rem;
		font-style: italic;
	}

	/* ===== The checklist table ===== */
	.table-wrap {
		overflow-x: auto;
	}
	.sheet-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.95em;
	}
	.sheet-table th,
	.sheet-table td {
		border: 1px solid currentColor;
		padding: 0.45em 0.5em;
		text-align: left;
		vertical-align: top;
	}
	.sheet-table th {
		font-size: 0.8em;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.col-item {
		min-width: 12em;
		width: 34%;
	}
	.col-inkit {
		text-align: center;
		white-space: nowrap;
	}
	.sheet-table td.col-inkit {
		text-align: center;
	}
	.col-cond {
		min-width: 7em;
		width: 18%;
	}
	.col-notes {
		min-width: 12em;
	}
	.writein {
		display: inline-block;
		width: 100%;
		min-width: 6em;
		border-bottom: 1px solid currentColor;
		height: 1.1em;
	}

	/* ===== Print: strip the site chrome, black on white, paper-honest ===== */
	@page {
		margin: 1.6cm;
	}
	@media print {
		:global(.saturn-nav),
		:global(footer#contact),
		:global([data-testid='brand-vectors-bg']),
		:global(a[href='#content']),
		.no-print {
			display: none !important;
		}
		:global(html),
		:global(body) {
			background: #fff !important;
		}
		:global(body) {
			color: #000 !important;
		}
		main {
			max-width: none;
			padding: 0;
			margin: 0;
		}
		.sheet {
			border: none;
			border-radius: 0;
			padding: 0;
			margin: 0;
			background: transparent !important;
			font-size: 10.5pt;
		}
		.table-wrap {
			overflow-x: visible;
		}
		.sheet-table tr,
		.sheet-list li {
			break-inside: avoid;
		}
		section {
			break-inside: avoid;
		}
		.blank {
			max-width: none;
		}
	}
</style>
