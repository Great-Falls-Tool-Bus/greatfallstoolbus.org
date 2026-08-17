<script lang="ts">
	import { base } from '$app/paths';
	import { FileText, ArrowLeft } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import { makeLinkResolver } from '$lib/docs/registry';
	import sourceMap from '$lib/generated/source-map.json';

	let { data } = $props();
	const doc = $derived(data.doc);

	// Relative links inside the doc resolve to canonical GitHub blob URLs; the
	// repo URL and branch flow from the generated source map (no hardcoded slug).
	const resolveLink = $derived(makeLinkResolver(doc.path));
	const sourceUrl = $derived(`${sourceMap.repoUrl}/blob/${sourceMap.branch}/${doc.path}`);
	const editUrl = $derived(`${sourceMap.repoUrl}/edit/${sourceMap.branch}/${doc.path}`);
</script>

<svelte:head>
	<title>{doc.title} | Operator docs | Great Falls Tool Bus</title>
	<meta name="description" content={doc.summary} />
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<a
		href={`${base}/docs`}
		class="text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
	>
		<ArrowLeft size={14} aria-hidden="true" />
		<span>All operator docs</span>
	</a>

	<div class="mt-6">
		<PageHeader title={doc.title} icon={FileText} lead={doc.summary} />
	</div>

	<p class="text-surface-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
		<span>Rendered from <span class="font-mono">{doc.path}</span> in git.</span>
		<ExternalLink href={sourceUrl} class="hover:text-primary-600 dark:hover:text-primary-400">View source</ExternalLink>
		<ExternalLink href={editUrl} class="hover:text-primary-600 dark:hover:text-primary-400"
			>Propose an edit</ExternalLink
		>
	</p>

	<article class="border-surface-200-800 mt-8 border-t pt-8">
		<Markdown source={doc.raw} {resolveLink} />
	</article>
</main>
