<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SourceLink from '$lib/components/SourceLink.svelte';
	import { ShieldCheck } from '@lucide/svelte';

	// Safety + responsible-use is MANDATORY for a public power-tool organization
	// (Artisan's Asylum / Station North precedent: safety orientation before
	// use, published code of conduct). The specifics below are community
	// defaults drawn from that precedent and are NOT operator-confirmed; see the
	// OPERATOR-CONFIRM markers and the PR operator_review_flags. Nothing here is
	// legal advice or a substitute for tool-specific manufacturer guidance.
	const rules = [
		{
			title: 'Orientation before use',
			body: 'Before borrowing a capability for the first time, complete a short safety orientation for it. It covers the real hazards, the personal protective equipment, and how the kit packs and travels.',
		},
		{
			title: 'Use tools as intended',
			body: 'Follow the manufacturer manual and the cell sheet. Do not remove guards, defeat interlocks, or improvise a tool into a job it was not built for. When in doubt, ask the cell captain or a keyholder.',
		},
		{
			title: 'Return it kitted and checked',
			body: 'Check the kit against its sheet when it goes out and when it comes back. Report anything worn, broken, or missing. No blame for honest wear, but hiding damage endangers the next borrower.',
		},
		{
			title: 'Know your limits',
			body: 'If a job is beyond your training, stop and ask. Never use a power tool impaired, alone with a serious hazard, or in a way that puts bystanders at risk.',
		},
	];

	const conduct = [
		'Treat every person with respect. Harassment, discrimination, and intimidation have no place on the bus or in its community, full stop.',
		'Share the commons. The tools belong to everyone; take your turn, return kits promptly, and leave things better than you found them.',
		'Look out for each other. Speak up about unsafe practice, and accept a good-faith safety correction gracefully.',
		'No discrimination. The bus is open to neighbors regardless of race, gender, gender identity, sexuality, disability, religion, or income.',
		'Consequences. Serious or repeated violations can end borrowing privileges; safety and dignity come before access.',
	];
</script>

<svelte:head>
	<title>Safety &amp; responsible use | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Safety and responsible-use ground rules and a short community code of conduct for the Great Falls Tool Bus: orientation before use, tools used as intended, respect for people and the commons."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Safety &amp; responsible use"
		lead="Shared power tools only work when everyone borrows them safely and treats the community with care. Read the ground rules before you borrow. They are community defaults drawn from established makerspace and tool-library practice, pending steward review."
		icon={ShieldCheck}
	/>

	<section class="mt-10" aria-label="Ground rules">
		<h2 class="text-2xl font-semibold">The ground rules</h2>
		<dl class="mt-6 space-y-4">
			{#each rules as rule (rule.title)}
				<div>
					<dt class="font-semibold">{rule.title}</dt>
					<dd class="text-surface-700 dark:text-surface-300 mt-1 leading-relaxed">{rule.body}</dd>
				</div>
			{/each}
		</dl>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="Code of conduct">
		<h2 class="text-2xl font-semibold">Code of conduct</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			The bus is a shared space, even on wheels. Borrowing from it means agreeing to a few simple commitments:
			<!-- OPERATOR-CONFIRM: code of conduct is a community-default draft (AA / Station North precedent), not operator-ratified. -->
		</p>
		<ul class="prose mt-4 max-w-none">
			{#each conduct as item (item)}
				<li class="text-surface-700 dark:text-surface-300 leading-relaxed">{item}</li>
			{/each}
		</ul>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8 prose max-w-none" aria-label="Reporting">
		<h2 class="text-2xl font-semibold">If something goes wrong</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Report a safety incident, damage, or a conduct concern to a keyholder or a cell captain as soon as you can. See
			<a class="underline" href={`${base}/stewards`}>stewards</a> for who holds which role, and
			<a class="underline" href={`${base}/contact#access`}>how access works</a> for where to reach out. Early reports keep
			the next borrower safe.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		<p>This page is guidance, not legal advice, and never replaces the manufacturer's manual for a specific tool.</p>
		<SourceLink routeId="/safety" />
	</footer>
</main>
