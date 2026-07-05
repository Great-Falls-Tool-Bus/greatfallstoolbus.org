<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	import { toaster } from '$lib/toaster';

	let { value, label = 'Copy address' } = $props<{
		value: string;
		label?: string;
	}>();

	let copied = $state(false);
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyAddress() {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			clearTimeout(resetTimer);
			resetTimer = setTimeout(() => {
				copied = false;
			}, 1600);
			toaster.success({
				title: 'Copied',
				description: value,
				duration: 2400,
			});
		} catch {
			toaster.error({
				title: 'Copy failed',
				description: 'Select and copy the address manually.',
				duration: 3600,
			});
		}
	}
</script>

<button
	type="button"
	class="border-surface-300-700 hover:bg-surface-200-800 inline-flex h-8 w-8 items-center justify-center rounded-sm border transition-colors"
	aria-label={`${label}: ${value}`}
	onclick={copyAddress}
>
	{#if copied}
		<Check class="text-success-600 h-4 w-4" aria-hidden="true" />
	{:else}
		<Copy class="h-4 w-4" aria-hidden="true" />
	{/if}
</button>
