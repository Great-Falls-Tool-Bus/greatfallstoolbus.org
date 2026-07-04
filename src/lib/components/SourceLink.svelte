<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// The git-onboarding affordance: every substantive page links to its own
	// source so a reader can see "this page lives in git" and propose an edit
	// through GitHub's web editor. Wired into the shared PageHeader (never
	// per-page), so a new page gets it for free and cannot silently lack it.
	//
	// This component hardcodes NO org/repo string. The repo URL, branch, and the
	// route -> source-path map all flow from src/lib/generated/source-map.json,
	// which `just source-map-build` derives from tinyland.repo.json / package.json
	// plus the routes tree. That keeps the affordance portable to every scaffold
	// spoke and drift-gated (see `just source-map-check`).
	//
	// Typed `interface Props` + `$props()` with `$derived`, per the SEOHead /
	// PageHeader house-canon rune shape. Pages with no map entry render nothing.
	import { Code, Pencil } from '@lucide/svelte';
	import sourceMap from '$lib/generated/source-map.json';

	interface Props {
		/** SvelteKit route id, base-stripped ("/mission", "/" for root). */
		routeId: string;
	}

	let { routeId }: Props = $props();

	const routes = sourceMap.routes as Record<string, string>;
	const sourcePath = $derived(routes[routeId]);
	const editUrl = $derived(`${sourceMap.repoUrl}/edit/${sourceMap.branch}/${sourcePath}`);
	const blobUrl = $derived(`${sourceMap.repoUrl}/blob/${sourceMap.branch}/${sourcePath}`);
</script>

{#if sourcePath}
	<div class="text-surface-500 dark:text-surface-400 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
		<span>This page lives in git. Anyone can propose an edit.</span>
		<span class="flex items-center gap-x-3">
			<a
				class="hover:text-primary-600 dark:hover:text-primary-400 inline-flex items-center gap-1 underline-offset-2 hover:underline"
				href={editUrl}
				target="_blank"
				rel="noopener"
				aria-label="Edit this page on GitHub"
				title="Edit this page"
			>
				<Pencil size={14} aria-hidden="true" />
				<span>Edit this page</span>
			</a>
			<a
				class="hover:text-primary-600 dark:hover:text-primary-400 inline-flex items-center gap-1 underline-offset-2 hover:underline"
				href={blobUrl}
				target="_blank"
				rel="noopener"
				aria-label="View this page's source on GitHub"
				title="View source"
			>
				<Code size={14} aria-hidden="true" />
				<span>View source</span>
			</a>
		</span>
	</div>
{/if}
