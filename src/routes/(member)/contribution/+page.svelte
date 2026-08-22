<script lang="ts">
	// TIN-3818 slice S7. Placeholder copy in the published:false/TODO posture —
	// this surface is reachable only by an activated member's session, which
	// cannot exist before activation opens; operator copy review lands with
	// launch. Every number rendered here comes from the server's offer shape —
	// the page has no payment authority of its own (ADR 0014 §5).
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
	let pick = $state('');

	const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);

	const needsAmount = $derived(pick === 'custom_monthly' || pick === 'custom_annual');

	const enhanceOnce = () => {
		submitting = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			submitting = false;
			await update();
		};
	};
</script>

<svelte:head>
	<title>Contribution — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="contribution">
	<h1>Contribution</h1>

	{#if !data.available}
		<p>This page is not available right now.</p>
	{:else if !data.authenticated}
		<p>Please sign in first.</p>
	{:else if !data.eligible}
		<p>The contribution step opens once your membership is active. There is nothing you need to do here.</p>
	{:else}
		<!-- TODO(operator copy): placeholder sentences; the ratified
		     contribution copy is a separable record from the membership
		     agreement (ADR 0016 §2.3) and is never agent-authored as
		     published. -->
		<p>
			Contributing is optional. Choosing $0 keeps every part of your membership exactly as it is — your membership never
			depends on what, how, or whether you contribute.
		</p>

		{#if data.checkoutCancelled}
			<p>Checkout was cancelled. Nothing was charged, and your membership is unchanged.</p>
		{/if}

		{#if form && 'chosen' in form}
			{#if form.chosen === 'zero'}
				<p>Recorded. You chose $0 — that is a complete answer, and nothing about your membership changes.</p>
			{:else}
				<p>
					Recorded. When your cash or check arrives, a person will enter it by hand. Nothing about your membership
					depends on it.
				</p>
			{/if}
		{:else if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'invalid_choice'}
					That choice could not be accepted. Custom amounts must be within the listed range.
				{:else if form.code === 'card_unavailable'}
					Card contributions are not available yet. Cash, check, and $0 all work today.
				{:else if form.code === 'not_open'}
					The contribution step opens once your membership is active.
				{:else}
					The choice could not be recorded. Please try again.
				{/if}
			</p>
		{/if}

		{#if data.contribution.state !== 'none'}
			<p>You already have a choice on record. Submitting again replaces it.</p>
		{/if}

		<form method="POST" action="?/choose" use:enhance={enhanceOnce}>
			<fieldset>
				<legend>Monthly</legend>
				{#each data.offer.presetsCents as cents (cents)}
					<label>
						<input type="radio" name="pick" value={cents === 0 ? 'zero' : `preset:${cents}`} bind:group={pick} />
						{dollars(cents)}{cents === 0 ? '' : ' per month'}
					</label>
				{/each}
				<label>
					<input type="radio" name="pick" value="custom_monthly" bind:group={pick} />
					Another monthly amount ({dollars(data.offer.customMonthlyCents.min)} to {dollars(
						data.offer.customMonthlyCents.max,
					)})
				</label>
			</fieldset>

			<fieldset>
				<legend>Annual</legend>
				<label>
					<input type="radio" name="pick" value="custom_annual" bind:group={pick} />
					Once a year ({dollars(data.offer.customAnnualCents.min)} to {dollars(data.offer.customAnnualCents.max)})
				</label>
			</fieldset>

			<fieldset>
				<legend>Cash or check</legend>
				<!-- First-class rails, equal to card in every consequence
				     (ADR 0016 §3.1). -->
				<label>
					<input type="radio" name="pick" value="cash" bind:group={pick} />
					I'll bring cash
				</label>
				<label>
					<input type="radio" name="pick" value="check" bind:group={pick} />
					I'll write a check
				</label>
			</fieldset>

			<label hidden={!needsAmount && pick !== ''}>
				Amount in dollars
				<input type="text" name="amount" inputmode="decimal" autocomplete="off" />
			</label>

			<label>
				<input type="checkbox" name="helpRequested" value="true" />
				I'd like a hand with this step
			</label>

			<button type="submit" disabled={submitting}>Record my choice</button>

			{#if !data.cardAvailable}
				<p>Card checkout is not connected yet; if you pick a monthly or annual card amount, this page will say so.</p>
			{/if}
		</form>
	{/if}
</main>
