<script lang="ts">
	// TIN-3440 slice S5. Operational keyholder surface — placeholder copy in
	// the published:false/TODO posture; unreachable until keyholder sessions
	// exist. The tour is arranged by ordinary email (TIN-3440): the button
	// below records STATE only and automates nothing.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const entry = $derived(data.entry);
</script>

<svelte:head>
	<title>Review application — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="review-detail">
	{#if !data.available}
		<p>Review is not available on this build.</p>
	{:else if !data.authenticated || !entry}
		<p>This page requires a signed-in keyholder.</p>
	{:else}
		<h1>{entry.displayName}</h1>
		<p class="meta">{entry.status} · submitted {new Date(entry.submittedAt).toLocaleDateString()}</p>

		<dl>
			<dt>Email</dt>
			<dd>{entry.email}</dd>
			<dt>Interests / help offer</dt>
			<dd>{entry.interestsHelpOffer}</dd>
			<dt>Tour availability</dt>
			<dd>{entry.tourAvailability}</dd>
			<dt>Disclosures</dt>
			<dd>{entry.disclosures}</dd>
		</dl>

		{#if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'invalid' && 'fields' in form && Array.isArray(form.fields) && form.fields.includes('reasonClass')}
					A decline must record a reason.
				{:else if form.code === 'version_conflict'}
					This application changed while you were looking. Refresh and retry.
				{:else if form.code === 'not_claimant'}
					Only the claiming keyholder may act on this review.
				{:else}
					That action was refused ({form.code}).
				{/if}
			</p>
		{/if}

		{#if entry.decision}
			<p>
				Decision recorded: <strong>{entry.decision.decision}</strong>
				{#if entry.decision.reasonClass}
					— {entry.decision.reasonClass}{/if}
			</p>
		{:else if entry.claim?.mine}
			{#if entry.status === 'claimed'}
				<form method="POST" action="?/scheduleTour" use:enhance>
					<input type="hidden" name="expectedVersion" value={entry.version} />
					<button type="submit">Mark tour scheduled</button>
				</form>
				<p class="meta">Arrange the tour by ordinary email first; this records the state.</p>
			{/if}

			{#if entry.status === 'tour_scheduled'}
				<form method="POST" action="?/approve" use:enhance>
					<input type="hidden" name="expectedVersion" value={entry.version} />
					<label>Operational note (optional) <input name="note" /></label>
					<button type="submit">Approve after tour</button>
				</form>
			{/if}

			{#if entry.status === 'claimed' || entry.status === 'tour_scheduled'}
				<form method="POST" action="?/decline" use:enhance>
					<input type="hidden" name="expectedVersion" value={entry.version} />
					<label>Reason (required) <input name="reasonClass" required /></label>
					<label>Operational note (optional) <input name="note" /></label>
					<button type="submit">Decline with reason</button>
				</form>
			{/if}
		{:else if entry.claim}
			<p class="meta">Claimed by keyholder {entry.claim.keyholderPersonId.slice(0, 8)}… — only they may decide.</p>
		{:else}
			<p class="meta">Unclaimed. Claim it from the <a href="/review">review queue</a> to act.</p>
		{/if}
	{/if}
</main>

<style>
	.review-detail {
		max-width: 42rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
		display: grid;
		gap: 1rem;
	}
	.meta {
		opacity: 0.75;
		font-size: 0.9em;
	}
	form {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
	}
</style>
