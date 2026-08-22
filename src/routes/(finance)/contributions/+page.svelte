<script lang="ts">
	// TIN-3818 slice S10. Finance-role-only operational surface — noindex, like
	// the keyholder review queue. READ-ONLY: there is no form, no action, no
	// button that mutates anything on this page. Recipient-neutral copy
	// throughout — "contribution", never "donation"; no payer named beyond
	// their own display name, which the schema already shows this role.
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function money(cents: number | null): string {
		if (cents === null) return '—';
		return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
	}
</script>

<svelte:head>
	<title>Finance — contributions — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="finance">
	<h1>Contributions</h1>

	{#if !data.available}
		<p>This page is not available on this build.</p>
	{:else}
		<p class="gate" role="status">
			Stripe live mode: {data.liveGate.open ? 'OPEN' : 'CLOSED (test-mode only)'} — {data.liveGate.reason}
		</p>

		{#if data.rows.length === 0}
			<p>No contribution offers recorded yet.</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Member</th>
						<th>State</th>
						<th>Rail</th>
						<th>Cadence</th>
						<th>Amount</th>
						<th>Help requested</th>
						<th>Receipts (net)</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as row (row.personId)}
						<tr>
							<td>{row.displayName}</td>
							<td>{row.state}</td>
							<td>{row.rail ?? '—'}</td>
							<td>{row.cadence ?? '—'}</td>
							<td>{money(row.amountCents)}</td>
							<td>{row.helpRequested ? 'yes' : 'no'}</td>
							<td>{money(row.netReceiptsCents)}</td>
						</tr>
						{#if row.receipts.length > 0}
							<tr class="receipts">
								<td colspan="7">
									<ul>
										{#each row.receipts as receipt (receipt.id)}
											<li>
												{receipt.rail}
												{money(receipt.amountCents)} on {receipt.receivedOn}
												{#if receipt.reversesId}(reversal of {receipt.reversesId.slice(0, 8)}…){/if}
												{#if receipt.note}— {receipt.note}{/if}
											</li>
										{/each}
									</ul>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	{/if}
</main>

<style>
	.finance {
		max-width: 64rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
	.gate {
		opacity: 0.75;
		font-size: 0.9em;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.1);
	}
	.receipts ul {
		list-style: none;
		margin: 0;
		padding: 0 0 0.5rem;
		font-size: 0.9em;
		opacity: 0.85;
	}
</style>
