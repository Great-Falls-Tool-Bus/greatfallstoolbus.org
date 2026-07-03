<script lang="ts">
	const formEndpoint =
		typeof import.meta.env.PUBLIC_GFTB_FORM_ENDPOINT === 'string' ? import.meta.env.PUBLIC_GFTB_FORM_ENDPOINT : '';
	const formEnabled = formEndpoint.length > 0;

	const listAddresses = [
		{
			label: 'Join the keyholders list',
			address: 'keyholders-join@latoolb.us',
			note: 'Send an empty email here once the list runtime is applied.',
		},
		{
			label: 'Post to the list',
			address: 'keyholders@latoolb.us',
			note: 'For members after Mailman confirms the subscription.',
		},
		{
			label: 'Reach list owners',
			address: 'keyholders-owner@latoolb.us',
			note: 'The operator-facing owner address after the mail stack is live.',
		},
	];

	const clientSetups = [
		{
			title: 'Gmail',
			body: 'Subscribe by email, label messages from keyholders@latoolb.us, and mark early list mail as not spam if needed.',
		},
		{
			title: 'Thunderbird',
			body: 'Use Reply to List when present; Thunderbird reads the List-Post and List-Id headers Mailman emits.',
		},
		{
			title: 'Geary',
			body: 'Subscribe by email or the web archive. Server-side filters work best for sorting list mail.',
		},
		{
			title: 'KMail',
			body: 'Use Folder -> Mailing List Management -> Detect Automatically after the first list message lands.',
		},
	];
</script>

<svelte:head>
	<title>Contact / join — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="How to contact the Great Falls Tool Bus and join the keyholders list while the protected form and mail stack come online."
	/>
</svelte:head>

<main class="mx-auto max-w-4xl px-6 py-16 md:py-24">
	<header class="max-w-3xl space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">Contact / join</p>
		<h1 class="text-4xl leading-tight font-bold md:text-5xl">Reach the bus</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			The goal is a bot-guarded form plus a public keyholders mailing list. The page is live now so the path is visible;
			submission stays disabled until the Anubis-protected endpoint and Mailman stack are actually applied.
		</p>
	</header>

	<section class="border-surface-200-800 mt-10 rounded-lg border p-5" aria-labelledby="form-heading">
		<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
			<div>
				<h2 id="form-heading" class="text-2xl font-semibold">Contact form</h2>
				<p class="text-surface-700-300 mt-2 max-w-2xl leading-relaxed">
					This form posts only to the external protected endpoint once the infra overlay publishes it. Until then, the
					fields are shown as the intended shape, not as working functionality.
				</p>
			</div>
			<span
				class="rounded-sm px-2 py-1 text-xs font-semibold {formEnabled
					? 'bg-success-100 text-success-800'
					: 'bg-warning-100 text-warning-900'}"
			>
				{formEnabled ? 'Endpoint live' : 'Endpoint pending'}
			</span>
		</div>

		<form method="post" action={formEndpoint || undefined} class="mt-6 grid gap-4">
			<div class="grid gap-1">
				<label class="text-sm font-medium" for="contact-name">Name</label>
				<input
					id="contact-name"
					class="border-surface-300-700 bg-surface-50-950 rounded-sm border px-3 py-2"
					name="name"
					aria-label="Name"
					autocomplete="name"
					disabled={!formEnabled}
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
					disabled={!formEnabled}
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
					disabled={!formEnabled}
					required></textarea>
			</div>
			<button
				type="submit"
				class="bg-primary-600 text-surface-50 w-fit rounded-sm px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
				disabled={!formEnabled}
			>
				Send to keyholders
			</button>
		</form>
	</section>

	<section class="mt-12" aria-labelledby="list-heading">
		<h2 id="list-heading" class="text-2xl font-semibold">Keyholders list</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-3 leading-relaxed">
			These addresses are the intended public surface for the Mailman list. They are published here as routing truth,
			but delivery is not claimed until the mail CRs, DNS records, and list round-trip smoke are green.
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
		<div class="mt-6 grid gap-3 md:grid-cols-2">
			{#each clientSetups as item (item.title)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
					<h3 class="text-lg font-semibold">{item.title}</h3>
					<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">{item.body}</p>
				</div>
			{/each}
		</div>
	</section>
</main>
