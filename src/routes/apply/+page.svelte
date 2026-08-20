<script lang="ts">
	// TIN-3440 slice S4. MECHANICS ONLY: every member-facing sentence on this
	// page is agent-drafted placeholder copy, shipped in the "published: false /
	// TODO" posture the lane's standing rules require. The page stays in its
	// closed state until the sitting-2 item-1 attestation text is ratified and
	// set in src/lib/server/application/attestation.ts — the load function's
	// `intakeOpen` flag is that gate. Copy review replaces the TODO strings
	// before the form is ever publicly open.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Apply — Great Falls Tool Bus</title>
	<!-- Not linked from navigation and not indexed until intake opens. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="apply">
	<h1>Become a member</h1>

	{#if !data.intakeOpen}
		<!-- TODO(sitting-2 item 1): intake opens when the attestation text is ratified. -->
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
			business days of your address being verified. Membership never depends on what you can contribute — that question only
			comes after approval, and $0 is always an option.
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
</style>
