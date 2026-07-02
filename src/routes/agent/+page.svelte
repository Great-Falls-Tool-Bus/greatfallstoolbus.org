<script lang="ts">
	let { data } = $props();

	const entrypoints = [
		{
			label: 'AGENTS.md',
			href: 'https://github.com/tinyland-inc/greatfallstoolbus.org/blob/main/AGENTS.md',
			text: 'Normative operator and agent contract.',
		},
		{
			label: 'CI-SCHEMA.md',
			href: 'https://github.com/tinyland-inc/greatfallstoolbus.org/blob/main/docs/CI-SCHEMA.md',
			text: 'Lane, Blahaj, Flywheel, runner, and conformance schema.',
		},
		{
			label: 'tinyland.repo.json',
			href: 'https://github.com/tinyland-inc/greatfallstoolbus.org/blob/main/tinyland.repo.json',
			text: 'Machine-readable repo role, contracts, authority boundaries, and SBOM policy.',
		},
		{
			label: 'Agent adoption',
			href: 'https://github.com/tinyland-inc/greatfallstoolbus.org/blob/main/docs/agent-adoption.md',
			text: 'Paste-to-agent flow for repo triage, layer mapping, smells, and conformance patches.',
		},
		{
			label: 'Repo taxonomy',
			href: 'https://github.com/tinyland-inc/greatfallstoolbus.org/blob/main/docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md',
			text: 'Static spoke, app spoke, mothership, Blahaj, and GloriousFlywheel boundaries.',
		},
		{
			label: 'Justfile',
			href: 'https://github.com/tinyland-inc/greatfallstoolbus.org/blob/main/Justfile',
			text: 'Single authoritative command surface.',
		},
		{
			label: 'llms.txt',
			href: '/llms.txt',
			text: 'Public LLM index for the deployed scaffold site.',
		},
		{
			label: 'agent-map.md',
			href: '/agent-map.md',
			text: 'Compact machine route map.',
		},
	];

	const skills = $derived(data.skills);

	const recipes = [
		'just setup',
		'just check',
		'just build',
		'just ci',
		'just secrets-scan-dir',
		'just secrets-scan',
		'just sbom',
		'just bazel-graph',
		'just repo-manifest-validate',
		'just flywheel-info',
		'just flywheel-build',
		'just flywheel-test',
		'just conformance',
	];

	const flywheel = [
		['BAZEL_REMOTE_CACHE', 'Required for every Flywheel-backed Bazel command.'],
		['GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed', 'Remote cache only.'],
		['GF_BAZEL_SUBSTRATE_MODE=executor-backed', 'Remote execution plus cache; cluster runners only.'],
		['GF_BAZEL_REMOTE_UPLOAD=true', 'Trusted default-branch or operator cache-writing lanes only.'],
	];
</script>

<svelte:head>
	<title>Agent AX map - greatfallstoolbus.org</title>
	<meta
		name="description"
		content="Agent-readable entrypoints, project skills, Just recipes, and Flywheel cache-first constraints for greatfallstoolbus.org."
	/>
</svelte:head>

<main class="mx-auto max-w-5xl px-6 py-16 md:py-20">
	<header class="max-w-3xl space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">Agent AX</p>
		<h1 class="text-4xl leading-tight font-bold md:text-5xl">greatfallstoolbus.org traversal map</h1>
		<p class="text-surface-700-300 text-lg leading-relaxed">
			The scaffold is itself a static spoke: public site, machine-readable index, reusable project skills, and a single
			Justfile-backed command surface.
		</p>
	</header>

	<section class="mt-12" aria-labelledby="entrypoints">
		<div class="mb-5 flex items-end justify-between gap-4">
			<h2 id="entrypoints" class="text-2xl font-bold">Entrypoints</h2>
			<a
				class="text-primary-600 text-sm underline underline-offset-4"
				href="https://github.com/tinyland-inc/greatfallstoolbus.org">Repository</a
			>
		</div>
		<div class="grid gap-3 md:grid-cols-2">
			{#each entrypoints as item (item.label)}
				<a
					class="border-surface-200-800 bg-surface-50-950/75 hover:border-primary-500 block rounded-lg border p-4 transition-colors"
					href={item.href}
					aria-label={item.label}
				>
					<span class="font-mono text-sm font-semibold">{item.label}</span>
					<span class="text-surface-700-300 mt-2 block text-sm leading-relaxed">{item.text}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="mt-12" aria-labelledby="skills">
		<div class="mb-5 flex items-end justify-between gap-4">
			<h2 id="skills" class="text-2xl font-bold">Project Skills</h2>
			<a
				class="text-primary-600 text-sm underline underline-offset-4"
				href="https://github.com/tinyland-inc/greatfallstoolbus.org/blob/main/.claude-plugin/marketplace.json"
				>Install as plugin</a
			>
		</div>
		<p class="text-surface-700-300 mb-5 max-w-3xl text-sm leading-relaxed">
			Six skills bundled as the <code>scaffold-core</code> plugin. Rendered from
			<code>.agents/skills/*/SKILL.md</code> at build time — single source of truth. Install with
			<code>/plugin marketplace add github:tinyland-inc/greatfallstoolbus.org</code>.
		</p>
		<div class="grid gap-3 lg:grid-cols-2">
			{#each skills as skill (skill.name)}
				<a
					class="border-surface-200-800 bg-surface-50-950/75 hover:border-primary-500 block rounded-lg border p-4 transition-colors"
					href={skill.href}
					aria-label={skill.name}
				>
					<div class="flex items-center justify-between gap-2">
						<span class="font-mono text-sm font-semibold">{skill.name}</span>
						{#if skill.disable_model_invocation}
							<span class="text-surface-500 text-[10px] tracking-widest uppercase">User-only</span>
						{/if}
					</div>
					<span class="text-surface-700-300 mt-2 block text-sm leading-relaxed">{skill.description}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="mt-12 grid gap-8 lg:grid-cols-[1fr_1.1fr]" aria-label="Recipes and Flywheel">
		<div>
			<h2 class="mb-5 text-2xl font-bold">Recipes</h2>
			<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-4">
				<ul class="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1">
					{#each recipes as recipe (recipe)}
						<li><code>{recipe}</code></li>
					{/each}
				</ul>
			</div>
		</div>
		<div>
			<h2 class="mb-5 text-2xl font-bold">Flywheel Defaults</h2>
			<div class="border-surface-200-800 bg-surface-50-950/75 overflow-hidden rounded-lg border">
				{#each flywheel as [env, meaning] (env)}
					<div
						class="border-surface-200-800 grid gap-2 border-b p-4 last:border-b-0 md:grid-cols-[minmax(0,0.9fr)_1fr]"
					>
						<code class="text-sm">{env}</code>
						<p class="text-surface-700-300 text-sm leading-relaxed">{meaning}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>
</main>
