<script lang="ts">
	// TIN-3440 slice S5. Placeholder copy in the published:false/TODO posture —
	// this page is only ever reached from a receipt email, which cannot exist
	// before the mail handler ships; copy review lands with intake opening.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Withdraw your application — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="withdraw">
	<h1>Withdraw your application</h1>

	{#if form && 'withdrawn' in form}
		<p>Your application has been withdrawn. You are welcome to apply again any time.</p>
	{:else if data.token === null}
		<p>This link is incomplete. Please use the withdrawal link from your receipt email.</p>
	{:else}
		{#if form && 'code' in form && form.code === 'not_withdrawable'}
			<p role="alert">This application has already been decided, so it can no longer be withdrawn.</p>
		{:else if form && 'code' in form}
			<p role="alert">This link is no longer valid. It may have already been used.</p>
		{:else}
			<p>Confirm to withdraw your membership application. This cannot be undone.</p>
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
				{submitting ? 'Withdrawing…' : 'Withdraw my application'}
			</button>
		</form>
	{/if}
</main>

<style>
	.withdraw {
		max-width: 42rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
</style>
