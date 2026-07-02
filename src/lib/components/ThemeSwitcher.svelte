<script lang="ts">
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { theme, type ColorMode } from '$lib/theme.svelte';

	let isOpen = $state(false);

	import { Sun, Moon, Monitor, type Icon as LucideIcon } from '@lucide/svelte';

	const MODES: { id: ColorMode; label: string; icon: typeof LucideIcon }[] = [
		{ id: 'light', label: 'Light', icon: Sun },
		{ id: 'dark', label: 'Dark', icon: Moon },
		{ id: 'system', label: 'System', icon: Monitor },
	];

	function handleOpenChange(details: { open: boolean }) {
		isOpen = details.open;
	}

	function selectMode(mode: ColorMode) {
		theme.setMode(mode);
		isOpen = false;
	}

	const TriggerIcon = $derived(MODES.find((m) => m.id === theme.mode)?.icon ?? Monitor);
</script>

<Popover
	open={isOpen}
	onOpenChange={handleOpenChange}
	positioning={{ placement: 'bottom-end', gutter: 8 }}
	closeOnInteractOutside
	closeOnEscape
>
	<Popover.Trigger
		class="bg-surface-100-900 text-primary-500 border-surface-300-700 hover:bg-surface-200-800 rounded-sm border p-2 text-base leading-none transition-colors"
		aria-label="Theme mode"
	>
		<span aria-hidden="true"><TriggerIcon class="h-4 w-4" /></span>
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner class="z-50">
			<Popover.Content class="bg-surface-50-950 border-surface-300-700 min-w-[180px] rounded-lg border py-2 shadow-lg">
				<p class="text-surface-500 px-3 py-1 text-xs font-semibold uppercase">Mode</p>
				{#each MODES as mode (mode.id)}
					{@const Icon = mode.icon}
					{@const active = theme.mode === mode.id}
					<button
						type="button"
						onclick={() => selectMode(mode.id)}
						aria-label={`Set color mode to ${mode.label}`}
						aria-pressed={active}
						class="hover:bg-surface-200-800 flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors {active
							? 'text-primary-500 font-semibold'
							: ''}"
					>
						<span class="flex items-center gap-2">
							<Icon class="h-4 w-4" aria-hidden="true" />
							{mode.label}
						</span>
						{#if active}
							<span aria-hidden="true">✓</span>
						{/if}
					</button>
				{/each}
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
