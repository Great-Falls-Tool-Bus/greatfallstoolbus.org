<script lang="ts">
	// "Find the bus": the one-screen answer to "where is it?" The bus lives at a
	// fixed location in Lewiston-Auburn. The exact spot is not published; a
	// keyholder shares it privately when someone reaches out through the live
	// /contact form. That request-first posture is deliberate: access here is a
	// living, keyholder-stewarded contract that can change, because the Tool Bus
	// is an unincorporated initiative for now. Closes the
	// where-is-it gap flagged in docs/ux-research.md (line 149). No stops,
	// routes, or times: there are none. View/edit-source comes free via
	// PageHeader.
	import { base } from '$app/paths';
	import { MapPin } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
</script>

<svelte:head>
	<title>Find the bus | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="The Great Falls Tool Bus is based at a fixed location in Lewiston-Auburn, Maine. The exact spot is shared privately when you reach out through the contact form, and a keyholder walks you through access."
	/>
</svelte:head>

<main class="mx-auto max-w-2xl px-6 py-16 md:py-24">
	<PageHeader
		title="Find the bus"
		eyebrow="Where it is"
		icon={MapPin}
		lead="The bus is based at a fixed location in Lewiston-Auburn, Maine. The exact spot is shared with you when you reach out, not posted here."
	/>

	<section
		class="text-surface-700 dark:text-surface-300 mt-8 space-y-4 leading-relaxed"
		aria-label="How to find the bus"
	>
		<p>
			To visit or borrow, <a
				class="text-primary-700 dark:text-primary-300 font-semibold underline underline-offset-4"
				href={`${base}/contact`}>send a request through the contact form</a
			>. A keyholder replies with the exact location and walks you through the access procedure for the bus and its
			tools.
		</p>
		<p>
			Keeping the location private and sharing it on request is deliberate, for safety and access control. Access here
			is a living contract, stewarded by the keyholders and open to change, because the Tool Bus is an unincorporated
			initiative for now.
		</p>
	</section>
</main>
