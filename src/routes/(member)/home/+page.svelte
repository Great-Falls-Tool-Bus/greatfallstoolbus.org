<script lang="ts">
	// TIN-3818 slice S7. Placeholder copy in the published:false/TODO posture —
	// reachable only by an activated member's session; operator copy review
	// lands with launch. The agreement body shown is the operator-published
	// version row the member assented to (sitting-2 item 3), never agent copy.
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Home — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="member-home">
	<h1>Welcome</h1>

	{#if !data.available}
		<p>Member services are not available right now.</p>
	{:else if !data.authenticated}
		<p>Please sign in.</p>
	{:else if data.member === null}
		<p>No membership record is linked to this account.</p>
	{:else}
		<p>Hello, {data.member.displayName}.</p>

		<section aria-label="Membership">
			<h2>Your membership</h2>
			<dl>
				<dt>Status</dt>
				<dd>{data.member.membership.status}</dd>
				<dt>Borrowing</dt>
				<dd>{data.member.membership.canBorrow ? 'available' : 'not available'}</dd>
			</dl>
			<p><a href="/membership">Manage your membership</a></p>
		</section>

		{#if data.member.agreement}
			<section aria-label="Membership agreement">
				<h2>Your agreement</h2>
				<p>
					You agreed to version {data.member.agreement.versionId} of the membership agreement on
					{new Date(data.member.agreement.assentedAt).toLocaleDateString()}.
				</p>
				<details>
					<summary>Read the agreement you signed</summary>
					<pre>{data.member.agreement.body}</pre>
				</details>
			</section>
		{/if}

		<section aria-label="Contribution">
			<h2>Contribution — optional</h2>
			{#if data.member.contribution.state === 'none'}
				<!-- The offer is a doorway, never a gate: skipping it entirely is
				     valid, and $0 is a complete answer (ADR 0014 §4). -->
				<p>
					If you'd like to, you can set up a contribution — including $0, cash, or check. It is entirely optional and
					never affects your membership.
				</p>
				<p><a href="/contribution">See the contribution choices</a></p>
			{:else}
				<p>
					You have a contribution choice on record.
					<a href="/contribution">Review or change it</a> any time — it never affects your membership.
				</p>
			{/if}
		</section>
	{/if}
</main>
