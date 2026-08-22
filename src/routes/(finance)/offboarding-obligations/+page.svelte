<script lang="ts">
	// TIN-3440 slice S11, round 2. Finance-role-only operational surface —
	// noindex, like /(finance)/contributions. READ-ONLY: no form, no action,
	// no button that mutates anything on this page. Retrying a dead-lettered
	// job stays the S6/S7 whole-offboarding replay machinery's job.
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATE_LABEL: Record<string, string> = {
		pending: 'pending',
		leased: 'processing',
		dead: 'dead-lettered',
	};
</script>

<svelte:head>
	<title>Finance — offboarding obligations — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="obligations">
	<h1>Offboarding — open billing obligations</h1>
	<p>
		Every offboarded membership whose billing cancellation has not completed — spec §2.3's "finance sees an open
		obligation" for a dead-lettered <code>offboard.cancel_billing</code> job. Read-only.
	</p>

	{#if !data.available}
		<p>This page is not available on this build.</p>
	{:else if data.obligations.length === 0}
		<p>No open billing obligations.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Member</th>
					<th>State</th>
					<th>Attempts</th>
					<th>Updated</th>
					<th>Reason</th>
				</tr>
			</thead>
			<tbody>
				{#each data.obligations as row (row.membershipId)}
					<tr class={`state-${row.status}`}>
						<td>{row.displayName}</td>
						<td>{STATE_LABEL[row.status] ?? row.status}</td>
						<td>{row.attempts} / {row.maxAttempts}</td>
						<td>{new Date(row.updatedAt).toLocaleString()}</td>
						<td>{row.lastError ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>

<style>
	.obligations {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9em;
	}
	th,
	td {
		text-align: left;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.1);
		vertical-align: top;
	}
	tr.state-dead {
		color: #8a1f1f;
	}
</style>
