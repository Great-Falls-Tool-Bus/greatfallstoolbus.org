<script lang="ts">
	// The network and tracing cell sheet: the printable one-pager that lives in
	// the kit. Same shape and spirit as the sewing cell sheet (static/readme.txt:
	// plain, honest, meant for paper). Inventory truth comes from
	// $lib/data/cells.ts (shared with /tools and /cell-sheets) so the sheet in
	// the kit can never drift from the site. Several items carry a details-needed
	// flag: they are in the kit, but a real specific (model number, photo,
	// config) is not documented yet, so the sheet invites the owner to fill it in
	// rather than printing an invented spec.
	import { base } from '$app/paths';
	import { cells } from '$lib/data/cells';
	import DetailsNeeded from '$lib/components/DetailsNeeded.svelte';

	const cell = cells.find((c) => c.slug === 'network');
	if (!cell) throw new Error('network cell missing from $lib/data/cells');
</script>

<svelte:head>
	<title>Network and tracing cell sheet | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="The printable network and tracing cell sheet: the diagnostics kit inventory as a checklist table, care rules, captain line, and who to ask. Print it and keep it in the kit."
	/>
</svelte:head>

<main class="mx-auto max-w-4xl px-6 py-16 md:py-24">
	<header class="no-print space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">
			<a class="underline" href={`${base}/cells`}>Tool cells</a> / Network and tracing
		</p>
		<h1 class="text-4xl leading-tight font-bold">Network and tracing cell sheet</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			The diagnostics cell: cable tracing, network testing, and RF exploration. This page is made for paper. Print it,
			keep one in the kit, pin one to a board. Check the kit against the table every time it goes out and comes back:
			the checkboxes and blanks are real.
		</p>
		<p class="text-surface-700 dark:text-surface-300 leading-relaxed">
			Some rows are marked <strong>details needed</strong>. Those tools are in the kit, but a real specific (a model
			number, a photo, a config) has not been written down yet. If you know one, follow the edit link on the row and
			fill it in. That is the whole idea: an honest gap is a link, not a guess.
		</p>
		<button
			type="button"
			class="bg-primary-500 hover:bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors"
			onclick={() => window.print()}
		>
			Print this sheet
		</button>
	</header>

	<article class="sheet border-surface-200-800 bg-surface-50-950/75 mt-10 border p-6 font-mono md:p-8">
		<header>
			<p class="sheet-kicker">GREAT FALLS TOOL BUS: CELL SHEET</p>
			<h2 class="sheet-title">{cell.name.toUpperCase()}</h2>
			<p class="sheet-sub">
				A shared tool library on wheels for Lewiston-Auburn, Maine.<br />
				This is a bus, the shop comes later :)
			</p>
		</header>

		<section aria-label="Cell captain">
			<h3 class="sheet-h">CELL CAPTAIN: one person who knows the kit</h3>
			{#if cell.captain}
				<p>Captain: {cell.captain}</p>
			{:else}
				<p>Captain: <span class="blank" aria-label="write the captain's name here"></span></p>
				<p class="sheet-note">This cell still needs a captain. Ask a keyholder how to take it on.</p>
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
						{#each cell.tools as tool (tool.name)}
							<tr>
								<td class="col-item"><strong>{tool.name}</strong></td>
								<td class="col-inkit"><span class="box" aria-hidden="true"></span></td>
								<td class="col-cond"><span class="writein" aria-label="write the condition here"></span></td>
								<td class="col-notes">
									{tool.blurb}
									{#if tool.docUrl}
										Manual: {tool.docUrl}
									{/if}
									{#if tool.detailsNeeded}
										<DetailsNeeded wanted={tool.detailsWanted} sourcePath={tool.sourcePath} name={tool.name} />
									{/if}
								</td>
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

		<section aria-label="Mark the bits">
			<h3 class="sheet-h">MARK THE BITS</h3>
			<p>
				Every piece (probes, adapters, patch leads, antennas, the radios themselves) is marked as part of this set. If
				you find an unmarked bit, mark it (paint pen, engraver, or tag) before it goes back in the box. You should
				always know this tool belongs to the network kit it came in.
			</p>
		</section>

		<section aria-label="Care rules">
			<h3 class="sheet-h">CARE RULES</h3>
			<ul class="sheet-list">
				<li>
					<span class="box" aria-hidden="true"></span>
					<span
						><strong>Listen first.</strong> The SDR and LoRa radio are for learning what is on the air. Transmit only where
						and when it is legal, and know the band before you key up.</span
					>
				</li>
				<li>
					<span class="box" aria-hidden="true"></span>
					<span
						>Keep the tone generator off live network ports. It injects a signal; put it on a pair you know is dead,
						then trace.</span
					>
				</li>
				<li>
					<span class="box" aria-hidden="true"></span>
					<span>Coil and tie every cable back to its length before it goes away. A tangled kit is a slow kit.</span>
				</li>
				<li>
					<span class="box" aria-hidden="true"></span>
					<span
						>Radios and meters are static-sensitive and knock-sensitive. They ride padded, not loose in the bottom of a
						bag.</span
					>
				</li>
				<li>
					<span class="box" aria-hidden="true"></span>
					<span>Repack test: {cell.travels}</span>
				</li>
			</ul>
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
					<span
						>Know a model number, a config, or have a photo of a details-needed item? Edit its page from the online
						sheet at https://greatfallstoolbus.org/cells/network</span
					>
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
	/* ===== Sheet typography (screen facsimile + print truth) ===== */
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
		padding: 0.35em 0.5em;
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
		width: 30%;
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
		width: 15%;
	}
	.col-notes {
		min-width: 16em;
		overflow-wrap: anywhere;
	}
	.writein {
		display: inline-block;
		width: 100%;
		min-width: 6em;
		border-bottom: 1px solid currentColor;
		height: 1em;
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
