<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Info } from '@lucide/svelte';
	import { Tooltip } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		label?: string;
		text?: string;
		children?: Snippet;
	}

	let { label = 'More information', text, children }: Props = $props();
</script>

<Tooltip openDelay={200} closeDelay={150} positioning={{ placement: 'top' }}>
	<Tooltip.Trigger
		class="text-surface-500 hover:text-primary-600 focus-visible:text-primary-600 inline-flex translate-y-[0.1em] items-center rounded-full align-baseline transition-colors"
		aria-label={label}
	>
		<Info class="h-[1em] w-[1em]" aria-hidden="true" />
	</Tooltip.Trigger>
	<Tooltip.Positioner class="z-50">
		<Tooltip.Content
			class="border-surface-300-700 bg-surface-50-950 text-surface-800-200 max-w-xs rounded-sm border px-3 py-2 text-sm leading-relaxed shadow-lg"
		>
			{#if children}
				{@render children()}
			{:else}
				{text}
			{/if}
		</Tooltip.Content>
	</Tooltip.Positioner>
</Tooltip>
