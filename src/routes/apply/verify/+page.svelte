<script lang="ts">
	// TIN-3440 slice S4. Placeholder copy in the published:false/TODO posture —
	// this page is only ever reached from a receipt email, which cannot exist
	// before the mail handler ships; copy review lands with intake opening.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Verify your email — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="verify">
	<h1>Verify your email</h1>

	{#if form && 'verified' in form}
		<p>Your address is verified. A keyholder will reply within three business days.</p>
	{:else if data.token === null}
		<p>This link is incomplete. Please use the verification link from your receipt email.</p>
	{:else}
		{#if form && 'code' in form}
			<p role="alert">This link is no longer valid. It may have expired or already been used.</p>
		{:else}
			<p>Confirm to verify the email address on your membership application.</p>
		{/if}
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
			<input type="hidden" name="token" value={data.token} />
			<button type="submit" disabled={submitting}>
				{submitting ? 'Verifying…' : 'Verify my email'}
			</button>
		</form>
	{/if}
</main>

<style>
	.verify {
		max-width: 42rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
</style>
