// ── HOUSE CANON IDIOM ────────────────────────────────────────────────────────
// `$effect` that ALWAYS returns its teardown. Models the production scroll
// pattern from MassageIthaca's +layout.svelte (TIN-2225):
//   • a rAF-throttled scroll handler (coalesces bursts to one read per frame),
//   • a `{ passive: true }` listener (never blocks the scroll thread),
//   • a `$effect` whose cleanup is returned on EVERY path — never a bare
//     `return;`. A missed teardown leaks the window listener across HMR and
//     client-side navigations, which is the single most common rune-effect bug.
//
// `$state` + `$effect` are valid in `.svelte.ts` modules; the returned object
// exposes the reactive values via getters so callers read them like fields.
//
// Usage (inside a component <script lang="ts">):
//   import { createScrollState } from '$lib/runes/scroll-state.svelte';
//   const scroll = createScrollState({ shrinkAt: 24 });
//   // …then reference `scroll.scrolled` / `scroll.y` in markup.

export interface ScrollStateOptions {
	/** scrollY (px) past which `scrolled` flips to true. Defaults to 24. */
	shrinkAt?: number;
}

export interface ScrollState {
	/** True once the page has scrolled past `shrinkAt`. */
	readonly scrolled: boolean;
	/** Latest sampled `window.scrollY`. */
	readonly y: number;
}

export function createScrollState(options: ScrollStateOptions = {}): ScrollState {
	const shrinkAt = options.shrinkAt ?? 24;

	let scrolled = $state(false);
	let y = $state(0);

	$effect(() => {
		let ticking = false;
		const onScroll = () => {
			if (ticking) return;
			ticking = true;
			requestAnimationFrame(() => {
				y = window.scrollY;
				const next = window.scrollY > shrinkAt;
				if (next !== scrolled) scrolled = next;
				ticking = false;
			});
		};
		// Prime once so initial paint reflects a non-zero starting scroll position.
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		// ALWAYS return teardown. Even with a single setup path, the idiom is to
		// make cleanup unconditional so future edits can't introduce a leak.
		return () => {
			window.removeEventListener('scroll', onScroll);
		};
	});

	return {
		get scrolled() {
			return scrolled;
		},
		get y() {
			return y;
		},
	};
}
