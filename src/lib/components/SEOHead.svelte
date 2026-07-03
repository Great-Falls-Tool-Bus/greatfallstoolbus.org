<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// Typed SEO head component. Demonstrates the three rune idioms that are house
	// canon for every Tinyland brand site:
	//   1. a typed `interface Props` (no `any`, explicit optionals),
	//   2. `$props()` with literal defaults destructured from that interface,
	//   3. `$derived.by(() => …)` for the multi-statement canonical-URL
	//      normalization — NOT a `$derived` arrow-thunk (banned; see eslint.config.ts).
	// Lifted from MassageIthaca's production SEOHead (TIN-2225). Copy this shape
	// for any site's <svelte:head>; never hand-roll ad-hoc inline meta blocks.
	//
	// NOTE vs. MassageIthaca: MI is SSR (adapter-node) and gates `noindex` on the
	// live request host. greatfallstoolbus.org is fully prerendered (adapter-static), so a
	// host check would bake noindex into the static HTML at build time. We honor
	// the explicit `noindex` prop ONLY and read just `page.url.pathname` (stable
	// per-route during prerender) for the canonical path.
	import { page } from '$app/state';

	interface Props {
		title: string;
		description: string;
		keywords?: string;
		image?: string;
		imageAlt?: string;
		noindex?: boolean;
		canonical?: string | undefined;
		canonicalBasePath?: string;
		ogType?: string;
		siteName?: string;
		/** Production origin used to build the canonical URL when no explicit `canonical` is given. */
		origin?: string;
		/** Optional JSON-LD object; serialized into a single application/ld+json <script>. */
		jsonLd?: Record<string, unknown> | null;
	}

	let {
		title,
		description,
		keywords = '',
		image = '',
		imageAlt = '',
		noindex = false,
		canonical = undefined,
		canonicalBasePath = '',
		ogType = 'website',
		siteName = 'greatfallstoolbus.org',
		origin = 'https://greatfallstoolbus.org',
		jsonLd = null,
	}: Props = $props();

	const canonicalPath = $derived.by(() => {
		if (!canonicalBasePath) return page.url.pathname;
		if (page.url.pathname === canonicalBasePath) return '/';
		if (page.url.pathname.startsWith(`${canonicalBasePath}/`)) {
			return page.url.pathname.slice(canonicalBasePath.length);
		}
		return page.url.pathname;
	});

	// Expression derivation → `$derived(expr)`. Build the full canonical URL from
	// the current route path unless an explicit one was supplied. GitHub Pages
	// fallback builds use a project-path `base`; canonical URLs still point at the
	// production origin and must not include that hosting prefix.
	const canonicalUrl = $derived(canonical || `${origin}${canonicalPath}`);

	// Explicit-only robots gate (see header note on prerender).
	const shouldNoindex = $derived(noindex);

	// Multi-statement normalization → MUST use `$derived.by(() => …)`. A bare
	// `$derived` arrow-thunk would store the *function* as the value, not the
	// normalized string — that is the banned anti-pattern this file models against.
	const normalizedCanonical = $derived.by(() => {
		const url = canonicalUrl;
		try {
			const parsed = new URL(url);
			let pathname = parsed.pathname;
			if (pathname !== '/' && pathname.endsWith('/')) {
				pathname = pathname.slice(0, -1);
			} else if (pathname === '/') {
				pathname = '';
			}
			// Canonical URLs drop the hash fragment but keep query params.
			return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
		} catch {
			return url.replace(/\/$/, '');
		}
	});

	// Serialize JSON-LD once; escape every `<` so an embedded closing-script
	// sentinel in the data cannot terminate the inline block early.
	const jsonLdScript = $derived.by(() => {
		if (!jsonLd) return null;
		return JSON.stringify(jsonLd).replace(/</g, '\\u003c');
	});
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	{#if keywords}
		<meta name="keywords" content={keywords} />
	{/if}

	<link rel="canonical" href={normalizedCanonical} />

	<meta property="og:type" content={ogType} />
	<meta property="og:url" content={normalizedCanonical} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	{#if image}
		<meta property="og:image" content={image} />
		<meta property="og:image:alt" content={imageAlt} />
	{/if}
	<meta property="og:site_name" content={siteName} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	{#if image}
		<meta name="twitter:image" content={image} />
		<meta name="twitter:image:alt" content={imageAlt} />
	{/if}

	{#if shouldNoindex}
		<meta name="robots" content="noindex, nofollow" />
	{:else}
		<meta name="robots" content="index, follow" />
	{/if}

	{#if jsonLdScript}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- serialized JSON-LD; the </script> sentinel is escaped above -->
		{@html `<script type="application/ld+json">${jsonLdScript}</` + `script>`}
	{/if}
</svelte:head>
