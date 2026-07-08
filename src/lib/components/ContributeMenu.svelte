<script lang="ts">
	// Floating "Contribute" affordance: one persistent, unobtrusive control that
	// gathers the project's three contribution paths (previously only scattered
	// "Donate a tool" links) into a single clickable menu. Mounted ONCE in
	// +layout.svelte so it rides every route.
	//
	// WAI-ARIA menu-button pattern, plus the prompt's explicit focus-trap:
	//   - trigger: aria-haspopup/expanded/controls; Enter/Space toggle;
	//     Arrow up/down open onto the last/first item.
	//   - open menu: focus lands on the first item; Arrow up/down + Home/End move;
	//     Tab/Shift+Tab are TRAPPED (wrap within the items) rather than tabbing
	//     out; Escape closes and returns focus to the trigger; a pointer press
	//     outside dismisses it.
	// Motion is reduced-motion-safe (MediaQuery gates the open/close duration to
	// zero), the panel is featured house glass (translucent + backdrop-blur, never
	// opaque), corners are sharp, and it never prints. Anchored bottom-left so it
	// never collides with the bottom-right Toast stack, and z-scaled at the
	// dropdown tier (below the sticky AppBar and Toasts), never an arbitrary 9999.
	import { tick } from 'svelte';
	import { scale } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import { base } from '$app/paths';
	import { HandHeart, Gift, Boxes, FilePlus, X } from '@lucide/svelte';

	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	// Collapse the open/close animation to an instant cut under reduced motion,
	// honoring the setting without branching the markup (contact-form idiom).
	const motionDuration = $derived(reducedMotion.current ? 0 : 160);

	let open = $state(false);
	let triggerEl: HTMLButtonElement | undefined = $state();
	let menuEl: HTMLDivElement | undefined = $state();

	const items = [
		{
			href: `${base}/donate`,
			icon: Gift,
			label: 'Donate a tool',
			desc: 'Give a tool the bus still needs.',
		},
		{
			href: `${base}/contact`,
			icon: Boxes,
			label: 'Propose a new cell',
			desc: 'Bring a kit, be its captain. Reach a keyholder.',
		},
		{
			href: `${base}/cells/new`,
			icon: FilePlus,
			label: 'Write a cell doc',
			desc: 'Fill a short form, get a ready-to-commit file.',
		},
	];

	function menuItems(): HTMLAnchorElement[] {
		return menuEl ? Array.from(menuEl.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')) : [];
	}

	function focusItem(index: number) {
		const els = menuItems();
		if (els.length === 0) return;
		const wrapped = ((index % els.length) + els.length) % els.length;
		els[wrapped]?.focus();
	}

	async function openMenu(focus: 'first' | 'last' = 'first') {
		open = true;
		await tick(); // let the panel mount before moving focus into it
		focusItem(focus === 'last' ? -1 : 0);
	}

	function closeMenu({ returnFocus = true } = {}) {
		if (!open) return;
		open = false;
		if (returnFocus) triggerEl?.focus();
	}

	function toggle() {
		if (open) closeMenu({ returnFocus: false });
		else openMenu();
	}

	function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (open) focusItem(event.key === 'ArrowUp' ? -1 : 0);
			else openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
		}
	}

	function onMenuKeydown(event: KeyboardEvent) {
		const els = menuItems();
		const current = els.indexOf(document.activeElement as HTMLAnchorElement);
		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				closeMenu();
				break;
			case 'ArrowDown':
				event.preventDefault();
				focusItem(current + 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				focusItem(current - 1);
				break;
			case 'Home':
				event.preventDefault();
				focusItem(0);
				break;
			case 'End':
				event.preventDefault();
				focusItem(els.length - 1);
				break;
			case 'Tab':
				// Focus trap: keep Tab and Shift+Tab cycling within the items.
				event.preventDefault();
				focusItem(current + (event.shiftKey ? -1 : 1));
				break;
		}
	}

	// While open, a pointer press anywhere outside the trigger or panel dismisses.
	$effect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (triggerEl?.contains(target) || menuEl?.contains(target)) return;
			closeMenu({ returnFocus: false });
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});
</script>

<div class="contribute-fab print:hidden">
	{#if open}
		<div
			bind:this={menuEl}
			id="contribute-menu"
			role="menu"
			tabindex="-1"
			aria-label="Ways to contribute to the tool bus"
			class="contribute-panel border-surface-200-800 w-72 max-w-[calc(100vw-2rem)] border shadow-xl"
			transition:scale={{ duration: motionDuration, start: 0.96, opacity: 0 }}
			onkeydown={onMenuKeydown}
		>
			<div class="border-surface-200-800 flex items-center justify-between gap-4 border-b px-4 py-2.5">
				<p class="text-surface-500 text-xs font-semibold tracking-widest uppercase">Pitch in</p>
				<button
					type="button"
					class="hover:bg-surface-200-800 -mr-1.5 p-1.5 transition-colors"
					aria-label="Close contribute menu"
					onclick={() => closeMenu()}
				>
					<X class="h-4 w-4" aria-hidden="true" />
				</button>
			</div>
			<ul class="py-1">
				{#each items as item (item.href)}
					{@const Icon = item.icon}
					<li>
						<a
							role="menuitem"
							tabindex="-1"
							href={item.href}
							class="hover:bg-surface-100-900 focus-visible:bg-surface-100-900 flex items-start gap-3 px-4 py-3 transition-colors"
							onclick={() => closeMenu({ returnFocus: false })}
						>
							<Icon class="text-primary-500 mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
							<span class="min-w-0">
								<span class="block text-sm font-semibold">{item.label}</span>
								<span class="text-surface-600-400 block text-xs leading-snug">{item.desc}</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<button
		bind:this={triggerEl}
		type="button"
		class="contribute-trigger bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="contribute-menu"
		onclick={toggle}
		onkeydown={onTriggerKeydown}
	>
		{#if open}
			<X class="h-4 w-4" aria-hidden="true" />
			<span>Close</span>
		{:else}
			<HandHeart class="h-4 w-4" aria-hidden="true" />
			<span>Contribute</span>
		{/if}
	</button>
</div>

<style>
	/* Dropdown-tier fixed affordance, anchored bottom-left so it clears both the
	   sticky AppBar (top) and the bottom-right Toast stack. flex-col-reverse pins
	   the trigger to the bottom and grows the panel upward from the same corner.
	   --z-dropdown sits below the sticky AppBar, the mobile drawer, and Toasts on
	   the semantic z-index scale in app.css: a coherent ladder, not an arbitrary
	   9999. */
	.contribute-fab {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		z-index: var(--z-dropdown);
		display: flex;
		flex-direction: column-reverse;
		align-items: flex-start;
		gap: 0.75rem;
	}

	@media (min-width: 768px) {
		.contribute-fab {
			bottom: 1.5rem;
			left: 1.5rem;
		}
	}

	/* Never print the floating affordance. The `print:hidden` utility on the
	   element is out-specified by the scoped `.contribute-fab { display: flex }`
	   above (media queries add no specificity), so hide it here where the
	   selectors match. */
	@media print {
		.contribute-fab {
			display: none !important;
		}
	}

	/* Featured house glass: translucent surface + a strong backdrop blur, never
	   opaque. Mirrors the .saturn-nav treatment. The blur is heavy enough to
	   dissolve busy content (e.g. the home hero's large serif) into a soft wash so
	   the menu's small description text always clears AA contrast; the non-blur
	   fallback is near-solid for the same reason. */
	.contribute-panel {
		background: color-mix(in oklch, var(--color-surface-50) 94%, transparent);
		transform-origin: bottom left;
	}
	:global([data-mode='dark']) .contribute-panel {
		background: color-mix(in oklch, var(--color-surface-950) 94%, transparent);
	}
	@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
		.contribute-panel {
			background: color-mix(in oklch, var(--color-surface-50) 85%, transparent);
			backdrop-filter: blur(24px) saturate(160%);
			-webkit-backdrop-filter: blur(24px) saturate(160%);
		}
		:global([data-mode='dark']) .contribute-panel {
			background: color-mix(in oklch, var(--color-surface-950) 85%, transparent);
		}
	}

	/* A faint primary top edge ties the panel to the brand chrome (saturn ring). */
	.contribute-panel {
		border-top: 2px solid color-mix(in oklch, var(--color-primary-500) 45%, transparent);
	}
</style>
