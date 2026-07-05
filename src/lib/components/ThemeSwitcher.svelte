<script lang="ts">
	import { Sun, Moon } from '@lucide/svelte';
	import { theme } from '$lib/theme.svelte';

	// Animated light/dark slider. The knob crossfades a sun<->moon glyph as it
	// travels between the two ends. The switch reflects the RESOLVED mode
	// (theme.isDark), so it reads correctly whether the user picked an explicit
	// mode or is on `system`. Flipping it always sets an explicit light/dark.
	//
	// A tiny secondary "auto" dot keeps `system` reachable after the user has
	// chosen an explicit mode; new visitors default to `system` (store default),
	// so the auto dot starts active. This is NOT a menu: it is one toggle plus
	// one reset affordance.
	//
	// Reduced motion: the sliding/crossfade transitions collapse to an instant
	// state change via the global `prefers-reduced-motion` rule in src/app.css
	// (transition-duration: 0.01ms !important), so no motion-safe gate is needed
	// here.

	function toggle() {
		theme.setMode(theme.isDark ? 'light' : 'dark');
	}

	function useSystem() {
		theme.setMode('system');
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

	<button
		type="button"
		class="theme-slider__auto"
		class:is-active={theme.mode === 'system'}
		aria-pressed={theme.mode === 'system'}
		aria-label="Use system color scheme"
		title="Match system color scheme"
		onclick={useSystem}
	>
		<span class="theme-slider__auto-dot" aria-hidden="true"></span>
		<span class="theme-slider__auto-label">auto</span>
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

	/* ── Auto (system) reset ────────────────────────────────────────── */
	.theme-slider__auto {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid transparent;
		border-radius: 0;
		background: none;
		cursor: pointer;
		/* surface-600/400 (paired) clears WCAG AA at this 11px small-caps size,
		   where a flat surface-500 sat just under the contrast floor. */
		color: light-dark(var(--color-surface-600), var(--color-surface-400));
		font-size: 0.6875rem;
		line-height: 1;
		letter-spacing: 0.02em;
		transition:
			color 200ms ease,
			border-color 200ms ease,
			background-color 200ms ease;
	}
	.theme-slider__auto:hover {
		color: light-dark(var(--color-surface-700), var(--color-surface-300));
	}
	.theme-slider__auto.is-active {
		color: var(--color-primary-500);
		border-color: color-mix(in oklch, var(--color-primary-500) 40%, transparent);
		background: color-mix(in oklch, var(--color-primary-500) 12%, transparent);
	}
	.theme-slider__auto:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}

	.theme-slider__auto-dot {
		width: 7px;
		height: 7px;
		border-radius: 0;
		background: currentColor;
		opacity: 0.55;
		transition: opacity 200ms ease;
	}
	.theme-slider__auto.is-active .theme-slider__auto-dot {
		opacity: 1;
	}

	.theme-slider__auto-label {
		font-variant: small-caps;
	}
</style>
