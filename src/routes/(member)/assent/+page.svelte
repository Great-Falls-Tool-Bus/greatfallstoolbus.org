<script lang="ts">
	// TIN-3440 slice S6. Placeholder copy in the published:false/TODO posture —
	// this page is only ever reached from a decision email, which cannot exist
	// before the mail handler ships, and the agreement BODY it renders is the
	// operator-published version row (sitting-2 item 3), never agent copy.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Activate membership — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="assent">
	<h1>Activate membership</h1>

	{#if form && 'activated' in form}
		<p>Your membership is active. Welcome aboard.</p>
	{:else if !data.available}
		<p>Activation is not available right now. Please try again later.</p>
	{:else if data.token === null}
		<p>This link is incomplete. Please use the activation link from your approval email.</p>
	{:else if !data.tokenValid}
		<p role="alert">This link is no longer valid. It may have expired or already been used.</p>
	{:else if data.agreement === null}
		<!-- Honest pre-ratification state: the version-1 text has not been
		     published as data yet (sitting-2 item 3 / gate row 4). -->
		<p>The membership agreement is being finalized. We will email you when activation opens.</p>
	{:else}
		{#if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'superseded_agreement'}
					The agreement was updated while this page was open. Please reload and review the current version.
				{:else if form.code === 'password_too_short'}
					Please choose a longer password.
				{:else if form.code === 'password_mismatch'}
					The passwords do not match.
				{:else}
					Activation could not be completed. Please try again or reply to your approval email.
				{/if}
			</p>
		{/if}

		<section class="agreement-body" aria-label="Membership agreement text">
			<pre>{data.agreement.body}</pre>
			<p class="digest">Version {data.agreement.id}</p>
		</section>

		<!-- Decision 0024 §2: activation IS the assent. This sentence is the
		     member-facing statement of that; there is no separate checkbox and
		     no second consent event. -->
		<p class="agreement-notice">
			Completing activation records your agreement to version {data.agreement.id} above. Your member account will show that
			exact version.
		</p>

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
			<input type="hidden" name="agreementVersionId" value={data.agreement.id} />

			<label>
				Choose a password
				<input type="password" name="password" autocomplete="new-password" required minlength="12" />
			</label>
			<label>
				Confirm password
				<input type="password" name="confirmPassword" autocomplete="new-password" required minlength="12" />
			</label>

			<button type="submit" disabled={submitting}>
				{submitting ? 'Activating…' : 'Activate membership'}
			</button>
		</form>
	{/if}
</main>
