<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function money(cents: number): string {
		return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
	}
</script>

<svelte:head>
	<title>Finance — cash and check receipts — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="receipt-entry">
	<p><a href="/contributions">← Contribution ledger</a></p>
	<h1>Cash and check receipts</h1>
	<p>
		Record money actually received. Corrections append a reversal and a replacement; the original receipt stays
		unchanged.
	</p>

	{#if form && 'recorded' in form}
		<p role="status">
			{form.deduplicated ? 'That receipt was already recorded.' : 'Receipt recorded.'}
		</p>
	{:else if form && 'corrected' in form}
		<p role="status">
			{form.deduplicated ? 'That correction was already recorded.' : 'Correction recorded.'}
		</p>
	{:else if form && 'code' in form}
		<p role="alert">
			{#if form.code === 'not_authenticated' || form.code === 'not_finance'}
				A live finance session is required.
			{:else if form.code === 'finance_write_unavailable'}
				Receipt entry is not available on this build.
			{:else if form.code === 'cash_check_agreement_required'}
				That member does not have a current cash or check contribution choice.
			{:else if form.code === 'idempotency_conflict'}
				This form was already used for different receipt details. Reload before trying again.
			{:else if form.code === 'invalid_receipt'}
				Check the amount, received date, cadence, and check reference.
			{:else}
				The receipt could not be recorded.
			{/if}
		</p>
	{/if}

	{#if !data.available}
		<p>This page is not available on this build.</p>
	{:else if data.rows.length === 0}
		<p>No cash or check contribution choices are waiting for receipt entry.</p>
	{:else}
		{#each data.rows as row (row.personId)}
			<section class="member">
				<h2>{row.displayName}</h2>
				<p class="meta">{row.rail} · {row.state}</p>

				<form method="POST" action="?/record" use:enhance>
					<h3>Record a receipt</h3>
					<input type="hidden" name="personId" value={row.personId} />
					<input type="hidden" name="operationId" value={row.recordOperationId} />

					<label>
						Amount in cents
						<input type="text" name="amountCents" inputmode="numeric" pattern="[0-9]+" autocomplete="off" required />
					</label>
					<label>
						Received on
						<input type="date" name="receivedOn" required />
					</label>
					<label>
						Cadence or intention
						<select name="cadence" required>
							<option value="monthly">Monthly</option>
							<option value="annual">Annual</option>
							<option value="one_time">One time</option>
						</select>
					</label>
					{#if row.rail === 'check'}
						<label>
							Check reference, last four digits at most
							<input
								type="text"
								name="checkRefLast4"
								inputmode="numeric"
								pattern="[0-9]{1,4}"
								maxlength="4"
								autocomplete="off"
							/>
						</label>
					{/if}
					<label>
						Note (optional)
						<textarea name="note" rows="2"></textarea>
					</label>
					<button type="submit">Record receipt</button>
				</form>

				{#if row.receipts.length > 0}
					<h3>Receipt trail</h3>
					<ul class="receipts">
						{#each row.receipts as receipt (receipt.id)}
							<li>
								<p>
									<strong>{receipt.rail} {money(receipt.amountCents)}</strong>
									on {receipt.receivedOn} · {receipt.cadence} · recorded by {receipt.recordedBy.slice(0, 8)}…
									{#if receipt.reversesId}
										· reversal of {receipt.reversesId.slice(0, 8)}…
									{/if}
								</p>
								{#if receipt.note}<p class="meta">{receipt.note}</p>{/if}
								{#if receipt.checkRefLast4}<p class="meta">Check reference ending {receipt.checkRefLast4}</p>{/if}

								{#if receipt.correctable}
									<details>
										<summary>Correct this receipt</summary>
										<form method="POST" action="?/correct" use:enhance>
											<input type="hidden" name="receiptId" value={receipt.id} />
											<input type="hidden" name="operationId" value={receipt.correctOperationId} />
											<label>
												Correct amount in cents
												<input
													type="text"
													name="amountCents"
													value={receipt.amountCents}
													inputmode="numeric"
													pattern="[0-9]+"
													autocomplete="off"
													required
												/>
											</label>
											<label>
												Correct received date
												<input type="date" name="receivedOn" value={receipt.receivedOn} required />
											</label>
											<label>
												Correct cadence or intention
												<select name="cadence" required>
													<option value="monthly" selected={receipt.cadence === 'monthly'}>Monthly</option>
													<option value="annual" selected={receipt.cadence === 'annual'}>Annual</option>
													<option value="one_time" selected={receipt.cadence === 'one_time'}>One time</option>
												</select>
											</label>
											{#if receipt.rail === 'check'}
												<label>
													Check reference, last four digits at most
													<input
														type="text"
														name="checkRefLast4"
														value={receipt.checkRefLast4 ?? ''}
														inputmode="numeric"
														pattern="[0-9]{1,4}"
														maxlength="4"
														autocomplete="off"
													/>
												</label>
											{/if}
											<label>
												Replacement note (optional)
												<textarea name="note" rows="2" value={receipt.note ?? ''}></textarea>
											</label>
											<label>
												Reversal note (optional)
												<input type="text" name="reversalNote" autocomplete="off" />
											</label>
											<button type="submit">Append reversal and replacement</button>
										</form>
									</details>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	{/if}
</main>

<style>
	.receipt-entry {
		max-width: 56rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}
	.member {
		margin-top: 2rem;
		padding-top: 1.5rem;
		border-top: 1px solid rgba(0, 0, 0, 0.15);
	}
	form {
		display: grid;
		gap: 0.8rem;
		max-width: 34rem;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.035);
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	input,
	select,
	textarea,
	button {
		font: inherit;
	}
	.receipts {
		display: grid;
		gap: 1rem;
		padding-left: 1.25rem;
	}
	.receipts li {
		padding-bottom: 1rem;
		border-bottom: 1px solid rgba(0, 0, 0, 0.1);
	}
	.meta {
		opacity: 0.75;
		font-size: 0.9em;
	}
	details form {
		margin-top: 0.75rem;
	}
</style>
