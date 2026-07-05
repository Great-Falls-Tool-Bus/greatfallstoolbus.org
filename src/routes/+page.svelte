<script lang="ts">
	import { base } from '$app/paths';
	// Real-data trust strip (lane B mandate): counts come from $lib/data/cells,
	// the exact module /tools, /cells, and /wants already import from, globbed
	// at build time from the src/content/tools/**/*.svx tree. No invented
	// numbers; if the tree changes, these change with it.
	import { cells, wants } from '$lib/data/cells';
	import { creditFor } from '$lib/data/credits';
	import Picture from '$lib/components/Picture.svelte';
	import SourceLink from '$lib/components/SourceLink.svelte';
	import { reveal, parallax } from '$lib/motion.svelte';

	// Full-bleed blurred + parallax hero backdrop: the Tichnor Bros. c.1930s linen
	// postcard of the Great Falls gorge and the namesake Lewiston mill + smokestack
	// (Boston Public Library, Tichnor Brothers Collection no. 69902, public
	// domain). Cropped to the image area, run through the house image pipeline, and
	// rendered edge-to-edge behind a translucent "featured glass" panel. The
	// parallax is reduced-motion-safe (see $lib/motion). Provenance in
	// $lib/data/credits.
	const heroImage = '/photos/great-falls-lewiston-1930s.jpg';
	const heroCredit = creditFor(heroImage);

	const brand = {
		name: 'Great Falls Tool Bus',
		domain: 'greatfallstoolbus.org',
		tagline: 'This is a bus, the shop comes later :)',
		blurb:
			'A shared tool library on wheels for Lewiston-Auburn, Maine. We kit them for transport and lend them to neighbors who ask.',
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

	const toolCount = cells.reduce((sum, cell) => sum + cell.tools.length, 0);
	const cellCount = cells.length;
	const wantCount = wants.length;

	const stats = [
		{ value: toolCount, label: toolCount === 1 ? 'tool kitted & documented' : 'tools kitted & documented' },
		{ value: cellCount, label: cellCount === 1 ? 'tool cell' : 'tool cells' },
		{ value: wantCount, label: wantCount === 1 ? 'tool still wanted' : 'tools still wanted' },
	];

	// Primary tier: the 2-3 asks a Lewiston neighbor actually needs (lane B
	// punch list: Tools, Donate a tool, Access/Contact), elevated above the
	// rest so the page stops reading as a flat sitemap.
	const primaryPages = [
		{
			eyebrow: 'Browse the kit',
			title: 'Tools on the bus',
			body: `${toolCount} tools across ${cellCount} ${cellCount === 1 ? 'cell' : 'cells'}, kitted and documented.`,
			href: `${base}/tools`,
		},
		{
			eyebrow: 'Give a tool',
			title: 'Donate a tool',
			body: 'The criteria below, in checklist form.',
			href: `${base}/donate`,
		},
		{
			eyebrow: 'Get access',
			title: 'Access & contact',
			body: 'How access works, and how to reach a keyholder directly.',
			href: `${base}/contact#access`,
		},
	];
</script>

<svelte:head>
	<title>Great Falls Tool Bus: a shared tool library on wheels for Lewiston-Auburn, Maine</title>
	<meta name="description" content={brand.blurb} />
</svelte:head>

<main class="mx-auto max-w-5xl px-6 pb-16 md:pb-24">
	<!-- Full-bleed parallax falls hero (TIN-2419). The band escapes the content
	     column to 100vw and sits flush under the AppBar; the blurred, gently
	     parallaxed Tichnor postcard fills it edge-to-edge behind a translucent
	     "featured glass" panel. One intentional full-bleed treatment: zero radius,
	     no card. Parallax is reduced-motion-safe (static under prefers-reduced-
	     motion), and the glass fill keeps every text token >= 4.5:1 in both modes. -->
	<section class="hero-band">
		<div class="hero-band__media" aria-hidden="true">
			<div class="hero-band__parallax" use:parallax={{ speed: 0.18 }}>
				<Picture
					src={heroImage}
					alt=""
					loading="eager"
					decoding="sync"
					sizes="100vw"
					class="h-full w-full object-cover object-center"
				/>
			</div>
			<div class="hero-band__scrim"></div>
		</div>

		<div class="hero-band__inner mx-auto max-w-5xl px-6 py-16 md:py-24 lg:py-28">
			<header class="hero-glass max-w-3xl space-y-4 p-6 md:p-8">
				<p class="hero-eyebrow text-xs tracking-widest uppercase">
					{brand.name} · Lewiston-Auburn, Maine
				</p>
				<h1 class="font-display text-4xl md:text-5xl">A shared tool library & whatnot</h1>
				<p class="hero-tagline text-xl">{brand.tagline}</p>
				<p class="hero-blurb text-lg leading-relaxed">{brand.blurb}</p>

				<div class="flex flex-wrap items-center gap-3 pt-2">
					<a
						href={`${base}/donate`}
						class="bg-primary-500 hover:bg-primary-600 inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white transition-colors"
						>Donate a tool</a
					>
					<a
						href={`${base}/contact#access`}
						class="border-primary-600 text-primary-800 hover:bg-primary-500/10 dark:border-primary-400 dark:text-primary-200 inline-flex items-center justify-center border px-6 py-3 text-sm font-semibold transition-colors"
						>How access works</a
					>
					<a
						href={`${base}/tools`}
						class="hero-blurb hover:text-primary-800 dark:hover:text-primary-200 inline-flex items-center px-1 py-3 text-sm font-semibold underline-offset-4 hover:underline"
						>Browse the kit &rarr;</a
					>
				</div>

				<div class="hero-divider mt-6 flex flex-wrap gap-x-8 gap-y-2 pt-6" aria-label="What's on the bus right now">
					{#each stats as stat (stat.label)}
						<p class="text-sm">
							<span class="hero-stat font-display text-2xl">{stat.value}</span>
							<span class="hero-stat-label ml-1">{stat.label}</span>
						</p>
					{/each}
				</div>
			</header>
		</div>
	</section>

	<!-- Hero image credit (TIN-2419): the falls backdrop is a decorative,
	     aria-hidden full-bleed layer, so it carries no figure/figcaption of its
	     own. This quiet caption surfaces the same provenance the mission tool-plate
	     figcaption does (title, author, license, source), resolved from
	     $lib/data/credits, plus a note of our own crop. -->
	<p class="text-surface-600-400 mt-4 text-sm leading-relaxed">
		Hero image: {heroCredit?.title ?? 'The Falls and Old Man, Auburn and Lewiston, Maine'}
		{#if heroCredit}
			<span>
				, {heroCredit.author}. {heroCredit.license}.
				<a class="underline underline-offset-4" href={heroCredit.source} target="_blank" rel="noopener noreferrer"
					>Source</a
				>. Cropped to the image area (postcard caption, catalog number, and card margins removed) and optimized for the
				web.
			</span>
		{/if}
	</p>

	<!-- Uncontained editorial criteria: each is a hairline-divided term/description
	     row (dl), not a boxed card. Reads as one continuous page. -->
	<section class="mt-16" aria-label="Shared-tool criteria">
		<h2 class="text-2xl font-semibold">What makes a good bus tool</h2>
		<dl class="mt-8">
			{#each criteria as item, i (item.title)}
				<div
					class="border-surface-200-800 reveal-armed grid gap-x-8 gap-y-2 border-t py-6 md:grid-cols-[14rem_1fr]"
					use:reveal={{ delay: i * 70 }}
				>
					<dt class="text-lg font-semibold">{item.title}</dt>
					<dd class="text-surface-700-300 leading-relaxed">{item.body}</dd>
				</div>
			{/each}
		</dl>
	</section>

	<section class="border-surface-200-800 reveal-armed mt-16 border-y py-8" use:reveal aria-label="How access works">
		<h2 class="text-2xl font-semibold">Getting on the bus</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 max-w-3xl leading-relaxed">
			Anyone can ask to borrow: no membership fee, no paperwork wall. Reach out and a keyholder answers. Keyholders
			review each request and share the bus location directly. See
			<a class="underline" href={`${base}/contact#find-the-bus`}>where to find the bus</a>, then start on the
			<a class="underline" href={`${base}/contact`}>contact / join page</a>.
		</p>
	</section>

	<!-- Uncontained editorial index: hairline-divided link rows with a sentence-case
	     kicker (not another tiny-uppercase eyebrow, so cadence varies here), a lead
	     title, and a nudging arrow. No card grid. -->
	<section class="reveal-armed mt-16" use:reveal aria-label="Where to start">
		<h2 class="text-2xl font-semibold">Where to start</h2>
		<ul class="mt-8">
			{#each primaryPages as p (p.title)}
				<li>
					<a href={p.href} class="group border-surface-200-800 flex items-baseline justify-between gap-6 border-t py-6">
						<span class="min-w-0">
							<span class="text-surface-600-400 text-sm">{p.eyebrow}</span>
							<span class="group-hover:text-primary-600 mt-1 block text-xl font-semibold transition-colors"
								>{p.title}</span
							>
							<span class="text-surface-700-300 mt-1 block leading-relaxed">{p.body}</span>
						</span>
						<span class="text-primary-600 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true"
							>&rarr;</span
						>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<footer class="text-surface-500 pt-16 text-sm">
		<SourceLink routeId="/" />
	</footer>
</main>

<style>
	/* ===== Full-bleed parallax falls hero (TIN-2419) =====
	   One intentional edge-to-edge treatment behind the home hero: the blurred
	   Tichnor postcard with a subtle, reduced-motion-safe parallax, a translucent
	   "featured glass" panel over it, and zero border-radius (house canon). */
	.hero-band {
		position: relative;
		isolation: isolate;
		width: 100vw;
		/* Break out of the centered content column to the full viewport. `html`
		   carries `overflow-x: clip`, so a 100vw child never adds a horizontal
		   scrollbar (the overflow e2e guard stays green). */
		margin-left: calc(50% - 50vw);
		overflow: hidden;
		/* Body-background tint per mode; drives every scrim mix below so the
		   light/dark switch is declared once (native light-dark(), keyed off the
		   color-scheme that data-mode sets). */
		--hero-tint: light-dark(var(--color-surface-50), var(--color-surface-950));
	}

	.hero-band__media {
		position: absolute;
		inset: 0;
		z-index: 0;
		overflow: hidden;
	}

	/* Blurred backdrop layer. Over-scans the band (20% block for parallax slack,
	   8% inline to bury the blur fringe) so the clipped band edges never reveal the
	   soft transparent edge of the blur. `use:parallax` translates this on scroll
	   and is a no-op under prefers-reduced-motion, leaving a static image. */
	.hero-band__parallax {
		position: absolute;
		inset: -20% -8%;
		filter: blur(10px);
		will-change: transform;
	}

	/* Atmosphere + blend scrim. The vertical layer tucks the band under the glass
	   AppBar and fades it into the body below; the horizontal layer weights the
	   tint toward the text side (left) and lets the mill + smokestack breathe on
	   the right. Contrast itself is guaranteed by the glass fill, not this scrim. */
	.hero-band__scrim {
		position: absolute;
		inset: 0;
		z-index: 1;
		background:
			linear-gradient(
				180deg,
				color-mix(in oklch, var(--hero-tint) 32%, transparent) 0%,
				transparent 20%,
				transparent 68%,
				color-mix(in oklch, var(--hero-tint) 55%, transparent) 100%
			),
			linear-gradient(
				100deg,
				color-mix(in oklch, var(--hero-tint) 46%, transparent) 0%,
				color-mix(in oklch, var(--hero-tint) 28%, transparent) 55%,
				color-mix(in oklch, var(--hero-tint) 10%, transparent) 100%
			);
	}

	.hero-band__inner {
		position: relative;
		z-index: 2;
	}

	/* Featured glass: translucent, frosted, never opaque, zero radius. The 68%
	   (light) / 74% (dark) surface fill keeps every hero text token >= 4.5:1
	   against BOTH the darkest and the brightest blurred pixel behind it, in both
	   modes (verified: light worst 5.23:1, dark worst 4.98:1), while a quarter of
	   the falls still reads through the frost. */
	.hero-glass {
		background: light-dark(
			color-mix(in oklch, var(--color-surface-50) 68%, transparent),
			color-mix(in oklch, var(--color-surface-950) 74%, transparent)
		);
		border: 1px solid
			light-dark(
				color-mix(in oklch, var(--color-surface-950) 12%, transparent),
				color-mix(in oklch, var(--color-surface-50) 14%, transparent)
			);
		box-shadow: 0 1px 30px light-dark(rgba(40, 26, 14, 0.1), rgba(0, 0, 0, 0.38));
	}

	@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
		.hero-glass {
			backdrop-filter: blur(10px) saturate(118%);
			-webkit-backdrop-filter: blur(10px) saturate(118%);
		}
	}

	/* Hero text tokens. Colors are pinned to the AA-verified stops above and
	   switch by mode via light-dark(); the theme ink already handles h1. */
	.hero-eyebrow {
		color: light-dark(var(--color-surface-700), var(--color-surface-300));
	}
	.hero-tagline {
		color: light-dark(var(--color-primary-800), var(--color-primary-300));
	}
	.hero-blurb {
		color: light-dark(var(--color-surface-800), var(--color-surface-200));
	}
	.hero-stat {
		color: light-dark(var(--color-primary-800), var(--color-primary-300));
	}
	.hero-stat-label {
		color: light-dark(var(--color-surface-700), var(--color-surface-300));
	}
	.hero-divider {
		border-top: 1px solid
			light-dark(
				color-mix(in oklch, var(--color-surface-950) 16%, transparent),
				color-mix(in oklch, var(--color-surface-50) 18%, transparent)
			);
	}

	/* Print: the spec-sheet stays ink-on-white, so drop the whole photographic band
	   so no dark scrim or postcard bleeds into a printed page. */
	@media print {
		.hero-band__media {
			display: none !important;
		}
		.hero-glass {
			background: none !important;
			border: 0 !important;
			box-shadow: none !important;
			backdrop-filter: none !important;
			-webkit-backdrop-filter: none !important;
			padding: 0 !important;
		}
	}

	/* Reduced motion: belt-and-braces. The parallax action already no-ops, but
	   also drop the will-change hint so nothing is promoted needlessly. */
	@media (prefers-reduced-motion: reduce) {
		.hero-band__parallax {
			will-change: auto;
		}
	}
</style>
