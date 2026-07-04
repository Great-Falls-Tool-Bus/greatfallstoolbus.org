<script lang="ts">
	import { base } from '$app/paths';
	import { LIST, MAIL_CLIENTS } from '$lib/data/mail-clients';

	const formEndpoint =
		typeof import.meta.env.PUBLIC_GFTB_FORM_ENDPOINT === 'string' ? import.meta.env.PUBLIC_GFTB_FORM_ENDPOINT : '';
	// Progressive enhancement (TIN-2420 Path A): the latoolb.us mailbox
	// accepts inbound mail; the Mailman/list and Anubis submit endpoint are
	// still separate proof gates. Until the endpoint ships, the static form
	// opens a mail draft in the visitor's own mail app.
	const endpointLive = formEndpoint.length > 0;
	const KEYHOLDERS = LIST.post;

	function composeMail(event: SubmitEvent) {
		if (endpointLive) return; // real endpoint: let the POST happen
		event.preventDefault();
		const data = new FormData(event.currentTarget as HTMLFormElement);
		const name = String(data.get('name') ?? '');
		const email = String(data.get('email') ?? '');
		const message = String(data.get('message') ?? '');
		const subject = `Tool Bus contact — ${name}`;
		const body = `Name: ${name}\nEmail: ${email}\n\n${message}`;
		window.location.href = `mailto:${KEYHOLDERS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	}

	const listAddresses = [
		{
			label: 'Join the keyholders list',
			address: LIST.join,
			note: 'Send an empty email here once the list runtime is applied.',
		},
		{
			label: 'Post to the list',
			address: LIST.post,
			note: 'For members after Mailman confirms the subscription.',
		},
		{
			label: 'Reach list owners',
			address: LIST.owner,
			note: 'The operator-facing owner address after the list runtime is live.',
		},
	];

	// Single source of truth: the same client data drives the derived per-client
	// agent skills (see scripts/build-agent-skills.mjs) and the cards below.
	const clientSetups = MAIL_CLIENTS;
</script>

<svelte:head>
	<title>Contact / join — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="How to contact the Great Falls Tool Bus while the protected form endpoint and keyholders list come online."
	/>
</svelte:head>

<main class="mx-auto max-w-4xl px-6 py-16 md:py-24">
	<header class="max-w-3xl space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">Contact / join</p>
		<h1 class="text-4xl leading-tight font-bold md:text-5xl">Reach the bus</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			The keyholders mailbox accepts inbound mail. The form below composes an email in your own mail app; a bot-guarded
			direct-submit endpoint and the public Mailman list are the next upgrades.
		</p>
	</header>

	<section class="border-surface-200-800 mt-10 rounded-lg border p-5" aria-labelledby="form-heading">
		<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
			<div>
				<h2 id="form-heading" class="text-2xl font-semibold">Contact form</h2>
				<p class="text-surface-700-300 mt-2 max-w-2xl leading-relaxed">
					{#if endpointLive}
						Submissions post directly to the bot-guarded endpoint.
					{:else}
						Sending opens a pre-filled email to the keyholders mailbox in your own mail app. A bot-guarded direct-submit
						endpoint replaces this hand-off later with no change to the form.
					{/if}
				</p>
			</div>
			<span class="bg-success-100 text-success-800 rounded-sm px-2 py-1 text-xs font-semibold">
				{endpointLive ? 'Endpoint live' : 'Mail draft hand-off'}
			</span>
		</div>

		<form method="post" action={formEndpoint || undefined} onsubmit={composeMail} class="mt-6 grid gap-4">
			<div class="grid gap-1">
				<label class="text-sm font-medium" for="contact-name">Name</label>
				<input
					id="contact-name"
					class="border-surface-300-700 bg-surface-50-950 rounded-sm border px-3 py-2"
					name="name"
					aria-label="Name"
					autocomplete="name"
					required
				/>
			</div>
			<div class="grid gap-1">
				<label class="text-sm font-medium" for="contact-email">Email</label>
				<input
					id="contact-email"
					class="border-surface-300-700 bg-surface-50-950 rounded-sm border px-3 py-2"
					name="email"
					type="email"
					aria-label="Email"
					autocomplete="email"
					required
				/>
			</div>
			<div class="grid gap-1">
				<label class="text-sm font-medium" for="contact-message">What are you reaching out about?</label>
				<textarea
					id="contact-message"
					class="border-surface-300-700 bg-surface-50-950 min-h-32 rounded-sm border px-3 py-2"
					name="message"
					aria-label="What are you reaching out about?"
					required></textarea>
			</div>
			<button type="submit" class="bg-primary-600 text-surface-50 w-fit rounded-sm px-4 py-2 text-sm font-semibold">
				Send to keyholders
			</button>
		</form>
	</section>

	<section class="mt-12" aria-labelledby="list-heading">
		<h2 id="list-heading" class="text-2xl font-semibold">Keyholders list</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-3 leading-relaxed">
			The keyholders mailbox receives inbound mail. The join/owner addresses below are the Mailman list surface — those
			activate when the list runtime lands, and list round-trip smoke is the proof before list delivery is claimed.
		</p>
		<div class="mt-6 grid gap-3 md:grid-cols-3">
			{#each listAddresses as item (item.address)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
					<h3 class="text-lg font-semibold">{item.label}</h3>
					<p class="text-primary-700 dark:text-primary-300 mt-2 font-mono text-sm">{item.address}</p>
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
