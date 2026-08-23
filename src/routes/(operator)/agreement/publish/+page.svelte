<script lang="ts">
	// TIN-3440 slice S13. Placeholder copy in the published:false/TODO posture
	// — an allowlisted-operator surface, never public marketing copy.
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Publish agreement version — Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="agreement-publish">
	<h1>Publish an agreement version</h1>
	<p>
		Publishing appends a new, permanent version. Versions are never edited or deleted once published, and publishing
		does not open applications — that is a separate switch. Confirm the text carefully; there is no undo.
	</p>

	{#if !data.available}
		<p>This surface is not available right now.</p>
	{:else if !data.authenticated}
		<p>A live keyholder session is required.</p>
	{:else if !data.authorized}
		<p>This session is not authorized to publish agreement versions.</p>
	{:else}
		{#if form && 'published' in form && form.published}
			<section aria-live="polite">
				<h2>Published</h2>
				<dl>
					<dt>Version</dt>
					<dd>{form.version}</dd>
					<dt>SHA-256</dt>
					<dd><code>{form.bodySha256}</code></dd>
					<dt>Effective from (UTC)</dt>
					<dd>{form.effectiveFrom}</dd>
				</dl>
			</section>
		{:else if form && 'code' in form}
			<p role="alert">
				{#if form.code === 'body_required'}
					The agreement text is required.
				{:else if form.code === 'confirmation_required'}
					Please check the confirmation box to proceed.
				{:else if form.code === 'reauth_required' || form.code === 'bad_credentials'}
					Please re-enter your password to confirm.
				{:else if form.code === 'stale_preview' || form.code === 'version_race'}
					The version number changed while this page was open. Reload and try again.
				{:else if form.code === 'invalid_effective_from'}
					The effective-from date could not be read. Reload and try again.
				{:else if form.code === 'not_operator'}
					This session is not authorized to publish agreement versions.
				{:else if form.code === 'rate_limited'}
					Too many attempts. Wait and try again.
				{:else}
					The publish could not be completed.
				{/if}
			</p>
		{/if}

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
		>
			<p>This would become <strong>version {data.nextVersionId}</strong>.</p>
			<input type="hidden" name="expectedNextVersionId" value={data.nextVersionId} />

			<label>
				Agreement text (required, verbatim)
				<textarea name="body" rows="16" required></textarea>
			</label>

			<label>
				Effective from, UTC (optional — defaults to now). This clock reads your browser's local time zone but the value
				is stored and interpreted as UTC — convert before typing if that is not UTC.
				<input type="datetime-local" name="effectiveFrom" />
			</label>

			<label>
				<input type="checkbox" name="confirm" required />
				I have reviewed this text exactly as it will be published. This cannot be undone.
			</label>

			<label>
				Your password (required, fresh)
				<input type="password" name="password" autocomplete="current-password" required />
			</label>

			<button type="submit" disabled={submitting}>Publish version {data.nextVersionId}</button>
		</form>
	{/if}
</main>
