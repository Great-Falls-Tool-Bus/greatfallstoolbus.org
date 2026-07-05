<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SourceLink from '$lib/components/SourceLink.svelte';
	import Picture from '$lib/components/Picture.svelte';
	import { creditFor } from '$lib/data/credits';
	import { Compass } from '@lucide/svelte';

	// Reference use of the Wave-2.5 media pipeline (Picture + manifest + credits):
	// a public-domain plate of the very hand tools the bus lends, framing "the
	// serious, hard-to-own-alone tools" the mission is about. Source + license
	// are recorded in $lib/data/credits.ts and surfaced in the caption below.
	const toolsPlate = '/photos/hand-tools-plate-1922.jpg';
	const toolsPlateCredit = creditFor(toolsPlate);

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
			body: 'The bus is meant to lower the barrier to making things. There is no membership fee, and nobody is turned away for inability to pay.',
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
			donation is tax-deductible.
			<!-- OPERATOR-CONFIRM: tax status = unincorporated / no 501(c)(3) / no fiscal sponsor; no tax-deductible claims. Recommended default, not operator-confirmed. -->
		</p>
	</section>

	<figure class="border-surface-200-800 mt-10 border-y py-6">
		<Picture
			src={toolsPlate}
			alt="A labeled 1922 plate of hand tools: square, mallet, brace, files, saw, chisel, brush, and related shop tools."
			sizes="(min-width: 768px) 768px, 100vw"
			class="bg-surface-100-900 aspect-[3280/2372] w-full object-cover"
		/>
		<figcaption class="text-surface-600-400 mt-3 text-sm leading-relaxed">
			{toolsPlateCredit?.title ?? 'Public-domain hand tools plate'}
			{#if toolsPlateCredit}
				<span>
					, {toolsPlateCredit.author}. {toolsPlateCredit.license}.
					<a
						class="underline underline-offset-4"
						href={toolsPlateCredit.source}
						target="_blank"
						rel="noopener noreferrer">Source</a
					>.
				</span>
			{/if}
		</figcaption>
	</figure>

	<section class="mt-12" aria-label="What we believe">
		<h2 class="text-2xl font-semibold">What we believe</h2>
		<dl class="mt-6 space-y-4">
			{#each principles as p (p.title)}
				<div>
					<dt class="font-semibold">{p.title}</dt>
					<dd class="text-surface-700 dark:text-surface-300 mt-1 leading-relaxed">{p.body}</dd>
				</div>
			{/each}
		</dl>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8 prose max-w-none" aria-label="How access works">
		<h2 class="text-2xl font-semibold">Access, in one sentence</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			<strong>Anyone may ask to borrow</strong>: there is no membership fee and no paperwork wall, a short safety
			orientation covers the capability you want to use, and a keyholder approves and coordinates the borrow. Donations
			are welcome but never required.
			<!-- Access model (ratified): keyholders are a curated, owner-approved group; anyone may request access; non-member requests reach all keyholders. -->
			The full path is on
			<a class="underline" href={`${base}/contact#access`}>how access works</a>, and the ground rules live on
			<a class="underline" href={`${base}/safety`}>safety &amp; responsible use</a>. The people behind the project are
			on
			<a class="underline" href={`${base}/stewards`}>stewards</a>.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		<p>Ready to borrow or donate a tool? Start with a keyholder.</p>
		<SourceLink routeId="/mission" />
	</footer>
</main>
