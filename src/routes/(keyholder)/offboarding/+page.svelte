<script lang="ts">
	// TIN-3440 slice S11. Read-only operational keyholder surface — placeholder
	// copy in the published:false/TODO posture, same as /review and /remove.
	// No <form>, no action, no retry control: this page only reads. Replay of a
	// dead-lettered job stays the S6/S7 replay machinery's job.
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATE_LABEL: Record<string, string> = {
		pending: 'pending',
		leased: 'processing',
		done: 'done',
		dead: 'dead-lettered',
	};
</script>

<svelte:head>
	<title>Offboarding observability — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="offboarding">
	<h1>Offboarding observability</h1>
	<p>
		Every offboarding projection job for every left or removed membership, read directly from the outbox. This surface
		is read-only: nothing here retries or replays a job.
	</p>

	{#if !data.available}
		<p>This surface is not available right now.</p>
	{:else if !data.authenticated}
		<p>This page requires a signed-in keyholder.</p>
	{:else if data.memberships.length === 0}
		<p>No offboarded memberships yet.</p>
	{:else}
		<ul class="memberships">
			{#each data.memberships as m (m.membershipId)}
				<li>
					<article>
						<h2>{m.displayName} — {m.status}</h2>
						{#if m.endedAt}
							<p class="meta">ended {new Date(m.endedAt).toLocaleString()}</p>
						{/if}
						{#if m.jobs.length === 0}
							<p class="meta">No offboarding jobs recorded yet.</p>
						{:else}
							<table>
								<thead>
									<tr>
										<th>Job</th>
										<th>State</th>
										<th>Attempts</th>
										<th>Available at</th>
										<th>Updated</th>
										<th>Dead-letter reason</th>
									</tr>
								</thead>
								<tbody>
									{#each m.jobs as job (job.kind + job.createdAt)}
										<tr class={`state-${job.status}`}>
											<td>{job.kind}</td>
											<td>{STATE_LABEL[job.status] ?? job.status}</td>
											<td>{job.attempts} / {job.maxAttempts}</td>
											<td>{new Date(job.availableAt).toLocaleString()}</td>
											<td>{new Date(job.updatedAt).toLocaleString()}</td>
											<td>{job.status === 'dead' && job.lastError ? job.lastError : '—'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</article>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.offboarding {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
	.memberships {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 1.5rem;
	}
	.meta {
		opacity: 0.75;
		font-size: 0.9em;
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
