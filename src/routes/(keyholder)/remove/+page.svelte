<script lang="ts">
	// TIN-3440 slice S7. Placeholder copy in the published:false/TODO posture —
	// a keyholder-only operational surface, never public marketing copy.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);

	const removable = $derived(data.memberships.filter((m) => m.status === 'active' || m.status === 'paused'));
</script>

<svelte:head>
	<title>Remove a membership — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="remove">
	<h1>Remove a membership</h1>
	<p>
		Removal is a terminal, audited act. It requires a recorded reason and your password, entered fresh. Reinstatement
		afterwards is a new application.
	</p>

	{#if !data.available}
		<p>This surface is not available right now.</p>
	{:else if !data.authenticated}
		<p>A live keyholder session is required.</p>
	{:else}
		{#if form && 'removed' in form}
			<p>
				The membership is removed. Sessions are revoked; downstream cleanup runs on its own and any open obligation
				stays visible on the person's record.
			</p>
		{:else if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'reason_required'}
					A recorded reason is required.
				{:else if form.code === 'reauth_required' || form.code === 'bad_credentials'}
					Please re-enter your password to confirm.
				{:else if form.code === 'version_conflict' || form.code === 'version_required'}
					The membership changed while this page was open. Reload and try again.
				{:else if form.code === 'illegal_transition'}
					That membership is not in a removable state.
				{:else}
					The removal could not be completed.
				{/if}
			</p>
		{/if}

		{#if removable.length === 0}
			<p>No removable memberships.</p>
		{:else}
			{#each removable as m (m.id)}
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
					<h2>{m.displayName} — {m.status}</h2>
					<input type="hidden" name="membershipId" value={m.id} />
					<input type="hidden" name="expectedVersion" value={m.version} />
					<label>
						Reason (required, recorded)
						<input type="text" name="reasonClass" maxlength="100" required />
					</label>
					<label>
						Your password (required, fresh)
						<input type="password" name="password" autocomplete="current-password" required />
					</label>
					<button type="submit" disabled={submitting}>Remove this membership</button>
				</form>
			{/each}
		{/if}
	{/if}
</main>
