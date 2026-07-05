<script lang="ts">
	import { base } from '$app/paths';
	// Printable cell sheets — one page per tool cell, in the spirit of
	// static/readme.txt: plain, honest, meant for paper. "Print me, pin me to
	// a board, hand me to a friend." Inventory truth is the .svx tool tree at
	// src/content/tools/**, shared with /tools via $lib/data/cells.ts so the
	// sheet can never drift from the site.
	import { cells } from '$lib/data/cells';
	import DetailsNeeded from '$lib/components/DetailsNeeded.svelte';
</script>

<svelte:head>
	<title>Printable cell sheets | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="One-page printable sheets per tool cell: what is in the kit, how it travels, and who its captain is. Print, pin to a board, hand to a friend."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<header class="no-print space-y-4">
		<h1 class="text-4xl leading-tight font-bold">Cell sheets</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			One page per tool cell: what is in the kit, how it travels, and who its captain is. These are made for paper —
			print one, tuck it in the kit, pin one to a board. The checkboxes are real: check the kit against its sheet every
			time it goes out and comes back.
		</p>
		<p class="text-surface-700 dark:text-surface-300 leading-relaxed">
			Looking for the general flyer instead? That is
			<a class="underline" href={`${base}/readme.txt`}>readme.txt</a> — same spirit, whole project.
		</p>
		<p class="text-surface-700 dark:text-surface-300 leading-relaxed">
			Starting a cell that is not here yet? Print a
			<a class="underline" href={`${base}/cell-sheets/new`}>blank cell sheet</a> to fill by hand, or write it up with
			the
			<a class="underline" href={`${base}/cells/new`}>cell-doc form</a>.
		</p>
		<button
			type="button"
			class="bg-primary-500 hover:bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors"
			onclick={() => window.print()}
		>
			Print {cells.length === 1 ? 'this sheet' : 'these sheets'}
		</button>
	</header>

	<div class="mt-10 space-y-10">
		{#each cells as cell (cell.slug)}
			<article class="sheet border-surface-200-800 bg-surface-50-950/75 border p-6 font-mono md:p-8">
				<header>
					<p class="sheet-kicker">GREAT FALLS TOOL BUS: CELL SHEET</p>
					<h2 class="sheet-title">{cell.name.toUpperCase()}</h2>
					<p class="sheet-sub">
						A shared tool library on wheels for Lewiston-Auburn, Maine.<br />
						This is a bus, the shop comes later :)
					</p>
				</header>

				<section aria-label="In the kit">
					<h3 class="sheet-h">IN THE KIT: check each box when the kit is packed</h3>
					<ul class="sheet-list">
						{#each cell.tools as tool (tool.slug)}
							<li>
								<span class="box" aria-hidden="true"></span>
								<span
									><strong>{tool.name}</strong> — {tool.blurb}
									{#if tool.detailsNeeded}
										<DetailsNeeded wanted={tool.detailsWanted} sourcePath={tool.sourcePath} name={tool.name} />
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				</section>

				<section aria-label="How it travels">
					<h3 class="sheet-h">HOW IT TRAVELS</h3>
					<p>{cell.travels}</p>
				</section>

				<section aria-label="Cell captain">
					<h3 class="sheet-h">CELL CAPTAIN: one person who knows the kit</h3>
					{#if cell.captain}
						<p>Captain: {cell.captain}</p>
					{:else}
						<p>Captain: <span class="blank" aria-label="write the captain's name here"></span></p>
						<p class="sheet-note">This cell still needs one. It could be you. Ask a keyholder.</p>
					{/if}
					<p class="sheet-checkline">
						Kit last checked: <span class="blank short" aria-label="date"></span> by
						<span class="blank" aria-label="name"></span>
					</p>
				</section>

				<section aria-label="Get access">
					<h3 class="sheet-h">GET ACCESS</h3>
					<p>
						Reach out, a keyholder answers. Keyholders vet requests and share the bus location directly.
						<br />https://greatfallstoolbus.org
					</p>
				</section>

				<footer class="sheet-foot">Print me, pin me to a board, hand me to a friend.</footer>
			</article>
		{/each}
	</div>
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

	/* ===== Print: strip the site chrome, one cell per page, ink-honest ===== */
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
			break-after: page;
			font-size: 11pt;
		}
		.sheet:last-child {
			break-after: auto;
		}
	}
</style>
