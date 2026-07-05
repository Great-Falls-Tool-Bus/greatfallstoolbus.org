// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
// Shared motion helpers (Wave-3 "Quiet Devtool" WOW pass, TIN-2419).
//
// Two exports:
//   • prefersReducedMotion — one house signal, promoted from the per-surface
//     MediaQuery that /contact hand-rolled (TIN-2420). JS transitions read
//     `prefersReducedMotion.current` instead of each re-instantiating the query.
//   • reveal — a `use:`-action scroll-reveal. See src/app.css for the paired
//     CSS. It is deliberately flash-free AND no-JS/SSR/reduced-motion safe:
//     the hidden start state (`.reveal-armed`) only bites under
//     `html.motion-safe-ready`, a class the app.html sync script adds before
//     first paint and ONLY when motion is allowed. So the action just flips
//     `.reveal-in` when the element enters the viewport; if JS is absent, motion
//     is reduced, or IntersectionObserver is missing, content renders at rest.

import { MediaQuery } from 'svelte/reactivity';

/** House reduced-motion signal. SSR-safe (`.current` is false on the server). */
export const prefersReducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');

interface RevealOptions {
	/** Stagger, in ms, applied as the CSS transition-delay for this element. */
	delay?: number;
}

/**
 * `use:reveal` — settle an element in when it scrolls into view. The hidden
 * start state lives in CSS (`html.motion-safe-ready .reveal-armed`); mark the
 * element with `class="reveal-armed"` so SSR carries the state and there is no
 * paint flash. This action only observes intersection and adds `.reveal-in`.
 */
export function reveal(node: HTMLElement, opts: RevealOptions = {}) {
	if (typeof IntersectionObserver === 'undefined') return;
	if (opts.delay) node.style.setProperty('--reveal-delay', `${opts.delay}ms`);

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					node.classList.add('reveal-in');
					io.unobserve(node);
				}
			}
		},
		{ rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
	);
	io.observe(node);

	return {
		destroy() {
			io.disconnect();
		},
	};
}
