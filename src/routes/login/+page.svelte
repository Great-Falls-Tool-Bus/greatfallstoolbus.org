<script lang="ts">
	// TIN-3440 slice S12. MECHANICS ONLY: every member-facing sentence on this
	// page is agent-drafted placeholder copy, shipped in the "published: false /
	// TODO" posture the lane's standing rules require — the operator words
	// final copy before this page is linked from anywhere public.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Log in — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="login">
	<h1>Log in</h1>

	{#if !data.available}
		<p>Login is not available right now. Please try again later.</p>
	{:else}
		{#if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'rate_limited'}
					Too many attempts from this connection just now. Please wait a bit and try again.
				{:else if form.code === 'membership_inactive'}
					This membership no longer has login access. Contact a keyholder for help.
				{:else if form.code === 'invalid'}
					Please enter your email address and password.
				{:else if form.code === 'login_unavailable'}
					Login is not available right now. Please try again later.
				{:else}
					<!-- TODO copy review: the one constant message for both an unknown
					     address and a wrong password — do not split this. -->
					We could not log you in with that email address and password.
				{/if}
			</p>
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
			<label>
				Email address
				<input name="identifier" type="email" required autocomplete="username" />
			</label>
			<label>
				Password
				<input name="password" type="password" required autocomplete="current-password" />
			</label>
			<button type="submit" disabled={submitting}>
				{submitting ? 'Logging in…' : 'Log in'}
			</button>
		</form>
	{/if}
</main>
