<script lang="ts">
	import { base } from '$app/paths';
	import { MediaQuery } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';
	import { LoaderCircle, Mail, MailCheck, RotateCcw, Send, TriangleAlert } from '@lucide/svelte';
	import CopyAddressButton from '$lib/components/CopyAddressButton.svelte';
	import InfoTip from '$lib/components/InfoTip.svelte';
	import { LIST, LIST_ADDRESSES, MAIL_CLIENTS } from '$lib/data/mail-clients';
	import {
		buildMailtoHref,
		contactApiUrl,
		emptyContactValues,
		hasErrors,
		isHoneypotTripped,
		toContactPayload,
		validateContactForm,
		type ContactFieldErrors,
		type ContactFormValues,
	} from '$lib/contact-form';

	// Progressive enhancement (TIN-2420 Path B): the keyholders list is the
	// private access-gating role list. The form POSTs JSON to the Anubis-guarded
	// form-handler at forms.latoolb.us, which injects the message to keyholders@
	// over LMTP. The default below is the live public endpoint (a public URL, not
	// a secret, hence a committed default; secret-hygiene hooks forbid a
	// .env.production for it). PUBLIC_GFTB_FORM_ENDPOINT can override it (empty
	// string forces the mailto-only fallback, e.g. for a spoke without the
	// intake stack). When live, the mailto compose is the error/noscript
	// fallback only; it is the deliberate manual path, not a lesser one.
	const DEFAULT_FORM_ENDPOINT = 'https://forms.latoolb.us';
	const formEndpoint =
		typeof import.meta.env.PUBLIC_GFTB_FORM_ENDPOINT === 'string'
			? import.meta.env.PUBLIC_GFTB_FORM_ENDPOINT
			: DEFAULT_FORM_ENDPOINT;
	const endpointLive = formEndpoint.length > 0;
	const KEYHOLDERS = LIST.post;
	const REQUEST_TIMEOUT_MS = 15_000;

	// The honeypot and field validation live in $lib/contact-form (unit-tested).
	// This component owns only the DOM, the fetch, the timeout, and the
	// four-state machine below.
	type Status = 'idle' | 'submitting' | 'success' | 'error';
	let status = $state<Status>('idle');
	let values = $state<ContactFormValues>(emptyContactValues());
	let fieldErrors = $state<ContactFieldErrors>({});
	let submitError = $state('');

	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	// A zero-duration fade collapses the panel swap to an instant cut under
	// reduced-motion, honoring the setting without branching the markup.
	const swapDuration = $derived(reducedMotion.current ? 0 : 180);

	const mailtoHref = $derived(buildMailtoHref(KEYHOLDERS, values));

	function validateNow(): boolean {
		fieldErrors = validateContactForm(values);
		return !hasErrors(fieldErrors);
	}

	function focusFirstError() {
		const order: (keyof ContactFieldErrors)[] = ['name', 'email', 'message'];
		const first = order.find((f) => fieldErrors[f]);
		if (first && typeof document !== 'undefined') {
			document.getElementById(`contact-${first}`)?.focus();
		}
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		submitError = '';

		// Silent honeypot: a filled hidden field means a bot walked the form.
		// Show the same confirmation a human sees, and send nothing.
		if (isHoneypotTripped(values)) {
			status = 'success';
			return;
		}

		if (!validateNow()) {
			focusFirstError();
			return;
		}

		// No live endpoint (today): the mail draft IS the path. Hand off to the
		// visitor's own mail app and stop; the actual send happens there.
		if (!endpointLive) {
			window.location.href = mailtoHref;
			return;
		}

		status = 'submitting';
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const res = await fetch(contactApiUrl(formEndpoint), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(toContactPayload(values)),
				signal: controller.signal,
			});
			if (!res.ok) {
				throw new Error(`The keyholders form service answered ${res.status}. Please try again.`);
			}
			status = 'success';
		} catch (err) {
			const aborted = err instanceof DOMException && err.name === 'AbortError';
			submitError = aborted
				? 'That took too long to reach the keyholders. Check your connection and try again.'
				: err instanceof Error
					? err.message
					: 'Something went wrong reaching the keyholders. Please try again.';
			status = 'error';
		} finally {
			clearTimeout(timer);
		}
	}

	// Retry from the error state keeps every field value the visitor typed; only
	// the alert clears so they can resubmit or reach for the mail fallback.
	function retry() {
		submitError = '';
		status = 'idle';
	}

	const listAddresses = LIST_ADDRESSES;

	// Single source of truth: the same client data drives the derived per-client
	// agent skills (see scripts/build-agent-skills.mjs) and the cards below.
	const clientSetups = MAIL_CLIENTS;
</script>

<svelte:head>
	<title>Contact / join — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Reach the Great Falls Tool Bus keyholders. The contact form sends your request straight to the list; a real person replies."
	/>
</svelte:head>

<main class="mx-auto max-w-4xl px-6 py-16 md:py-24">
	<header class="max-w-3xl space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">Contact / join</p>
		<h1 class="text-4xl leading-tight font-bold md:text-5xl">Reach the bus</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			The private keyholders list takes access requests, and a real person answers each one. Fill in the form below and
			your request goes straight to the list.
		</p>
	</header>

	<section class="border-surface-200-800 mt-10 rounded-lg border p-5" aria-labelledby="form-heading">
		<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
			<div>
				<h2 id="form-heading" class="text-2xl font-semibold">Contact form</h2>
				<p class="text-surface-700-300 mt-2 max-w-2xl leading-relaxed">
					{#if endpointLive}
						Your request posts straight to the keyholders through a bot-guarded endpoint. No mail app needed.
					{:else}
						Sending opens a pre-filled draft to the keyholders list in your own mail app. That hand-off is the
						deliberate fallback while the bot-guarded direct-submit endpoint is finished; when it lands, this same form
						posts your request with no change to how it looks.
					{/if}
				</p>
			</div>
			<span class="bg-success-100 text-success-800 rounded-sm px-2 py-1 text-xs font-semibold whitespace-nowrap">
				{endpointLive ? 'Direct submit' : 'Mail draft fallback'}
			</span>
		</div>

		{#if status === 'success'}
			<div
				class="border-success-300-700 bg-success-50-950/60 mt-6 rounded-md border p-5"
				role="status"
				aria-live="polite"
				in:fade={{ duration: swapDuration }}
			>
				<div class="flex items-start gap-3">
					<MailCheck class="text-success-600 dark:text-success-400 mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
					<div class="space-y-2">
						<p class="text-lg font-semibold">Your request is on its way to the keyholders.</p>
						<p class="text-surface-700-300 leading-relaxed">
							Expect a reply from a real person. A keyholder reads every request, and one of them will follow up at the
							email you gave, usually to sort out a first safety orientation and a time the bus can meet you.
						</p>
					</div>
				</div>
			</div>
		{:else}
			<form
				method="post"
				action={formEndpoint || undefined}
				onsubmit={handleSubmit}
				class="mt-6 grid gap-4"
				aria-busy={status === 'submitting'}
				novalidate
				in:fade={{ duration: swapDuration }}
			>
				{#if status === 'error'}
					<div class="border-error-300-700 bg-error-50-950/60 rounded-md border p-4" role="alert" aria-live="assertive">
						<div class="flex items-start gap-3">
							<TriangleAlert class="text-error-600 dark:text-error-400 mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
							<div class="space-y-3">
								<p class="text-surface-800-200 leading-relaxed">{submitError}</p>
								<div class="flex flex-wrap items-center gap-3">
									<button
										type="button"
										onclick={retry}
										class="border-error-400-600 text-error-700 dark:text-error-300 inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm font-semibold"
									>
										<RotateCcw class="h-4 w-4" aria-hidden="true" />
										Try again
									</button>
									<a
										href={mailtoHref}
										class="text-primary-700 dark:text-primary-300 inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-4"
									>
										<Mail class="h-4 w-4" aria-hidden="true" />
										Send by email instead
									</a>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<div class="grid gap-1">
					<label class="text-sm font-medium" for="contact-name">Name</label>
					<input
						id="contact-name"
						class="border-surface-300-700 bg-surface-50-950 rounded-sm border px-3 py-2"
						name="name"
						autocomplete="name"
						bind:value={values.name}
						aria-invalid={fieldErrors.name ? 'true' : undefined}
						aria-describedby={fieldErrors.name ? 'contact-name-error' : undefined}
						required
					/>
					{#if fieldErrors.name}
						<p id="contact-name-error" class="text-error-700 dark:text-error-400 text-sm">{fieldErrors.name}</p>
					{/if}
				</div>

				<div class="grid gap-1">
					<label class="text-sm font-medium" for="contact-email">Email</label>
					<input
						id="contact-email"
						class="border-surface-300-700 bg-surface-50-950 rounded-sm border px-3 py-2"
						name="email"
						type="email"
						autocomplete="email"
						bind:value={values.email}
						aria-invalid={fieldErrors.email ? 'true' : undefined}
						aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined}
						required
					/>
					{#if fieldErrors.email}
						<p id="contact-email-error" class="text-error-700 dark:text-error-400 text-sm">{fieldErrors.email}</p>
					{/if}
				</div>

				<div class="grid gap-1">
					<label class="text-sm font-medium" for="contact-message">What are you reaching out about?</label>
					<textarea
						id="contact-message"
						class="border-surface-300-700 bg-surface-50-950 min-h-32 rounded-sm border px-3 py-2"
						name="message"
						bind:value={values.message}
						aria-invalid={fieldErrors.message ? 'true' : undefined}
						aria-describedby={fieldErrors.message ? 'contact-message-error' : undefined}
						required></textarea>
					{#if fieldErrors.message}
						<p id="contact-message-error" class="text-error-700 dark:text-error-400 text-sm">{fieldErrors.message}</p>
					{/if}
				</div>

				<!-- Honeypot. Off-screen, untabbable, and hidden from assistive tech;
				     a real person never touches it, so any value marks a bot. -->
				<div aria-hidden="true" class="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden">
					<label for="contact-website">Website (leave blank)</label>
					<input
						id="contact-website"
						name="website"
						type="text"
						tabindex="-1"
						autocomplete="off"
						bind:value={values.website}
					/>
				</div>

				<button
					type="submit"
					disabled={status === 'submitting'}
					class="bg-primary-600 text-surface-50 inline-flex w-fit items-center gap-2 rounded-sm px-4 py-2 text-sm font-semibold disabled:opacity-70"
				>
					{#if status === 'submitting'}
						<LoaderCircle class="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
						Sending to keyholders
					{:else}
						<Send class="h-4 w-4" aria-hidden="true" />
						{endpointLive ? 'Send to keyholders' : 'Compose to keyholders'}
					{/if}
				</button>

				<noscript>
					<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">
						With JavaScript off, email the keyholders list directly at
						<a
							class="text-primary-700 dark:text-primary-300 font-mono underline underline-offset-4"
							href={`mailto:${KEYHOLDERS}`}>{KEYHOLDERS}</a
						>. Include your name and what you want to make or fix; a keyholder will reply.
					</p>
				</noscript>
			</form>
		{/if}
	</section>

	<section class="mt-12" aria-labelledby="list-heading">
		<div class="flex items-center gap-2">
			<h2 id="list-heading" class="text-2xl font-semibold">Keyholders list</h2>
			<InfoTip text="Private role list for keyholders. Public requests can reach it, but the archive is not public." />
		</div>
		<p class="text-surface-700 dark:text-surface-300 mt-3 leading-relaxed">
			The keyholders address is a private access-gating role list: keyholder membership is curated, public access
			requests can still reach the group, and the archive is not public.
		</p>
		<div class="mt-6 grid gap-3 md:grid-cols-3">
			{#each listAddresses as item (item.address)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
					<h3 class="text-lg font-semibold">{item.label}</h3>
					<div class="mt-2 flex items-center gap-2">
						<p class="text-primary-700 dark:text-primary-300 min-w-0 break-all font-mono text-sm">{item.address}</p>
						<CopyAddressButton value={item.address} label={`Copy ${item.label.toLowerCase()}`} />
					</div>
					<p class="text-surface-700-300 mt-3 text-sm leading-relaxed">{item.note}</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="mt-12" aria-labelledby="clients-heading">
		<h2 id="clients-heading" class="text-2xl font-semibold">Mail client notes</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-3 max-w-3xl text-sm leading-relaxed">
			Your own agent can lace up any of these clients from the matching skill in
			<a class="text-primary-600 underline underline-offset-4" href="{base}/llms.txt">llms.txt</a>.
		</p>
		<div class="mt-6 grid gap-3 md:grid-cols-2">
			{#each clientSetups as item (item.id)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
					<div class="flex items-baseline justify-between gap-3">
						<h3 class="text-lg font-semibold">{item.name}</h3>
						<span class="text-surface-500 text-xs">{item.platforms}</span>
					</div>
					<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">{item.summary}</p>
					<dl class="mt-3 grid gap-1 text-sm">
						<div class="grid gap-0.5">
							<dt class="text-surface-500 text-xs tracking-wide uppercase">Subscribe</dt>
							<dd class="text-surface-700-300 leading-relaxed">{item.subscribe}</dd>
						</div>
						<div class="grid gap-0.5">
							<dt class="text-surface-500 text-xs tracking-wide uppercase">File</dt>
							<dd class="text-surface-700-300 leading-relaxed">{item.filing}</dd>
						</div>
						<div class="grid gap-0.5">
							<dt class="text-surface-500 text-xs tracking-wide uppercase">Reply</dt>
							<dd class="text-surface-700-300 leading-relaxed">{item.replyToList}</dd>
						</div>
					</dl>
				</div>
			{/each}
		</div>
	</section>
</main>
