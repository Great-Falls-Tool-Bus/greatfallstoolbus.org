<script lang="ts">
	// TIN-3440 slice S5. Operational keyholder surface — placeholder copy in
	// the published:false/TODO posture; unreachable until keyholder sessions
	// exist (S6 activation + operator grant bootstrap). Vocabulary note: this
	// surface reviews APPLICATIONS through INTAKE; the word "steward" never
	// ships (sitting-2 item 2).
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Application review — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="review">
	<h1>Application review</h1>

	{#if !data.available}
		<p>Review is not available on this build.</p>
	{:else if !data.authenticated}
		<p>This page requires a signed-in keyholder.</p>
	{:else}
		{#if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'claim_conflict'}
					Another keyholder has already claimed that application.
				{:else if form.code === 'version_conflict'}
					That application changed while you were looking. Refresh and retry.
				{:else}
					That action was refused ({form.code}).
				{/if}
			</p>
		{/if}

		{#if data.entries.length === 0}
			<p>No applications are waiting for review.</p>
		{:else}
			<ul class="queue">
				{#each data.entries as entry (entry.id)}
					<li>
						<article>
							<h2><a href={`/review/${entry.id}`}>{entry.displayName}</a></h2>
							<p class="meta">
								<span>{entry.status}</span>
								· submitted {new Date(entry.submittedAt).toLocaleDateString()}
							</p>
							{#if entry.claim}
								<p class="meta">Claimed by keyholder {entry.claim.keyholderPersonId.slice(0, 8)}…</p>
							{:else if entry.status === 'email_verified'}
								<form method="POST" action="?/claim" use:enhance>
									<input type="hidden" name="applicationId" value={entry.id} />
									<input type="hidden" name="expectedVersion" value={entry.version} />
									<button type="submit">Claim this review</button>
								</form>
							{/if}
						</article>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>

<style>
	.review {
		max-width: 48rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
	.queue {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 1rem;
	}
	.meta {
		opacity: 0.75;
		font-size: 0.9em;
	}
</style>
