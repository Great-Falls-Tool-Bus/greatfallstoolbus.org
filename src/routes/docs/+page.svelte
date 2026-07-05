<script lang="ts">
	import { base } from '$app/paths';
	import { FileText, Network } from '@lucide/svelte';
	// Operator-docs index. The bodies are the REAL docs/** files, surfaced on-site
	// through $lib/docs/registry (SSOT, no copy) and rendered by the house
	// dependency-free markdown component. This page only indexes them.
	import { docsByGroup } from '$lib/docs/registry';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';

	const groups = docsByGroup();
</script>

<svelte:head>
	<title>Operator docs | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Operator-facing documentation for the Great Falls Tool Bus site: runbooks, deploy and launch readiness, the CI contract, development, and the cluster network and mail-port diagrams. Every doc lives in git."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Operator docs"
		icon={FileText}
		lead="The runbooks, deploy and launch readiness, and CI and development contracts that keep the bus site running. These are the technical, operator-facing docs; every one is a real file in the repository, rendered here as-is."
	/>

	<section class="border-surface-200-800 mt-8 border-y py-6" aria-label="About these docs">
		<p class="text-surface-700 dark:text-surface-300 leading-relaxed">
			Nothing on this page is a secret. These pages describe how the site is deployed and how its mail and DNS are cut
			over; the credentials and internal endpoints they refer to live outside the repository, named but never committed.
			The accepted hosting direction is on-cluster serving as the primary target (ADR 0008), with Cloudflare Pages kept
			as the warm standby (ADR 0007); that cutover is operator-gated and not yet done, so Cloudflare Pages is still the
			live host. For the serving topology and the mail-stack port map, see the
			<a class="underline" href={`${base}/docs/diagrams`}>network and port diagrams</a>.
		</p>
	</section>

	<section class="mt-10" aria-label="Network and port diagrams">
		<Card href={`${base}/docs/diagrams`} title="Network and port diagrams" headingLevel="h2">
			{#snippet lead()}
				<Network class="text-primary-500 h-6 w-6" aria-hidden="true" />
			{/snippet}
			<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">
				The serving topology (the accepted on-cluster target and the current Cloudflare Pages live host), the cluster
				node roles, and the end-to-end mail flow with its port map, grounded in the documented infrastructure truth.
			</p>
		</Card>
	</section>

	{#each groups as group (group.heading)}
		<section class="mt-12" aria-label={group.heading}>
			<h2 class="text-2xl font-semibold">{group.heading}</h2>
			<div class="mt-6 space-y-3">
				{#each group.docs as doc (doc.slug)}
					<Card href={`${base}/docs/${doc.slug}`} title={doc.title} headingLevel="h3" compact>
						<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">{doc.summary}</p>
						<p class="text-surface-500 mt-2 font-mono text-xs">{doc.path}</p>
					</Card>
				{/each}
			</div>
		</section>
	{/each}

	<footer class="text-surface-500 pt-12 text-sm">
		Every doc here lives in <span class="font-mono">docs/</span> in the site repository and is rendered from that single source.
		Spot something out of date? Each page links to its source so you can propose an edit on GitHub.
	</footer>
</main>
