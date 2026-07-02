<script lang="ts">
	const people = [
		{
			name: 'Kate Pulham',
			role: 'Founding supporter',
			note: 'Whose backing turned the tool bus from an idea into a thing with wheels.',
		},
		{
			name: 'Joe',
			role: 'Alderman, Lewiston',
			note: 'Provides the bus a home on his property — the first stop on every route.',
		},
		{
			name: 'Alex',
			role: 'Founder',
			note: 'Started it. “This is a bus, the shop comes later” is the founding doctrine.',
		},
		{
			name: 'Jess Sullivan',
			role: 'Webmaster & mail admin',
			note: 'Runs this site and the keyholders mail infrastructure.',
		},
	];

	const friends = [
		{ name: 'The Portland makerspace community', note: 'Our nearest maker neighbors down the turnpike.' },
		{
			name: 'Ithaca Generator',
			note: 'The 501(c)(3) makerspace where Jess served as Membership Chair and 3D Printing Captain.',
		},
		{ name: 'Artisan’s Asylum', note: 'Whose “How to Make a Makerspace” tradition anchors our bibliography.' },
	];
</script>

<svelte:head>
	<title>Shout-outs — Great Falls Tool Bus</title>
	<meta name="description" content="The people and communities making the Great Falls Tool Bus real." />
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<header class="space-y-4">
		<h1 class="text-4xl leading-tight font-bold">Shout-outs</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			A tool bus is mostly people. These are the ones who made it real — plus the initial donors whose tools are already
			in the kits.
		</p>
	</header>

	<section class="mt-10 space-y-4" aria-label="People">
		{#each people as p (p.name)}
			<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
				<h2 class="text-lg font-semibold">{p.name}</h2>
				<p class="text-surface-500 text-xs tracking-widest uppercase">{p.role}</p>
				<p class="text-surface-700-300 mt-2 leading-relaxed">{p.note}</p>
			</div>
		{/each}
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="About Jess">
		<h2 class="text-2xl font-semibold">About the shop chops behind the site</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Jess has spent a decade inside community shops: Fabrication Laboratory Manager for the Landscape Architecture
			makerspace at Cornell CALS; Membership Chair and 3D Printing Captain at Ithaca Generator, teaching a traveling
			Fusion 360 class series across New York; and First Fellow at Plymouth State’s D&amp;M Makerspace, where she helped
			coordinate COVID-19 PPE manufacture with New England makerspaces including Artisan’s Asylum. She writes at
			<a class="underline" href="https://transscendsurvival.org" rel="external noopener">transscendsurvival.org</a>
			(mirrored at
			<a class="underline" href="https://jesssullivan.github.io" rel="external noopener">jesssullivan.github.io</a>).
		</p>
	</section>

	<section class="mt-12" aria-label="Friends">
		<h2 class="text-2xl font-semibold">Friends of the bus</h2>
		<div class="mt-6 space-y-3">
			{#each friends as f (f.name)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-4">
					<h3 class="font-semibold">{f.name}</h3>
					<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">{f.note}</p>
				</div>
			{/each}
		</div>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		The Great Falls Tool Bus is an unincorporated community project in Lewiston-Auburn, Maine.
	</footer>
</main>
