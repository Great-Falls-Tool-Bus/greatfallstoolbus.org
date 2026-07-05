<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// Quiet-Devtool identity tile (Wave-3 WOW pass, TIN-2419). No roster photos
	// yet (donor imagery is operator-gated), so the default is a sharp monospace
	// initials chip derived deterministically from the name. Pass `src` later and
	// it renders the photo (sharp, object-cover); the initials stay as the
	// semantic label. Deliberately NOT Skeleton's rounded Avatar — square + mono
	// keeps the mark agent-legible, matching the view-source / spec-sheet voice.
	// Styling (mode-correct via light-dark) lives in the .avatar-tile block in
	// src/app.css so it also gets the print treatment. A per-name brand tint is
	// fed in via the `--tile-accent` custom property (see $lib/tint): it recolors
	// only the faint background wash + border, so the initials keep the theme's
	// primary ink and stay >= 4.5:1 in both modes. The tile is aria-hidden: the
	// person's name is carried by the adjacent heading, so the mark is decorative
	// and must not double-announce the name.
	import { tintFor } from '$lib/tint';

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

	const tint = $derived(tintFor(name));
</script>

<span
	class="avatar-tile {klass}"
	style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.34)}px;--tile-accent:{tint}"
	aria-hidden="true"
>
	{#if src}
		<img {src} alt="" loading="lazy" />
	{:else}
		<span aria-hidden="true">{initials}</span>
	{/if}
</span>
