<script lang="ts">
	const brand = {
		name: 'Great Falls Tool Bus',
		domain: 'greatfallstoolbus.org',
		tagline: 'This is a bus, the shop comes later :)',
		blurb:
			'A shared tool library on wheels for Lewiston-Auburn, Maine. We collect serious tools — the big, heavy, many-little-bits kind — kit them for transport, and lend them to neighbors who ask.',
	};

	const criteria = [
		{
			title: 'Transportable',
			body: 'How can this tool be packed up and moved? Would it benefit from a cart, case, or chest? Every tool on the bus travels well or gets a kit that makes it travel well.',
		},
		{
			title: 'Mark the bits',
			body: 'Parts, consumables, and attachments are marked as part of a set. You should always know this chisel belongs to the tool bus kit it came in.',
		},
		{
			title: 'Repairable & documented',
			body: 'Model numbers recorded, manuals linked, and a named contact for guidance or repairs. If it breaks, we know who to ask and where the datasheet lives.',
		},
	];

	const pages = [
		{ title: 'Tools on the bus', body: 'What we have, kitted and documented.', href: '/tools' },
		{ title: 'Donate a tool', body: 'The criteria above, in checklist form.', href: '/donate' },
		{ title: 'Wants', body: 'What the bus still needs.', href: '/wants' },
		{ title: 'Bibliography', body: 'The research this project stands on.', href: '/bibliography' },
		{ title: 'Shout-outs', body: 'The people making this real.', href: '/shout-outs' },
	];
</script>

<svelte:head>
	<title>Great Falls Tool Bus — a shared tool library on wheels for Lewiston-Auburn, Maine</title>
	<meta name="description" content={brand.blurb} />
</svelte:head>

<main class="mx-auto max-w-5xl px-6 py-16 md:py-24">
	<header class="max-w-3xl space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">Lewiston-Auburn, Maine</p>
		<h1 class="text-4xl leading-tight font-bold md:text-5xl">{brand.name}</h1>
		<p class="text-primary-600 text-xl">{brand.tagline}</p>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			{brand.blurb}
		</p>
	</header>

	<section class="mt-12" aria-label="Shared-tool criteria">
		<h2 class="text-2xl font-semibold">What makes a good bus tool</h2>
		<div class="mt-6 grid gap-3 md:grid-cols-3">
			{#each criteria as item (item.title)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
					<h3 class="text-lg font-semibold">{item.title}</h3>
					<p class="text-surface-700-300 mt-3 text-sm leading-relaxed">{item.body}</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-12 border-y py-8" aria-label="How access works">
		<h2 class="text-2xl font-semibold">Getting on the bus</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 max-w-3xl leading-relaxed">
			Access is simple and human: you reach out, a keyholder answers. Keyholders vet requests and share the bus location
			directly. The keyholders mailing list and contact form are being stood up now — until they open, watch this page.
		</p>
	</section>

	<section class="mt-12 grid gap-3 md:grid-cols-3" aria-label="Site pages">
		{#each pages as page (page.title)}
			<a
				class="border-surface-200-800 bg-surface-50-950/75 hover:border-primary-500 block rounded-lg border p-5 transition-colors"
				href={page.href}
				aria-label={page.title}
			>
				<h2 class="text-lg font-semibold">{page.title}</h2>
				<p class="text-surface-700-300 mt-3 text-sm leading-relaxed">{page.body}</p>
			</a>
		{/each}
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		A community project — the long-term dream is a full lab, but today it is a bus, and that is the point.
	</footer>
</main>
