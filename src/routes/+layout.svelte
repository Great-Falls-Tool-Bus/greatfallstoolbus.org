<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { Menu, X } from '@lucide/svelte';
	import SaturnMark from '$lib/components/SaturnMark.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { AppBar, Dialog, Navigation } from '@skeletonlabs/skeleton-svelte';
	import { TinyVectors } from '@tummycrypt/tinyvectors';
	import '../app.css';
	import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';
	import { navItems, isActivePath } from '$lib/nav-items';

	let { children } = $props();

	let mobileOpen = $state(false);

	// Single source of truth for nav (see $lib/nav-items). Base-stripped
	// pathname so active-state works at root (CF Pages) and under the
	// github.io project-path fallback alike.
	const currentPath = $derived(page.url.pathname.slice(base.length) || '/');

	const SITE_NAME = 'Great Falls Tool Bus';
	const SITE_URL = 'https://greatfallstoolbus.org';
	const GITHUB_PAGES_BASE = '/greatfallstoolbus.org';
	const SITE_TITLE = 'Great Falls Tool Bus — a shared tool library on wheels for Lewiston-Auburn, Maine';
	const SITE_DESCRIPTION =
		'A shared tool library on wheels for Lewiston-Auburn, Maine. This is a bus; the shop comes later — donate tools, join the keyholders, browse the kit.';
	const REPO_URL = 'https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org';
	const SECURITY_URL = 'https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org/security/advisories/new';
	const OG_IMAGE = `${SITE_URL}/og-image.png`;

	const jsonLd = {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		'@id': `${SITE_URL}/#website`,
		url: SITE_URL,
		name: SITE_NAME,
		description: SITE_DESCRIPTION,
		inLanguage: 'en',
	};
</script>

<!-- House-canon SEO via the extracted <SEOHead> (TIN-2225). Per-page <title>
     blocks (e.g. +page.svelte) still override this layout-level default. -->
<SEOHead
	title={SITE_TITLE}
	description={SITE_DESCRIPTION}
	image={OG_IMAGE}
	imageAlt={SITE_TITLE}
	siteName={SITE_NAME}
	origin={SITE_URL}
	canonicalBasePath={GITHUB_PAGES_BASE}
	{jsonLd}
/>

<div class="relative flex min-h-screen flex-col bg-transparent">
	<!-- TinyVectors warm Tinyland background. Browser-only — the component uses
	     window/navigator APIs and Svelte effects that crash under SSR. Fixed
	     full-viewport, behind everything, low opacity. (TIN-801 phase 3.) -->
	{#if browser}
		<div
			class="pointer-events-none fixed inset-0 -z-10"
			style="overflow:hidden"
			aria-hidden="true"
			data-testid="brand-vectors-bg"
		>
			<TinyVectors
				theme="custom"
				colors={['#cb6738', '#d99d6a', '#a14a52', '#6b4f3a', '#3d6b8c']}
				opacity={0.1}
				blobCount={5}
				enableScrollPhysics={true}
				enableDeviceMotion={false}
			/>
		</div>
	{/if}
	<a
		href="#content"
		class="focus:bg-primary-500 sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
		>Skip to content</a
	>

	<AppBar class="saturn-nav sticky top-0 z-40">
		<AppBar.Toolbar class="grid-cols-[auto_1fr_auto] px-4 py-2">
			<AppBar.Lead>
				<a
					href={`${base}/`}
					class="hover:text-primary-500 font-mono text-lg font-bold tracking-tight whitespace-nowrap transition-colors inline-flex items-center gap-2"
					aria-label={SITE_NAME + ' home'}
				>
					<SaturnMark class="text-primary-500 h-[1.05em] w-[1.05em]" />{SITE_NAME}</a
				>
			</AppBar.Lead>
			<AppBar.Headline></AppBar.Headline>
			<AppBar.Trail>
				<nav class="hidden items-center gap-4 text-sm lg:flex" aria-label="Section navigation">
					{#each navItems as item (item.href)}
						{@const active = isActivePath(currentPath, item.match)}
						<a
							href={`${base}${item.href}`}
							class="hover:text-primary-500 transition-colors {active ? 'text-primary-500 font-semibold' : ''}"
							aria-current={active ? 'page' : undefined}
							aria-label={item.label}>{item.label}</a
						>
					{/each}
					<ThemeSwitcher />
				</nav>

				<!-- Mobile drawer -->
				<Dialog
					open={mobileOpen}
					onOpenChange={(d) => {
						mobileOpen = d.open;
					}}
					closeOnInteractOutside
					closeOnEscape
					preventScroll
				>
					<Dialog.Trigger class="hover:bg-surface-200-800 rounded-sm p-2 lg:hidden" aria-label="Open navigation">
						<Menu class="h-5 w-5" />
					</Dialog.Trigger>
					<Dialog.Backdrop class="fixed inset-0 z-40 bg-black/40" />
					<Dialog.Positioner class="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw]">
						<Dialog.Content class="bg-surface-50-950 flex w-full flex-col">
							<div class="border-surface-200-800 flex items-center justify-between border-b px-4 py-3">
								<span class="font-mono text-sm font-semibold">{SITE_NAME}</span>
								<Dialog.CloseTrigger class="hover:bg-surface-200-800 rounded-sm p-2" aria-label="Close navigation">
									<X class="h-5 w-5" />
								</Dialog.CloseTrigger>
							</div>
							<Navigation layout="sidebar">
								<Navigation.Content>
									<Navigation.Menu>
										{#each navItems as item (item.href)}
											<Navigation.TriggerAnchor
												href={`${base}${item.href}`}
												aria-current={isActivePath(currentPath, item.match) ? 'page' : undefined}
												onclick={() => {
													mobileOpen = false;
												}}
											>
												<Navigation.TriggerText>{item.label}</Navigation.TriggerText>
											</Navigation.TriggerAnchor>
										{/each}
									</Navigation.Menu>
								</Navigation.Content>
								<Navigation.Footer>
									<div class="flex w-full justify-center py-2">
										<ThemeSwitcher />
									</div>
								</Navigation.Footer>
							</Navigation>
						</Dialog.Content>
					</Dialog.Positioner>
				</Dialog>
			</AppBar.Trail>
		</AppBar.Toolbar>
	</AppBar>

	<div id="content" class="flex-1">
		{@render children?.()}
	</div>

	<footer class="border-surface-200-800 bg-surface-100-900/80 mt-16 border-t backdrop-blur-sm">
		<div class="container mx-auto flex flex-col gap-4 px-6 py-8 text-sm md:flex-row md:items-center md:justify-between">
			<p class="text-surface-700-300">
				The Great Falls Tool Bus is an unincorporated community project in Lewiston-Auburn, Maine. This is a bus; the
				shop comes later.
			</p>
			<nav class="flex flex-wrap gap-4" aria-label="Footer">
				<a href={`${base}/agent`} class="hover:text-primary-500 transition-colors">Agent AX</a>
				<a href={REPO_URL} target="_blank" rel="noopener" class="hover:text-primary-500 transition-colors">GitHub</a>
				<a href={SECURITY_URL} target="_blank" rel="noopener" class="hover:text-primary-500 transition-colors"
					>Security</a
				>
			</nav>
		</div>
	</footer>
</div>
