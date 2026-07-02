import { expect, test } from '@playwright/test';

// Static scaffold regression guard: no document-level horizontal overflow at
// canonical breakpoints, and every same-page hash link on the home route
// resolves to an actual element.

const breakpoints = [
	{ label: 'mobile-small', width: 390, height: 1200 },
	{ label: 'mobile-large', width: 430, height: 1200 },
	{ label: 'tablet', width: 768, height: 1200 },
	{ label: 'desktop', width: 1440, height: 1200 },
];

for (const bp of breakpoints) {
	test(`home page has no document overflow at ${bp.label} (${bp.width}px)`, async ({ page }) => {
		await page.setViewportSize({ width: bp.width, height: bp.height });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const { scrollWidth, innerWidth } = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		}));
		// Tolerate up to 1px subpixel rounding; anything beyond means real overflow.
		expect(scrollWidth, `${bp.label} document overflow`).toBeLessThanOrEqual(innerWidth + 1);
	});
}

test('home-route same-page hash links all resolve to an element', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const broken = await page.evaluate(() => {
		const hashes = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
			.map((a) => a.getAttribute('href') ?? '')
			.filter((h) => h.startsWith('/#') || h.startsWith('#'))
			.map((h) => (h.startsWith('/#') ? h.slice(1) : h));
		const unique = Array.from(new Set(hashes));
		return unique.filter((h) => h.length > 1 && !document.querySelector(h));
	});
	expect(broken, 'home-route hash targets without matching element').toEqual([]);
});
