<script lang="ts">
	// TIN-3440 slice S4. MECHANICS ONLY: every member-facing sentence on this
	// page is agent-drafted placeholder copy, shipped in the "published: false /
	// TODO" posture the lane's standing rules require. The sitting-2 item-1
	// attestation text is ratified (decisions/0018) but the page stays in its
	// closed state until the operator sets AGE_ATTESTATION_TEXT in
	// src/lib/server/application/attestation.ts as a deliberate launch act —
	// the load function's `intakeOpen` flag is that gate. Copy review replaces
	// the TODO strings before the form is ever publicly open.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);

	const cardPresets = data.contributionPreview.presetsCents.filter((cents) => cents > 0);
	let previewCents = $state(
		cardPresets[Math.floor(cardPresets.length / 2)] ?? data.contributionPreview.customMonthlyCents.min,
	);
	const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
</script>

<svelte:head>
	<title>Apply — Great Falls Tool Bus</title>
	<!-- Linked from the member-tree entry page (`/`, L72 Q3-A, 2026-08-21) but
	     still not SEARCH-INDEXED until intake opens: `noindex` blocks indexing,
	     not crawling, and this is the only page on the site. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="apply">
	<h1>Become a member</h1>

	{#if !data.intakeOpen}
		<!-- Sitting-2 item 1 is ratified (decisions/0018); intake opens when the operator sets AGE_ATTESTATION_TEXT at launch. -->
		<p>
			Membership applications are not open yet. We are finishing the paperwork our first member sitting requires before
			we can take applications. Check back soon, or ask on the contact page.
		</p>
	{:else if form && 'receipt' in form}
		<!-- The one constant success view: identical for every submission. -->
		<p>
			Thanks — your application is in. You will get an automated receipt by email right away, and a human reply within
			three business days of verifying your address.
		</p>
	{:else}
		<p>
			<!-- TODO copy review: drafted, not ratified. -->
			Tell us who you are and how to reach you. We will email you a receipt immediately; a keyholder replies within three
			business days of your address being verified. Membership never depends on what you can contribute. You can preview the
			optional contribution choices below, including $0.
		</p>

		{#if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'invalid'}
					Some required fields are missing or not usable. Please check the form and try again.
				{:else if form.code === 'rate_limited'}
					Too many submissions from this connection just now. Please wait a bit and try again.
				{:else}
					Applications cannot be received right now. Please try again later.
				{/if}
			</p>
		{/if}

		<fieldset class="contribution-preview" aria-describedby="contribution-preview-note">
			<legend>Optional contribution preview</legend>
			<p id="contribution-preview-note">
				This preview is not part of your application. Moving the slider records nothing and starts no payment. If your
				membership becomes active, you can choose then or skip this step.
			</p>

			<label for="contribution-preview-slider">
				Card amount preview: <output>{dollars(previewCents)} per month</output>
			</label>
			<input
				id="contribution-preview-slider"
				type="range"
				min={data.contributionPreview.customMonthlyCents.min}
				max={data.contributionPreview.customMonthlyCents.max}
				step="100"
				bind:value={previewCents}
			/>

			<ul class="contribution-choices" aria-label="Available contribution choices">
				<li><strong>$0</strong> — no payment</li>
				<li>
					<strong>Card</strong> — monthly presets
					{cardPresets.map(dollars).join(', ')}, or a custom amount
				</li>
				{#each data.contributionPreview.rails as rail (rail)}
					<li><strong>{rail === 'cash' ? 'Cash' : 'Check'}</strong> — arranged after activation</li>
				{/each}
			</ul>
		</fieldset>

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
				Display name
				<input name="displayName" required autocomplete="name" />
			</label>
			<label>
				Email address
				<input name="email" type="email" required autocomplete="email" />
			</label>
			<label>
				Interests / how you'd like to help
				<textarea name="interestsHelpOffer" required rows="3"></textarea>
			</label>
			<label>
				Tour availability
				<textarea name="tourAvailability" required rows="2"></textarea>
			</label>
			<label>
				Required disclosures
				<textarea name="disclosures" required rows="2"></textarea>
			</label>
			<label>
				<!-- Unchecked by default, required — slices §1.6 AMENDMENT mechanics.
				     The wording comes ONLY from the ratified constant. -->
				<input name="ageAttested" type="checkbox" required />
				{data.attestationText}
			</label>
			<button type="submit" disabled={submitting}>
				{submitting ? 'Sending…' : 'Submit application'}
			</button>
		</form>
	{/if}
</main>

<style>
	.apply {
		max-width: 42rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
	form {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	input[type='checkbox'] {
		justify-self: start;
	}
	.contribution-preview {
		display: grid;
		gap: 0.75rem;
		margin: 1.5rem 0;
		padding: 1rem;
	}
	.contribution-preview input[type='range'] {
		width: 100%;
	}
	.contribution-choices {
		margin: 0;
		padding-left: 1.25rem;
	}
</style>
