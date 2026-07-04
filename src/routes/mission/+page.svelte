<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import { Compass } from '@lucide/svelte';

	// Mission framing:
	//   • tax status = unincorporated community project. NO 501(c)(3), NO fiscal
	//     sponsor yet → the site makes NO tax-deductible / charitable claims.
	//     (Recommended default, not operator-confirmed; see OPERATOR-CONFIRM below.)
	//   • access model (ratified): keyholders are a curated, owner-approved group;
	//     anyone may request access; non-member requests reach all keyholders.
	//     No membership fee, no paperwork wall; access is stewarded, and
	//     donations are optional.
	const principles = [
		{
			title: 'Shared, not sold',
			body: 'Serious tools are expensive to own and easy to under-use. Pooling them puts capable equipment in more hands for far less money, and keeps good tools working instead of gathering dust.',
		},
		{
			title: 'Equity-forward',
			body: 'The bus is meant to lower the barrier to making things, not raise it. There is no membership fee, and nobody is turned away for inability to pay. A short safety orientation and a keyholder who says yes are the whole gate.',
		},
		{
			title: 'Honest and documented',
			body: 'We say what is true today, cite the practice we borrow from, and never dress a bus up as a building. When reality changes, the site changes.',
		},
	];
</script>

<svelte:head>
	<title>Mission | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Why the Great Falls Tool Bus exists: an equity-forward, shared tool library on wheels for Lewiston-Auburn, Maine. An unincorporated community project, not a charity."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		eyebrow="Lewiston-Auburn, Maine"
		title="Mission"
		lead="The Great Falls Tool Bus exists to put serious, hard-to-own-alone tools into the hands of neighbors in Lewiston-Auburn: safely, with no membership fee and no paperwork wall."
		icon={Compass}
	/>

	<section class="mt-10 prose max-w-none" aria-label="What we are">
		<h2 class="text-2xl font-semibold">What we are</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			The tool bus is a <strong>shared tool library on wheels</strong>, and it stands on forty years of
			tool-lending-library practice and the hackerspace design-pattern tradition (see the
			<a class="underline" href={`${base}/bibliography`}>bibliography</a>).
		</p>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			The Great Falls Tool Bus is an <strong>unincorporated community project</strong>: there is no nonprofit entity and
			no fiscal sponsor behind it yet. Because of that, nothing on this site is a charitable solicitation and no
			donation is tax-deductible. We accept tool donations, and any money conversation happens person-to-person until a
			real entity exists.
			<!-- OPERATOR-CONFIRM: tax status = unincorporated / no 501(c)(3) / no fiscal sponsor; no tax-deductible claims. Recommended default, not operator-confirmed. -->
		</p>
	</section>

	<section class="mt-12" aria-label="What we believe">
		<h2 class="text-2xl font-semibold">What we believe</h2>
		<div class="mt-6 space-y-4">
			{#each principles as p (p.title)}
				<Card title={p.title} body={p.body} headingLevel="h3" />
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8 prose max-w-none" aria-label="How access works">
		<h2 class="text-2xl font-semibold">Access, in one sentence</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			<strong>Anyone may ask to borrow</strong>: there is no membership fee and no paperwork wall, a short safety
			orientation covers the capability you want to use, and a keyholder approves and coordinates the borrow. Donations
			are welcome but never required.
			<!-- Access model (ratified): keyholders are a curated, owner-approved group; anyone may request access; non-member requests reach all keyholders. -->
			The full path is on
			<a class="underline" href={`${base}/access`}>how access works</a>, and the ground rules live on
			<a class="underline" href={`${base}/safety`}>safety &amp; responsible use</a>. The people behind the project are
			on
			<a class="underline" href={`${base}/stewards`}>stewards</a>.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		Ready to borrow or donate a tool? A keyholder is the first ask.
	</footer>
</main>
