<script lang="ts">
	const brand = {
		domain: 'site.scaffold',
		tagline: 'Spokes of the Tinyland ecosystem',
		blurb:
			'Static SvelteKit, Skeleton 4.15.2, Tailwind v4, Bazel, Nix, Just, gitleaks, Blahaj preview lanes, and projection-first Tinyland operating rules.',
		tier: 'Template - agent-readable house scaffold',
	};

	const surfaces = [
		{
			title: 'Agent Skills',
			body: 'Codex project skills with Claude-compatible entrypoints for Flywheel Bazel, static spokes, and repo contracts.',
			href: '/agent#skills',
		},
		{
			title: 'llms.txt',
			body: 'Public route index for the template repo, normative docs, Justfile, and project skills.',
			href: '/llms.txt',
		},
		{
			title: 'Flywheel RBE',
			body: 'Endpoint-free wrapper contract for cache-first Bazel builds, tests, fetches, and executor-backed proof lanes.',
			href: '/agent',
		},
	];

	const contracts = [
		'Justfile-only operations',
		'Nix dev shell baseline',
		'Gitleaks security gate',
		'Bazel graphable topology',
	];
</script>

<svelte:head>
	<title>site.scaffold — Tinyland house static-site scaffold</title>
	<meta name="description" content={brand.blurb} />
</svelte:head>

<main class="mx-auto max-w-5xl px-6 py-16 md:py-24">
	<header class="max-w-3xl space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">{brand.tier}</p>
		<h1 class="text-4xl leading-tight font-bold md:text-5xl">{brand.domain}</h1>
		<p class="text-primary-600 text-xl">{brand.tagline}</p>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			{brand.blurb}
		</p>
	</header>

	<section class="mt-12 grid gap-3 md:grid-cols-3" aria-label="Public agent surfaces">
		{#each surfaces as surface (surface.title)}
			<a
				class="border-surface-200-800 bg-surface-50-950/75 hover:border-primary-500 block rounded-lg border p-5 transition-colors"
				href={surface.href}
				aria-label={surface.title}
			>
				<h2 class="text-lg font-semibold">{surface.title}</h2>
				<p class="text-surface-700-300 mt-3 text-sm leading-relaxed">{surface.body}</p>
			</a>
		{/each}
	</section>

	<section class="mt-12 border-y border-surface-200-800 py-8" aria-label="Scaffold contracts">
		<ul class="grid gap-3 text-sm md:grid-cols-4">
			{#each contracts as contract (contract)}
				<li class="font-mono">{contract}</li>
			{/each}
		</ul>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		Part of the Tinyland enterprise. Public content may later flow from reviewed
		<a class="underline" href="https://tinyland.dev">tinyland.dev</a> projections.
	</footer>
</main>
