<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import { Users } from '@lucide/svelte';

	// Stewardship SCAFFOLD: the three-tier makerspace leadership model (Artisan's
	// Asylum precedent) scaled down for a bus: Coordinator, Cell / Shop Leads,
	// Safety Steward. Roles are defined; the roster is intentionally EMPTY.
	// Do NOT invent names here; the operator populates the roster. Real people
	// already credited on /shout-outs are acknowledgements, not role assignments.
	const roles = [
		{
			title: 'Coordinator',
			body: 'Holds the whole bus in view: routes and stops, keyholder communication, and the decisions that keep the project moving. The single point of "who do I ask about the bus itself?"',
		},
		{
			title: 'Cell captains / shop leads',
			body: 'One person per tool cell who knows the kit: what is in it, how it packs, and who to call when it needs care. Captains run safety orientations for their capability and keep the cell sheet true.',
		},
		{
			title: 'Safety steward',
			body: 'Owns the safety program across all cells: the orientation standard, the code of conduct, incident reporting, and the call on whether a tool or a practice is safe to allow.',
		},
	];
</script>

<svelte:head>
	<title>Stewards | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="How the Great Falls Tool Bus is stewarded: a Coordinator, cell captains / shop leads, and a Safety steward. Roles defined; roster pending."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Stewards"
		lead="A bus this small runs on a few clear roles, not an org chart. This is the stewardship scaffold, the roles that keep the tools shared safely, adapted from established makerspace practice and scaled down to a bus."
		icon={Users}
	/>

	<section class="mt-10" aria-label="The roles">
		<h2 class="text-2xl font-semibold">The roles</h2>
		<div class="mt-6 space-y-4">
			{#each roles as role (role.title)}
				<Card title={role.title} body={role.body} headingLevel="h3" />
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="Current roster">
		<h2 class="text-2xl font-semibold">Current roster</h2>
		<Card dashed eyebrow="Placeholder" title="Roster pending" headingLevel="h3">
			<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">
				The people filling these roles have not been published here yet. Names and contacts go up as each person
				confirms they want them public.
				<!-- OPERATOR-CONFIRM: populate the steward roster (Coordinator, cell captains, Safety steward) with real people + contacts. -->
			</p>
		</Card>
		<p class="text-surface-500 mt-6 text-sm leading-relaxed">
			The people who have made the bus real so far are credited on <a class="underline" href={`${base}/shout-outs`}
				>shout-outs</a
			>; a cell without a captain is called out on <a class="underline" href={`${base}/cells`}>tool cells</a>.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		Want to steward a cell? A captain is one person who knows the kit. See
		<a class="underline" href={`${base}/access`}>how access works</a> and reach out.
	</footer>
</main>
