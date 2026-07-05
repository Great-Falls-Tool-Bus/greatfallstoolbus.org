<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// Quiet-Devtool identity tile (Wave-3 WOW pass, TIN-2419). No roster photos
	// yet (donor imagery is operator-gated), so the default is a sharp monospace
	// initials chip derived deterministically from the name. Pass `src` later and
	// it renders the photo (sharp, object-cover); the initials stay as the
	// semantic label. Deliberately NOT Skeleton's rounded Avatar — square + mono
	// keeps the mark agent-legible, matching the view-source / spec-sheet voice.
	// Styling (mode-correct via light-dark) lives in the .avatar-tile block in
	// src/app.css so it also gets the print treatment.
	interface Props {
		name: string;
		/** Optional photo URL; falls back to initials when absent. */
		src?: string;
		/** Square edge length in px. */
		size?: number;
		class?: string;
	}

	let { name, src = '', size = 40, class: klass = '' }: Props = $props();

	const initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.map((word) => word[0])
			.join('')
			.slice(0, 2)
			.toUpperCase(),
	);
</script>

<span
	class="avatar-tile {klass}"
	style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.34)}px"
	role="img"
	aria-label={name}
	title={name}
>
	{#if src}
		<img {src} alt="" loading="lazy" />
	{:else}
		<span aria-hidden="true">{initials}</span>
	{/if}
</span>
