<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// `$bindable` controlled dialog. Demonstrates the two-way `bind:open`
	// contract: the parent owns the boolean `$state`, the child declares it
	// `$bindable(false)` and mirrors the library's `onOpenChange` back onto the
	// same prop so programmatic closes (clicking a nav link) and user-driven
	// closes (Esc / backdrop) both stay in sync. A `children` snippet fills the
	// body so this stays generic. Lifted from MassageIthaca's MobileMenuDrawer
	// (TIN-2225); Dialog usage mirrors site.scaffold's own +layout.svelte.
	//
	// Usage (in a parent component):
	//   let open = $state(false);
	//   <button onclick={() => (open = true)}>Open</button>
	//   <BindableDrawer bind:open title="Menu">
	//     {#snippet children()} … {/snippet}
	//   </BindableDrawer>
	import { X } from '@lucide/svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		title?: string;
		children?: Snippet;
	}

	let { open = $bindable(false), title = 'Menu', children }: Props = $props();
</script>

<Dialog
	{open}
	onOpenChange={(details: { open: boolean }) => {
		// Mirror the machine's state back onto the bindable prop so the parent
		// stays authoritative whether the close came from Esc, the backdrop, or code.
		open = details.open;
	}}
	closeOnInteractOutside
	closeOnEscape
	preventScroll
>
	<Dialog.Backdrop class="fixed inset-0 z-40 bg-black/40" />
	<Dialog.Positioner class="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw]">
		<Dialog.Content class="bg-surface-50-950 flex w-full flex-col">
			<header class="border-surface-200-800 flex items-center justify-between border-b px-4 py-3">
				<Dialog.Title class="font-mono text-sm font-semibold">{title}</Dialog.Title>
				<Dialog.CloseTrigger class="hover:bg-surface-200-800 rounded-sm p-2" aria-label="Close dialog">
					<X class="h-5 w-5" aria-hidden="true" />
				</Dialog.CloseTrigger>
			</header>
			<div class="flex-1 overflow-y-auto p-4">
				{@render children?.()}
			</div>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
