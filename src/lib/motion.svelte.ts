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

interface ParallaxOptions {
	/** Fraction of scroll distance the layer drifts by (0 = static, ~0.2 = subtle). */
	speed?: number;
}

// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
// Transform-based parallax for a full-bleed hero band's background layer.
//
// REDUCED-MOTION-SAFE by construction: the action reads the reduced-motion
// media query up front and, when motion is not allowed (or there is no window,
// i.e. SSR), returns without attaching any listener; the layer stays put and
// simply covers the band as a static image. No prefers-reduced-motion branch is
// needed in CSS; the effect just never starts.
//
// The layer (`node`) must be positioned inside a clipping parent (the band) and
// OVER-SCAN it on the block axis (e.g. `inset-block: -14%`) so there is vertical
// slack to translate into. The transform is clamped to that slack, so no gap can
// ever open at the band's top or bottom edge, at any scroll position or viewport
// size. rAF-throttled + passive listeners keep the scroll thread cheap.
export function parallax(node: HTMLElement, opts: ParallaxOptions = {}) {
	const speed = opts.speed ?? 0.18;
	const band = node.parentElement;
	const reduce =
		typeof window === 'undefined' ||
		!window.matchMedia ||
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Static under reduced motion / SSR: leave the layer centered over the band.
	if (reduce || !band) return;

	let raf = 0;
	const update = () => {
		raf = 0;
		const rect = band.getBoundingClientRect();
		// Half the over-scan is the slack available on each edge.
		const slack = Math.max(0, (node.offsetHeight - band.offsetHeight) / 2);
		// As the band scrolls up past the viewport top, drift the layer DOWN at a
		// fraction of that distance so it appears to recede. Clamp to the slack.
		const drift = -rect.top * speed;
		const clamped = Math.max(-slack, Math.min(slack, drift));
		node.style.transform = `translate3d(0, ${clamped.toFixed(2)}px, 0)`;
	};
	const onScroll = () => {
		if (!raf) raf = requestAnimationFrame(update);
	};

	update();
	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', onScroll, { passive: true });

	return {
		destroy() {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			if (raf) cancelAnimationFrame(raf);
		},
	};
}
