#!/usr/bin/env node
// Build @tummycrypt/tinyvectors' dist/ + dist-types/ from its pinned source
// archive after every install (wired as this repo's root `prepare` script).
//
// WHY THIS EXISTS: the package is deliberately NOT resolved from the public
// npm registry (the npm channel for in-house @tummycrypt packages is retired;
// the tinyland-inc/bazel-registry graph is the sole rail). package.json pins
// the exact GitHub tag archive that the registry names in
// modules/tummycrypt_tinyvectors/<version>/source.json — the same seam the
// Bazel SSOT consumes (registry sha256 for v0.3.4:
// BSnkL1bEhtTRSLeeRLf8POiY5K8cbxCtJXukIQcO9L8=). That archive ships source
// only: no dist/, and upstream has no `prepare` script pnpm could run for us.
// So this hook compiles the package once per install, in a scratch directory,
// using the package's own toolchain and its own committed pnpm-lock.yaml.
//
// INVARIANTS:
// - Idempotent: exits fast when dist/ + dist-types/ are already present
//   (pnpm re-creates the package directory whenever the pinned resolution
//   changes, which clears the sentinel and forces a rebuild).
// - The scratch build happens OUTSIDE node_modules and only dist/ +
//   dist-types/ are copied back: the installed package must never gain a
//   nested node_modules (a second svelte runtime would break the site).
// - `scripts/check-inhouse-package-parity.py` (`just inhouse-package-parity`,
//   aggregated by `just conformance` / `just scaffold-doctor`) separately
//   enforces that the pinned tag version matches MODULE.bazel.

import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linkPath = path.join(root, 'node_modules', '@tummycrypt', 'tinyvectors');

if (!existsSync(linkPath)) {
	console.error('build-tinyvectors: @tummycrypt/tinyvectors is not installed; run pnpm install first');
	process.exit(1);
}

const pkgDir = realpathSync(linkPath);
const sentinels = ['dist/index.js', 'dist/svelte/index.js', 'dist-types/index.d.ts'];
if (sentinels.every((rel) => existsSync(path.join(pkgDir, rel)))) {
	console.log('build-tinyvectors: dist/ already present, skipping');
	process.exit(0);
}

// Nested pnpm invocations must not inherit the outer install's lifecycle
// environment (npm_config_* / PNPM_*), or flags like --frozen-lockfile and
// registry/workspace state would leak into the package's own install.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_|PNPM_)/i.test(key)));

const scratch = mkdtempSync(path.join(tmpdir(), 'tinyvectors-build-'));
const run = (args) => {
	const result = spawnSync('pnpm', args, { cwd: scratch, stdio: 'inherit', env });
	if (result.status !== 0) {
		console.error(`build-tinyvectors: pnpm ${args.join(' ')} failed`);
		process.exit(result.status ?? 1);
	}
};

try {
	cpSync(pkgDir, scratch, {
		recursive: true,
		// pkgDir itself lives under node_modules/.pnpm — filter on the path
		// RELATIVE to the package root, or everything gets excluded.
		filter: (src) => !path.relative(pkgDir, src).split(path.sep).includes('node_modules'),
	});
	run(['install', '--frozen-lockfile', '--ignore-workspace']);
	run(['run', 'build']);
	for (const dir of ['dist', 'dist-types']) {
		const built = path.join(scratch, dir);
		if (!existsSync(built)) {
			console.error(`build-tinyvectors: expected build output ${dir}/ is missing`);
			process.exit(1);
		}
		rmSync(path.join(pkgDir, dir), { recursive: true, force: true });
		cpSync(built, path.join(pkgDir, dir), { recursive: true });
	}
	console.log('build-tinyvectors: built dist/ + dist-types/ from the pinned source archive');
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
