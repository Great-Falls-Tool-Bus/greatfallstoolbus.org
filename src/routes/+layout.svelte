<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { Menu, Smartphone, X } from '@lucide/svelte';
	import BusMark from '$lib/components/BusMark.svelte';
	import Wordmark from '$lib/components/Wordmark.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { AppBar, Dialog, Navigation, Portal, Toast } from '@skeletonlabs/skeleton-svelte';
	import { TinyVectors } from '@tummycrypt/tinyvectors';
	import '../app.css';
	import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import { buildSha, buildShaShort } from '$lib/build-info';
	import { toaster } from '$lib/toaster';
	import { theme } from '$lib/theme.svelte';
	import { primaryNavItems, footerNavGroups, isActivePath } from '$lib/nav-items';

	let { children } = $props();

	let mobileOpen = $state(false);

	// TinyVectors device-motion permission handshake (operator ruling
	// 2026-08-31: the blobs must bounce and ask for motion access properly). The component itself already does the hard
	// part: on iOS Safari it leaves permissionState at 'prompt' and never
	// starts listening until requestDeviceMotionPermission() is called from a
	// user gesture; on Android/desktop it self-starts with no prompt; and
	// prefers-reduced-motion is honored internally (respectReducedMotion
	// defaults true, and DeviceMotion.initialize()/requestPermission() both
	// refuse to listen while the media query matches). All this layout needs
	// to add is the gesture: an unobtrusive control that only renders when the
	// bound instance reports iOS actually needs one.
	let tinyVectorsRef: ReturnType<typeof TinyVectors> | undefined = $state();
	// Capability half of the gate: true only where the browser actually gates
	// device motion behind an explicit request (iOS Safari). Sampled once at
	// mount because it is pure feature detection and cannot change afterwards.
	let motionControlAvailable = $state(false);
	// Preference half of the gate, kept live: a visitor who turns on Reduce
	// Motion after load must lose the control, not be left tapping a button
	// the component will refuse.
	let reducedMotion = $state(false);
	let motionPromptDismissed = $state(false);
	let motionPromptBusy = $state(false);

	const showMotionPrompt = $derived(motionControlAvailable && !reducedMotion && !motionPromptDismissed);

	async function handleRequestDeviceMotion() {
		if (!tinyVectorsRef || motionPromptBusy) return;
		motionPromptBusy = true;
		try {
			await tinyVectorsRef.requestDeviceMotionPermission();
		} finally {
			motionPromptBusy = false;
			// Hide after the first tap regardless of outcome (granted or
			// denied). iOS only lets you ask once per session anyway, and
			// leaving a dead control up is worse than a missed re-ask.
			motionPromptDismissed = true;
		}
	}

	onMount(() => {
		// Hydrate the theme store from localStorage so the color-mode slider
		// reflects the persisted choice on reload (the app.html FOUC script sets
		// the DOM attributes pre-paint, but the reactive store still needs to
		// catch up, otherwise the switch reads its default state after a refresh).
		theme.init();

		// Cancel the reveal fail-open timer (see src/app.html): hydration
		// succeeded, so `use:reveal` will run and no forced un-hide is needed.
		const w = window as unknown as { __gftbRevealFailsafe?: ReturnType<typeof setTimeout> };
		if (w.__gftbRevealFailsafe) clearTimeout(w.__gftbRevealFailsafe);

		// Never prompt on load: only reveal the control when (a) this browser
		// actually gates device motion behind an explicit permission request
		// (iOS Safari) and (b) the visitor hasn't asked for reduced motion, in
		// which case device motion would be inert even if granted.
		// requiresPermission/supported are both derived synchronously from
		// capability detection, not from the component's own async device-motion
		// init effect, so this is safe to read the instant the ref is bound
		// (no race against TinyVectors' own mount-time DeviceMotion setup).
		const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = reducedMotionQuery.matches;
		const handleReducedMotionChange = () => {
			reducedMotion = reducedMotionQuery.matches;
		};
		reducedMotionQuery.addEventListener('change', handleReducedMotionChange);

		if (tinyVectorsRef) {
			const status = tinyVectorsRef.getDeviceMotionStatus();
			motionControlAvailable = status.requiresPermission && status.supported;
		}

		return () => {
			reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
		};
	});

	// Single source of truth for nav (see $lib/nav-items). Base-stripped
	// pathname so active-state works at root (CF Pages) and under the
	// github.io project-path fallback alike.
	const currentPath = $derived(page.url.pathname.slice(base.length) || '/');

	const SITE_NAME = 'Great Falls Tool Bus';
	const SITE_URL = 'https://greatfallstoolbus.org';
	const GITHUB_PAGES_BASE = '/greatfallstoolbus.org';
	const SITE_TITLE = 'Great Falls Tool Bus: a shared tool library on wheels for Lewiston-Auburn, Maine';
	const SITE_DESCRIPTION =
		'A shared tool library on wheels for Lewiston-Auburn, Maine. Browse the kit, donate a tool, or reach out to borrow.';
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
	<!-- TinyVectors warm Tinyland background. Browser-only: the component uses
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
				bind:this={tinyVectorsRef}
				theme="custom"
				colors={['#cb6738', '#d99d6a', '#a14a52', '#6b4f3a', '#3d6b8c']}
				opacity={0.1}
				blobCount={5}
				enableScrollPhysics={true}
				enableDeviceMotion={true}
			/>
		</div>
		{#if showMotionPrompt}
			<button
				type="button"
				class="hover:bg-primary-600 bg-primary-500 fixed bottom-4 left-4 z-(--z-tooltip) inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full px-4 py-2 text-left text-sm font-semibold text-white shadow-lg transition-colors disabled:opacity-60"
				onclick={handleRequestDeviceMotion}
				disabled={motionPromptBusy}
				aria-label="Let the blobs feel the phone move"
			>
				<Smartphone class="h-4 w-4" aria-hidden="true" />
				<span>Let the blobs feel your phone move</span>
			</button>
		{/if}
	{/if}
	<a
		href="#content"
		class="focus:bg-primary-500 sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-tooltip) focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
		>Skip to content</a
	>

	<AppBar class="saturn-nav sticky top-0 z-(--z-sticky)">
		<AppBar.Toolbar class="grid-cols-[minmax(0,auto)_1fr_auto] px-4 py-2">
			<AppBar.Lead>
				<a
					href={`${base}/`}
					class="hover:text-primary-500 inline-flex min-w-0 items-center gap-2 text-sm whitespace-nowrap transition-colors sm:text-lg"
					aria-label={SITE_NAME + ' home'}
				>
					<BusMark decorative class="text-primary-500 h-[1.15em] w-[1.15em]" />
					<Wordmark text={SITE_NAME} class="truncate" /></a
				>
			</AppBar.Lead>
			<AppBar.Headline></AppBar.Headline>
			<AppBar.Trail>
				<nav class="hidden items-center gap-4 text-sm lg:flex" aria-label="Section navigation">
					{#each primaryNavItems as item (item.href)}
						{@const active = isActivePath(currentPath, item.match)}
						<a
							href={`${base}${item.href}`}
							class="nav-underline hover:text-primary-500 inline-flex items-center gap-1.5 transition-colors {active
								? 'text-primary-600 font-semibold'
								: ''}"
							aria-current={active ? 'page' : undefined}
							aria-label={item.label}
						>
							{item.label}</a
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
					<Dialog.Trigger class="hover:bg-surface-200-800 p-2 lg:hidden" aria-label="Open navigation">
						<Menu class="h-5 w-5" />
					</Dialog.Trigger>
					<!-- Portal to <body>: Skeleton 5 dialogs (anatomy unchanged from v4) do not auto-portal, and the
					     saturn-nav backdrop-filter makes the AppBar the containing block
					     for fixed descendants (CSS Filter Effects 2). Rendered inline the
					     backdrop/positioner's inset resolved against the ~52px AppBar box,
					     so at mobile widths the open drawer collapsed to a strip behind
					     the page content. Portaled, `fixed inset-*` means the viewport
					     again and the drawer overlays everything at the modal tier. -->
					<Portal>
						<Dialog.Backdrop class="fixed inset-0 z-(--z-modal-backdrop) bg-black/40" />
						<Dialog.Positioner class="fixed inset-y-0 right-0 z-(--z-modal) flex w-72 max-w-[85vw]">
							<Dialog.Content class="bg-surface-50-950 flex w-full flex-col">
								<div class="border-surface-200-800 flex items-center justify-between border-b px-4 py-3">
									<span class="inline-flex items-center gap-2 text-sm">
										<BusMark decorative class="text-primary-500 h-[1.15em] w-[1.15em]" />
										<Wordmark text={SITE_NAME} />
									</span>
									<Dialog.CloseTrigger class="hover:bg-surface-200-800 p-2" aria-label="Close navigation">
										<X class="h-5 w-5" />
									</Dialog.CloseTrigger>
								</div>
								<Navigation layout="sidebar">
									<Navigation.Content>
										<Navigation.Menu>
											{#each primaryNavItems as item (item.href)}
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
					</Portal>
				</Dialog>
			</AppBar.Trail>
		</AppBar.Toolbar>
	</AppBar>

	<div id="content" class="flex-1">
		{@render children?.()}
	</div>

	<!-- Footer groups mirror $lib/nav-items's footerGroup metadata. Single-product
	     history (L72 Q3-A): the legacy marketing-tree footer groups (About, Get
	     involved incl. the hard-coded Stewards link (D13), and the Meta group's
	     AX/agent-index link) are gone along with their routes. `footerNavGroups`
	     is presently empty (see $lib/nav-items), so only the external GitHub/
	     Security links below survive; the each-block stays wired for when
	     member-tree nav items land. -->
	<footer class="site-footer border-surface-200-800 bg-surface-100-900/80 mt-16 border-t backdrop-blur-sm">
		<div class="container mx-auto grid gap-8 px-6 py-10 text-sm md:grid-cols-[2fr_1fr_1fr_1fr]">
			<div class="max-w-sm">
				<p class="text-surface-700-300">
					The Great Falls Tool Bus is an unincorporated community project in Lewiston-Auburn, Maine.
				</p>
				<p class="text-surface-500 mt-2 text-xs italic">Infrastructure built &amp; hosted in Lewiston, ME.</p>
				<!-- Build provenance: shown only for a real published container image, where
				     PUBLIC_BUILD_SHA is baked in (Justfile container recipes -> build-info.ts).
				     Degrades to nothing on local / adapter-static builds. The short sha links to
				     the exact source commit, whose GitHub "Verified" badge substantiates the note:
				     main is merged through GitHub, so its commits are signed by GitHub's web-flow
				     key (committer = GitHub), not the author's own key. -->
				{#if buildShaShort}
					<p class="text-surface-500 mt-2 text-xs">
						built from
						<ExternalLink
							href={`${REPO_URL}/commit/${buildSha}`}
							class="hover:text-primary-500 font-mono transition-colors"
							label={`source commit ${buildShaShort} on GitHub`}>{buildShaShort}</ExternalLink
						>, GitHub-verified
					</p>
				{/if}
			</div>
			{#each footerNavGroups as group (group.heading)}
				<nav aria-label={group.heading}>
					<p class="text-surface-500 text-xs tracking-widest uppercase">{group.heading}</p>
					<ul class="mt-3 space-y-2">
						{#each group.items as item (item.href)}
							<li>
								<a href={`${base}${item.href}`} class="hover:text-primary-500 transition-colors" aria-label={item.label}
									>{item.label}</a
								>
							</li>
						{/each}
					</ul>
				</nav>
			{/each}
			<nav aria-label="Meta">
				<p class="text-surface-500 text-xs tracking-widest uppercase">Meta</p>
				<ul class="mt-3 space-y-2">
					<li>
						<ExternalLink href={REPO_URL} class="hover:text-primary-500 transition-colors">GitHub</ExternalLink>
					</li>
					<li>
						<ExternalLink href={SECURITY_URL} class="hover:text-primary-500 transition-colors">Security</ExternalLink>
					</li>
				</ul>
			</nav>
		</div>
	</footer>

	<!-- The floating contribution affordance (ContributeMenu) that lived here
	     hard-coded /donate, /contact, and /cells/new — all deleted (L72 Q3-A).
	     Member contributions now happen inside the member app post-approval
	     (ADR 0014 §5), which does not exist on this public entry surface yet;
	     removed rather than repointed at nothing. -->

	<Toast.Group
		{toaster}
		class="fixed right-4 bottom-4 z-(--z-toast) flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3"
	>
		{#snippet children(toast)}
			<Toast {toast} class="border-surface-300-700 bg-surface-50-950 text-surface-900-50 border p-4 shadow-lg">
				<div class="flex items-start justify-between gap-3">
					<div class="space-y-1">
						{#if toast.title}
							<Toast.Title class="text-sm font-semibold">{toast.title}</Toast.Title>
						{/if}
						{#if toast.description}
							<Toast.Description class="text-surface-700-300 text-sm leading-relaxed">
								{toast.description}
							</Toast.Description>
						{/if}
					</div>
					<Toast.CloseTrigger class="hover:bg-surface-200-800 px-2 py-1 text-sm" aria-label="Dismiss notification">
						×
					</Toast.CloseTrigger>
				</div>
			</Toast>
		{/snippet}
	</Toast.Group>
</div>
