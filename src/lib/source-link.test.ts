import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source-map enforcement contract (TIN-2360 view/edit page source subsystem).
//
// Every substantive page renders the shared PageHeader, and PageHeader wires in
// SourceLink (the "View source" / "Edit this page" affordance). This test asserts
// that every route which renders PageHeader resolves to an entry in the generated
// source map, so a new prose page cannot silently ship without the git-onboarding
// affordance: it would either be missing from the map (fails here) or leave the
// generated file stale (fails `just source-map-check`).
//
// The map and this test move together with the routes tree; regenerate with
// `just source-map-build` when routes change.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const routesDir = path.join(repoRoot, 'src', 'routes');

const sourceMap = JSON.parse(
	readFileSync(path.join(repoRoot, 'src', 'lib', 'generated', 'source-map.json'), 'utf8'),
) as {
	repoUrl: string;
	branch: string;
	routes: Record<string, string>;
};

// SvelteKit route id from a repo-relative +page.svelte path (matches the
// generator: base-stripped, "/" for root, route-group segments dropped).
function routeIdFor(relPageFile: string): string {
	const dir = path.dirname(relPageFile).slice('src/routes'.length);
	const segments = dir.split('/').filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
	return segments.length ? `/${segments.join('/')}` : '/';
}

function walkPageFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walkPageFiles(full));
		} else if (entry.name === '+page.svelte') {
			out.push(full);
		}
	}
	return out;
}

const pageFiles = walkPageFiles(routesDir).map((full) => path.relative(repoRoot, full).split(path.sep).join('/'));

const pageHeaderRoutes = pageFiles
	.filter((rel) => /\bPageHeader\b/.test(readFileSync(path.join(repoRoot, rel), 'utf8')))
	.map((rel) => ({ rel, routeId: routeIdFor(rel) }));

describe('view/edit page source subsystem', () => {
	it('resolves a valid repo URL and branch from config (no hardcoded org/repo in components)', () => {
		expect(sourceMap.repoUrl).toMatch(/^https:\/\/github\.com\/.+\/.+/);
		expect(sourceMap.branch).toBeTruthy();
	});

	it('found at least one route that renders PageHeader (sanity)', () => {
		expect(pageHeaderRoutes.length).toBeGreaterThan(0);
	});

	it('maps every PageHeader route to its own source path so none can silently lack the affordance', () => {
		const missing = pageHeaderRoutes.filter(({ routeId }) => !sourceMap.routes[routeId]);
		expect(
			missing,
			`routes rendering PageHeader but absent from the source map: ${missing.map((m) => m.routeId).join(', ')}`,
		).toEqual([]);
	});

	it('points each PageHeader route at the actual +page.svelte on disk', () => {
		for (const { rel, routeId } of pageHeaderRoutes) {
			expect(sourceMap.routes[routeId], `route ${routeId} should map to ${rel}`).toBe(rel);
		}
	});
});
