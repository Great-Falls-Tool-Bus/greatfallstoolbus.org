// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
// Scroll-reveal helper (Wave-3 "Quiet Devtool" WOW pass, TIN-2419).
//
// `reveal` is a `use:`-action; its paired CSS lives in src/app.css. The hidden
// start state (`.reveal-armed`) only applies under `html.motion-safe-ready`,
// which the app.html sync script adds before first paint and ONLY when motion
// is allowed — so reduced-motion and no-JS users always render content at rest.
//
// FAIL-OPEN: app.html also arms a short failsafe timer that removes
// `motion-safe-ready` if the app never hydrates (e.g. a failed bundle load), so
// a broken enhancement layer can never strand content invisible; +layout.svelte
// cancels that timer on mount. This action flips `.reveal-in` when the element
// scrolls into view, and reveals immediately where IntersectionObserver is
// unavailable.

interface RevealOptions {
	/** Stagger, in ms, applied as the CSS transition-delay for this element. */
	delay?: number;
}

export function reveal(node: HTMLElement, opts: RevealOptions = {}) {
	if (opts.delay) node.style.setProperty('--reveal-delay', `${opts.delay}ms`);

	// No IntersectionObserver (very old browsers): reveal immediately rather than
	// leave the element armed-and-hidden forever.
	if (typeof IntersectionObserver === 'undefined') {
		node.classList.add('reveal-in');
		return;
	}

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
