<script lang="ts">
	import { Sun, Moon } from '@lucide/svelte';
	import { theme } from '$lib/theme.svelte';

	// Animated light/dark slider. The knob crossfades a sun<->moon glyph as it
	// travels between the two ends. The switch reflects the RESOLVED mode
	// (theme.isDark), so it reads correctly whether the user picked an explicit
	// mode or is on `system`. Flipping it always sets an explicit light/dark.
	//
	// New visitors default to `system` (store default), so the switch follows the
	// OS color scheme until the user flips it, at which point an explicit
	// light/dark is persisted. This is a single two-state toggle, not a menu.
	//
	// Reduced motion: the sliding/crossfade transitions collapse to an instant
	// state change via the global `prefers-reduced-motion` rule in src/app.css
	// (transition-duration: 0.01ms !important), so no motion-safe gate is needed
	// here.

	function toggle() {
		theme.setMode(theme.isDark ? 'light' : 'dark');
	}
</script>

<div class="theme-slider" role="group" aria-label="Color mode">
	<button
		type="button"
		role="switch"
		aria-checked={theme.isDark}
		aria-label="Dark mode"
		title={theme.mode === 'system' ? 'Auto (matches your system)' : theme.isDark ? 'Dark mode' : 'Light mode'}
		class="theme-slider__switch"
		class:is-dark={theme.isDark}
		onclick={toggle}
	>
		<span class="theme-slider__track" aria-hidden="true">
			<span class="theme-slider__knob">
				<Sun class="theme-slider__glyph theme-slider__glyph--sun" aria-hidden="true" />
				<Moon class="theme-slider__glyph theme-slider__glyph--moon" aria-hidden="true" />
			</span>
		</span>
	</button>
</div>

<style>
	.theme-slider {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* ── Sliding switch ─────────────────────────────────────────────── */
	.theme-slider__switch {
		display: inline-flex;
		align-items: center;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		line-height: 0;
		border-radius: 0;
	}

	.theme-slider__track {
		position: relative;
		display: block;
		width: 52px;
		height: 28px;
		border-radius: 0;
		padding: 3px;
		box-sizing: border-box;
		background: light-dark(var(--color-surface-300), var(--color-surface-700));
		border: 1px solid light-dark(var(--color-surface-400), var(--color-surface-600));
		transition:
			background-color 200ms ease,
			border-color 200ms ease;
	}

	.theme-slider__switch.is-dark .theme-slider__track {
		background: color-mix(
			in oklch,
			var(--color-primary-500) 30%,
			light-dark(var(--color-surface-300), var(--color-surface-800))
		);
		border-color: color-mix(in oklch, var(--color-primary-500) 45%, transparent);
	}

	.theme-slider__knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 22px;
		height: 22px;
		border-radius: 0;
		display: grid;
		place-items: center;
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500, #fff);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
		transform: translateX(0);
		transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.theme-slider__switch.is-dark .theme-slider__knob {
		transform: translateX(24px);
	}

	/* Crossfade the two glyphs inside the knob. */
	.theme-slider :global(.theme-slider__glyph) {
		grid-area: 1 / 1;
		width: 14px;
		height: 14px;
		transition:
			opacity 200ms ease,
			transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.theme-slider :global(.theme-slider__glyph--sun) {
		opacity: 1;
		transform: rotate(0deg) scale(1);
	}
	.theme-slider :global(.theme-slider__glyph--moon) {
		opacity: 0;
		transform: rotate(-90deg) scale(0.6);
	}
	.theme-slider__switch.is-dark :global(.theme-slider__glyph--sun) {
		opacity: 0;
		transform: rotate(90deg) scale(0.6);
	}
	.theme-slider__switch.is-dark :global(.theme-slider__glyph--moon) {
		opacity: 1;
		transform: rotate(0deg) scale(1);
	}

	.theme-slider__switch:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
</style>
