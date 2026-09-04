import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string): string =>
	readFileSync(path.join(repoRoot, relative), 'utf8');

describe('site.scaffold consumer boundary', () => {
	it('keeps the executable spawn transaction in the upstream scaffold', () => {
		expect(existsSync(path.join(repoRoot, 'scripts/rebrand.sh'))).toBe(false);
		expect(
			existsSync(
				path.join(repoRoot, 'docs/decisions/dynamic-spoke-adapter-mode.md'),
			),
		).toBe(false);

		const shim = read('.agents/skills/tinyland-spawn-sister-site/SKILL.md');
		expect(shim).toContain('tinyland-inc/site.scaffold');
		expect(shim).toContain('Do not execute a spawn from GFTB');
		expect(shim).not.toContain('Bash(gh repo create');
		expect(shim).not.toContain('Bash(./scripts/rebrand.sh');
		expect(shim).not.toMatch(/^\s*gh repo create/m);
		expect(shim).not.toMatch(/^\s*git push .*\bmain\b/m);
	});

	it('makes the upstream ownership mechanically discoverable', () => {
		const agents = read('AGENTS.md');
		const module = read('MODULE.bazel');
		const conformance = read('scripts/check-conformance.sh');

		expect(agents).toContain('It carries no rebrand implementation or adapter selector');
		expect(module).toContain('tinyland-inc/site.scaffold');
		expect(module).toContain('deliberately carries no rebrand implementation');
		expect(conformance).toContain('GFTB carries no copied scaffold rebrand implementation');
		expect(conformance).toContain('Sister-site skill is a discovery shim');
	});
});
