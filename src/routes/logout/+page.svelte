<script lang="ts">
	// TIN-3440 slice S12. MECHANICS ONLY: agent-drafted placeholder copy.
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Log out — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="logout">
	<h1>Log out</h1>

	{#if data.authenticated}
		<p>You are currently logged in.</p>
		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
		>
			<button type="submit" disabled={submitting}>
				{submitting ? 'Logging out…' : 'Log out'}
			</button>
		</form>
	{:else}
		<p>You are not logged in.</p>
	{/if}
</main>
