import { expect, test } from '@playwright/test';

// Mobile drawer stacking regression guard (iPhone SE, 375px): the Skeleton
// Dialog drawer must portal out of the saturn-nav AppBar. Rendered inline, the
// AppBar's backdrop-filter makes it the containing block for fixed descendants
// (CSS Filter Effects 2), which once collapsed the open drawer to a ~52px strip
// hidden behind the page content. These tests pin the fixed geometry to the
// viewport and prove the items actually receive the tap.

test.use({ viewport: { width: 375, height: 667 } });

test('mobile drawer overlays the full viewport at 375px', async ({ page }) => {
	await page.goto('/');
	// Hydration gate: the burger's listener attaches client-side.
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Open navigation' }).click();

	const content = page.locator('[data-scope="dialog"][data-part="content"]');
	await expect(content).toBeVisible();

	const geometry = await page.evaluate(() => {
		const backdrop = document.querySelector('[data-scope="dialog"][data-part="backdrop"]');
		const drawer = document.querySelector('[data-scope="dialog"][data-part="content"]');
		return {
			backdrop: backdrop?.getBoundingClientRect() ?? null,
			drawer: drawer?.getBoundingClientRect() ?? null,
			drawerInsideAppBar: !!drawer?.closest('.saturn-nav'),
			viewport: { width: window.innerWidth, height: window.innerHeight },
		};
	});

	// Portaled to <body>, never a descendant of the glass AppBar.
	expect(geometry.drawerInsideAppBar, 'drawer must portal out of the AppBar').toBe(false);
	// Backdrop covers the viewport, drawer spans its full height.
	expect(geometry.backdrop?.width, 'backdrop width').toBe(geometry.viewport.width);
	expect(geometry.backdrop?.height, 'backdrop height').toBe(geometry.viewport.height);
	expect(geometry.drawer?.height, 'drawer height').toBe(geometry.viewport.height);
});

test('mobile drawer items are hittable and navigate', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Open navigation' }).click();

	const missionLink = page.locator('[data-scope="dialog"][data-part="content"] a', { hasText: 'Mission' });
	await expect(missionLink).toBeVisible();

	// The link's center must actually receive the tap (no content stacked over it).
	const hittable = await missionLink.evaluate((el) => {
		const rect = el.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
		return el === hit || el.contains(hit);
	});
	expect(hittable, 'drawer nav item receives the tap at its center').toBe(true);

	await missionLink.click();
	// Generous timeout: local runs against `vite dev` compile /mission on demand.
	await expect(page).toHaveURL(/\/mission\/?$/, { timeout: 15_000 });
	await expect(page.locator('[data-scope="dialog"][data-part="content"]')).toBeHidden();
});
