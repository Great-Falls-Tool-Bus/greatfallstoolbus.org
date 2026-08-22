<script lang="ts">
	// TIN-3440 slice S7. Placeholder copy in the published:false/TODO posture —
	// this surface is reachable only by an activated member's session, which
	// cannot exist before activation opens; copy review lands with launch.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);

	const enhanceOnce = () => {
		submitting = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			submitting = false;
			await update();
		};
	};
</script>

<svelte:head>
	<title>Your membership — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="membership">
	<h1>Your membership</h1>

	{#if !data.available}
		<p>Membership services are not available right now.</p>
	{:else if !data.authenticated}
		<p>Please sign in to manage your membership.</p>
	{:else if data.membership === null}
		<p>No membership record is linked to this account.</p>
	{:else}
		{#if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'version_conflict' || form.code === 'version_required'}
					Your membership changed while this page was open. Please reload and try again.
				{:else if form.code === 'illegal_transition'}
					That action is not available in your membership's current state.
				{:else}
					The action could not be completed. Please try again.
				{/if}
			</p>
		{/if}

		<dl>
			<dt>Status</dt>
			<dd>{data.membership.status}</dd>
			<dt>Borrowing</dt>
			<dd>{data.membership.canBorrow ? 'available' : 'not available'}</dd>
		</dl>

		{#if data.membership.status === 'active'}
			<form method="POST" action="?/pause" use:enhance={enhanceOnce}>
				<input type="hidden" name="membershipId" value={data.membership.id} />
				<input type="hidden" name="expectedVersion" value={data.membership.version} />
				<button type="submit" disabled={submitting}>Pause my membership</button>
			</form>
		{:else if data.membership.status === 'paused'}
			<form method="POST" action="?/resume" use:enhance={enhanceOnce}>
				<input type="hidden" name="membershipId" value={data.membership.id} />
				<input type="hidden" name="expectedVersion" value={data.membership.version} />
				<button type="submit" disabled={submitting}>Resume my membership</button>
			</form>
		{/if}

		{#if data.membership.status === 'active' || data.membership.status === 'paused'}
			<form method="POST" action="?/leave" use:enhance={enhanceOnce}>
				<input type="hidden" name="membershipId" value={data.membership.id} />
				<input type="hidden" name="expectedVersion" value={data.membership.version} />
				<label>
					Reason (optional)
					<input type="text" name="reasonClass" maxlength="100" />
				</label>
				<button type="submit" disabled={submitting}>Leave the Tool Bus</button>
			</form>
		{/if}
	{/if}
</main>
