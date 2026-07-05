<script lang="ts">
	// /cells/new — the fillable cell-doc authoring aid. A tool doc is one .svx
	// file under src/content/tools/<cell>/<slug>.svx; the frontmatter is the
	// inventory metadata the whole site reads (via $lib/data/cells). This page
	// derives its fields from that SAME schema and streams a ready-to-commit .svx
	// as you type, so "writing a new cell doc" is fill-a-form, not learn-the-YAML.
	// Fully static: no backend. Copy to clipboard or download the file, then commit
	// it (or open GitHub's new-file editor prefilled at the right path).
	import { base } from '$app/paths';
	import { cells } from '$lib/data/cells';
	import { TOOL_STATUSES } from '$lib/data/tool-schema';
	import {
		buildCellDocSvx,
		cellDocFilename,
		cellDocPath,
		emptyCellDocValues,
		resolveSlug,
		validateCellDoc,
		type CellDocValues,
		type ToolStatus,
	} from '$lib/cell-doc';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { toaster } from '$lib/toaster';
	import { FilePlus, Copy, Check, Download, ExternalLink } from '@lucide/svelte';

	// The repo the generated file belongs to (same constant the layout uses). The
	// GitHub "new file" editor accepts a prefilled path, so an author can land on
	// exactly the right filename and paste the copied body.
	const REPO_URL = 'https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org';

	const cellOptions = cells.map((cell) => ({ slug: cell.slug, name: cell.name }));
	const statusLabels: Record<ToolStatus, string> = {
		'in-kit': 'In the kit',
		restoration: 'Under restoration',
		wants: 'Wanted (not in the kit yet)',
	};

	// Field state. detailsWanted is authored as a comma / newline list and parsed
	// into the array the schema wants.
	let values = $state<CellDocValues>(emptyCellDocValues());
	let detailsWantedRaw = $state('');

	function parseWanted(raw: string): string[] {
		return raw
			.split(/[\n,]/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}

	// The single derived source of truth for the output, path, and validation.
	const effective = $derived<CellDocValues>({
		...values,
		detailsWanted: values.detailsNeeded ? parseWanted(detailsWantedRaw) : [],
	});
	const svx = $derived(buildCellDocSvx(effective));
	const path = $derived(cellDocPath(effective));
	const filename = $derived(cellDocFilename(effective));
	const errors = $derived(validateCellDoc(effective));
	const derivedSlug = $derived(resolveSlug(effective));

	const githubNewUrl = $derived(`${REPO_URL}/new/main?filename=${encodeURIComponent(path)}`);

	let copied = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copySvx() {
		try {
			await navigator.clipboard.writeText(svx);
			copied = true;
			clearTimeout(copyResetTimer);
			copyResetTimer = setTimeout(() => (copied = false), 1600);
			toaster.success({ title: 'Copied the .svx', description: filename, duration: 2400 });
		} catch {
			toaster.error({
				title: 'Copy failed',
				description: 'Select the text and copy it manually, or use Download.',
				duration: 3600,
			});
		}
	}

	function downloadSvx() {
		const blob = new Blob([svx], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
		toaster.success({ title: 'Downloading', description: filename, duration: 2400 });
	}

	const BODY_OUTLINE = `What it is: one or two plain sentences on the tool and what it is for on the bus.

How it packs and travels: the honest note (case, cart, marked bits).

Care: what it needs, and who to ask when it needs it.`;

	function insertOutline() {
		values.body = values.body?.trim() ? values.body : BODY_OUTLINE;
	}

	// Shared input chrome, matching the contact form's field vocabulary.
	const inputClass = 'border-surface-300-700 bg-surface-50-950 border px-3 py-2';
</script>

<svelte:head>
	<title>Write a cell doc | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="A fillable form that writes a ready-to-commit tool doc (.svx) for the Great Falls Tool Bus inventory: fill the fields, copy or download the file, commit it. No YAML by hand."
	/>
</svelte:head>

<main class="mx-auto max-w-6xl px-6 py-16 md:py-24">
	<PageHeader title="Write a cell doc" icon={FilePlus}>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			Every tool on the bus is one small file. Fill this in and it writes the file for you: the frontmatter the whole
			site reads, plus an optional write-up. No YAML by hand, no guessing the fields.
		</p>
		<p class="text-surface-700-300 leading-relaxed">
			When it looks right, <strong>copy</strong> or <strong>download</strong> the file and commit it at the path shown,
			or open it straight in GitHub. Then run <code class="font-mono text-sm">just tools-validate</code> to check it
			against the same rules this form uses. Browsing first? See the
			<a class="underline" href={`${base}/tools`}>tool inventory</a> and the
			<a class="underline" href={`${base}/cells`}>cells</a>.
		</p>
	</PageHeader>

	<div class="mt-10 grid gap-10 lg:grid-cols-2">
		<!-- ===== The form ===== -->
		<form class="space-y-8" aria-label="Cell doc fields">
			<fieldset class="space-y-4">
				<legend class="text-lg font-semibold">The basics</legend>

				<div class="grid gap-1">
					<label class="text-sm font-medium" for="doc-name">Tool name <span aria-hidden="true">*</span></label>
					<input
						id="doc-name"
						class={inputClass}
						bind:value={values.name}
						placeholder="SINGER Heavy Duty 6600C"
						aria-invalid={errors.name ? 'true' : undefined}
						aria-describedby="doc-name-help {errors.name ? 'doc-name-error' : ''}"
						required
					/>
					<p id="doc-name-help" class="text-surface-500 text-xs leading-relaxed">
						The real product, as it would appear on an order reference. No invented model names.
					</p>
					{#if errors.name}
						<p id="doc-name-error" class="text-error-700 dark:text-error-400 text-sm">{errors.name}</p>
					{/if}
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1">
						<label class="text-sm font-medium" for="doc-cell">Cell</label>
						<select id="doc-cell" class={inputClass} bind:value={values.cell}>
							{#each cellOptions as option (option.slug)}
								<option value={option.slug}>{option.name}</option>
							{/each}
						</select>
					</div>
					<div class="grid gap-1">
						<label class="text-sm font-medium" for="doc-status">Status</label>
						<select id="doc-status" class={inputClass} bind:value={values.status}>
							{#each TOOL_STATUSES as status (status)}
								<option value={status}>{statusLabels[status]}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="grid gap-1">
					<label class="text-sm font-medium" for="doc-blurb">One-sentence blurb <span aria-hidden="true">*</span></label
					>
					<textarea
						id="doc-blurb"
						class="{inputClass} min-h-20"
						bind:value={values.blurb}
						placeholder="The working machine — 100 built-in stitches, six one-step buttonholes."
						aria-invalid={errors.blurb ? 'true' : undefined}
						aria-describedby="doc-blurb-help {errors.blurb ? 'doc-blurb-error' : ''}"
						required></textarea>
					<p id="doc-blurb-help" class="text-surface-500 text-xs leading-relaxed">
						This is the card copy on the tools and wants pages. One honest sentence.
					</p>
					{#if errors.blurb}
						<p id="doc-blurb-error" class="text-error-700 dark:text-error-400 text-sm">{errors.blurb}</p>
					{/if}
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-1">
						<label class="text-sm font-medium" for="doc-order">Kit order</label>
						<input
							id="doc-order"
							class={inputClass}
							type="number"
							step="1"
							bind:value={values.order}
							aria-invalid={errors.order ? 'true' : undefined}
							aria-describedby={errors.order ? 'doc-order-error' : undefined}
						/>
						{#if errors.order}
							<p id="doc-order-error" class="text-error-700 dark:text-error-400 text-sm">{errors.order}</p>
						{/if}
					</div>
					<div class="grid gap-1">
						<label class="text-sm font-medium" for="doc-slug">Filename slug</label>
						<input
							id="doc-slug"
							class={inputClass}
							bind:value={values.slug}
							placeholder={derivedSlug || 'from the name'}
						/>
						{#if errors.slug}
							<p class="text-error-700 dark:text-error-400 text-sm">{errors.slug}</p>
						{:else}
							<p class="text-surface-500 text-xs">Leave blank to derive it from the name.</p>
						{/if}
					</div>
				</div>
			</fieldset>

			<fieldset class="space-y-4">
				<legend class="text-lg font-semibold"
					>Manual or datasheet <span class="text-surface-500 text-sm font-normal">(optional)</span></legend
				>
				<div class="grid gap-1">
					<label class="text-sm font-medium" for="doc-docurl">Link (https)</label>
					<input
						id="doc-docurl"
						class={inputClass}
						type="url"
						inputmode="url"
						bind:value={values.docUrl}
						placeholder="https://example.com/manual.pdf"
						aria-invalid={errors.docUrl ? 'true' : undefined}
						aria-describedby={errors.docUrl ? 'doc-docurl-error' : undefined}
					/>
					{#if errors.docUrl}
						<p id="doc-docurl-error" class="text-error-700 dark:text-error-400 text-sm">{errors.docUrl}</p>
					{/if}
				</div>
				<div class="grid gap-1">
					<label class="text-sm font-medium" for="doc-doclabel">Link text</label>
					<input
						id="doc-doclabel"
						class={inputClass}
						bind:value={values.docLabel}
						placeholder="Instruction manual (PDF)"
						aria-invalid={errors.docLabel ? 'true' : undefined}
						aria-describedby={errors.docLabel ? 'doc-doclabel-error' : undefined}
					/>
					{#if errors.docLabel}
						<p id="doc-doclabel-error" class="text-error-700 dark:text-error-400 text-sm">{errors.docLabel}</p>
					{/if}
				</div>
			</fieldset>

			<fieldset class="space-y-4">
				<legend class="text-lg font-semibold"
					>Honest gaps <span class="text-surface-500 text-sm font-normal">(optional)</span></legend
				>
				<label class="flex items-start gap-3">
					<input type="checkbox" class="mt-1 h-4 w-4" bind:checked={values.detailsNeeded} />
					<span>
						<span class="block text-sm font-medium">Details still needed</span>
						<span class="text-surface-500 block text-xs leading-relaxed">
							It is in the kit, but a real specific is not written down yet. The site shows a calm "details needed" chip
							instead of inventing the fact.
						</span>
					</span>
				</label>
				{#if values.detailsNeeded}
					<div class="grid gap-1">
						<label class="text-sm font-medium" for="doc-wanted">What is missing</label>
						<textarea
							id="doc-wanted"
							class="{inputClass} min-h-16"
							bind:value={detailsWantedRaw}
							placeholder="model number, photo, config notes"
							aria-describedby="doc-wanted-help"></textarea>
						<p id="doc-wanted-help" class="text-surface-500 text-xs leading-relaxed">
							In the order it should be filled. Separate items with commas or new lines.
						</p>
					</div>
				{/if}
			</fieldset>

			<fieldset class="space-y-4">
				<legend class="text-lg font-semibold"
					>Longer write-up <span class="text-surface-500 text-sm font-normal">(optional)</span></legend
				>
				<div class="grid gap-1">
					<div class="flex items-center justify-between gap-3">
						<label class="text-sm font-medium" for="doc-body">Body (markdown)</label>
						<button
							type="button"
							class="border-surface-300-700 hover:bg-surface-200-800 border px-2 py-1 text-xs font-medium transition-colors"
							onclick={insertOutline}
						>
							Insert a starter outline
						</button>
					</div>
					<textarea
						id="doc-body"
						class="{inputClass} min-h-32 font-mono text-sm"
						bind:value={values.body}
						placeholder="Optional prose for a future per-tool page. Leave empty for a terse inventory-only entry."
					></textarea>
				</div>
			</fieldset>
		</form>

		<!-- ===== Live output ===== -->
		<div class="lg:sticky lg:top-24 lg:self-start">
			<section aria-labelledby="output-heading" class="border-surface-200-800 bg-surface-50-950/75 border p-5 md:p-6">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<h2 id="output-heading" class="text-lg font-semibold">Your file</h2>
					<code class="text-surface-600-400 min-w-0 truncate font-mono text-xs" title={path}>{path}</code>
				</div>

				<pre
					class="border-surface-200-800 bg-surface-100-900/60 mt-4 max-h-96 overflow-auto border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{svx}</pre>

				<div class="mt-4 flex flex-wrap gap-3">
					<button
						type="button"
						class="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white transition-colors"
						onclick={copySvx}
					>
						{#if copied}
							<Check class="h-4 w-4" aria-hidden="true" />
							Copied
						{:else}
							<Copy class="h-4 w-4" aria-hidden="true" />
							Copy .svx
						{/if}
					</button>
					<button
						type="button"
						class="border-surface-300-700 hover:bg-surface-200-800 inline-flex items-center gap-2 border px-4 py-2 text-sm font-semibold transition-colors"
						onclick={downloadSvx}
					>
						<Download class="h-4 w-4" aria-hidden="true" />
						Download
					</button>
					<a
						class="border-surface-300-700 hover:bg-surface-200-800 inline-flex items-center gap-2 border px-4 py-2 text-sm font-semibold transition-colors"
						href={githubNewUrl}
						target="_blank"
						rel="external noopener"
					>
						<ExternalLink class="h-4 w-4" aria-hidden="true" />
						Open in GitHub
					</a>
				</div>

				<div class="border-surface-200-800 mt-5 border-t pt-4">
					<h3 class="text-sm font-semibold">Then commit it</h3>
					<ol class="text-surface-700-300 mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
						<li>Save the file at <code class="font-mono text-xs">{path}</code>.</li>
						<li>Run <code class="font-mono text-xs">just tools-validate</code> to check it.</li>
						<li>Open a pull request. A keyholder reviews and merges it.</li>
					</ol>
					<p class="text-surface-500 mt-3 text-xs leading-relaxed">
						Not set up for git? Copy the file and send it to a keyholder from the
						<a class="underline" href={`${base}/contact`}>contact page</a>; they will commit it for you.
					</p>
				</div>
			</section>
		</div>
	</div>
</main>
