<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// A Wikipedia "citation needed" flag for the tool inventory. When a tool is
	// genuinely in the kit but a real specific (model number, photo, config) is
	// not yet documented, we do NOT invent the fact. We show this calm inline
	// chip instead, naming exactly what is missing and offering the edit-source
	// affordance so the owner (Jess, Ripley, a captain) can fill it in and open
	// a PR. This is the honest-inventory doctrine (see $lib/data/cells.ts) made
	// visible: a gap is a link, not a lie.
	//
	// Typed `interface Props` + `$props()`, per the SEOHead / PageHeader house
	// rune shape. The edit URL is resolved through $lib/repo.ts (which converges
	// with the #60 view-source source map when that lands).
	import { editUrl } from '$lib/repo';

	interface Props {
		/** What is still missing, in fill order (e.g. ['model number', 'photo']). */
		wanted?: readonly string[];
		/** Repo-relative .svx source path this chip lets a contributor edit. */
		sourcePath: string;
		/** Tool name, for an accessible edit-link label. */
		name?: string;
	}

	let { wanted = [], sourcePath, name = '' }: Props = $props();

	const list = $derived(wanted.filter((w) => w.trim().length > 0));
	const summary = $derived(list.length ? `Details needed: ${list.join(', ')}.` : 'Details needed.');
	const href = $derived(editUrl(sourcePath));
	const editLabel = $derived(
		name ? `Edit ${name} to add the missing details` : 'Edit this page to add the missing details',
	);
</script>

<p class="details-needed" role="note">
	<span class="details-tag">{summary}</span>
	<span class="details-invite"
		>Know this tool?
		<a class="details-edit" {href} rel="external noopener" aria-label={editLabel}>Edit this page</a>.</span
	>
</p>

<style>
	/* Calm, civic, not alarming: a muted tonal note, warm border accent, small
	 * type. Reads as an invitation, not an error. */
	.details-needed {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35em 0.5em;
		margin-top: 0.5rem;
		padding: 0.4rem 0.6rem;
		border-left: 2px solid var(--color-warning-500, currentColor);
		border-radius: var(--radius-container, 0.25rem);
		background: color-mix(in oklab, currentColor 4%, transparent);
		font-size: 0.8rem;
		line-height: 1.4;
	}
	.details-tag {
		font-weight: 600;
	}
	.details-invite {
		opacity: 0.85;
	}
	.details-edit {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* Print: the printed sheet is meant to be filled in by hand, so drop the
	 * chrome and the (unclickable) edit link, keeping only the honest text of
	 * what still needs recording. */
	@media print {
		.details-needed {
			display: block;
			border: none;
			background: transparent;
			padding: 0;
			font-style: italic;
		}
		.details-edit {
			display: none;
		}
	}
</style>
