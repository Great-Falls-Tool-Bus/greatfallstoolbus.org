import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const viteCli = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const svelteKitCli = resolve(dirname(require.resolve('@sveltejs/kit/package.json')), 'svelte-kit.js');

if (existsSync('.svelte-kit/tsconfig.json')) {
	const tempDir = mkdtempSync(join(tmpdir(), 'site-scaffold-svelte-kit-'));
	const tempTypes = join(tempDir, '.svelte-kit');

	cpSync('.svelte-kit', tempTypes, { recursive: true, dereference: true });
	rmSync('.svelte-kit', { recursive: true, force: true });
	cpSync(tempTypes, '.svelte-kit', { recursive: true });
	chmodTree('.svelte-kit');
} else {
	// Remote-hermeticity: on the gf-reapi-cell worker the action cwd does not
	// carry `.svelte-kit` where this script expects it, so the silent skip left
	// the root tsconfig's `extends: ./.svelte-kit/tsconfig.json` dangling and
	// vite:oxc died `Tsconfig not found` (GF fresh-repo-enrollment-proof run
	// 28552810980). Regenerate it in-action instead — the exec scratch is
	// writable, and this mirrors the tinyland-goo #12 fix ("sync recreates
	// .svelte-kit fresh and writable"). Spawn the hermetic node on the real JS
	// entrypoint (node_modules/.bin shims die on remote workers).
	const sync = spawnSync(process.execPath, [svelteKitCli, 'sync'], { stdio: 'inherit' });
	if (sync.error) {
		console.error(sync.error);
		process.exit(1);
	}
	if (sync.status !== 0) {
		console.error(`svelte-kit sync failed (exit ${sync.status ?? sync.signal})`);
		process.exit(sync.status ?? 1);
	}
}

// Remote-hermeticity, part two (TIN-2349): rolldown/oxc discovers tsconfig per
// source file by walking up from the file's EXECROOT path, not from the bindir
// copy this action runs in. It lands on the source-root `tsconfig.json` (a
// declared input), follows `extends: ./.svelte-kit/tsconfig.json` — and that
// directory only materializes under bazel-out, so the strict remote worker
// dies `Tsconfig not found <execroot>/.svelte-kit/tsconfig.json` (GF
// fresh-repo-enrollment-proof run 28597945172). Local builds leak green
// because the physical checkout's dev-generated `.svelte-kit` stays readable.
// Mirror the bindir `.svelte-kit` to the execroot root so both resolution
// bases agree.
const execroot = process.env.JS_BINARY__EXECROOT;
if (execroot && resolve(execroot) !== resolve(process.cwd())) {
	const execrootTypes = join(execroot, '.svelte-kit');
	if (!existsSync(join(execrootTypes, 'tsconfig.json'))) {
		cpSync('.svelte-kit', execrootTypes, { recursive: true, dereference: true });
	}
}

const child = spawn(process.execPath, [viteCli, 'build'], {
	stdio: 'inherit',
});

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});

child.on('exit', (code) => {
	process.exit(code ?? 1);
});

function chmodTree(path) {
	const stat = statSync(path);
	if (stat.isDirectory()) {
		chmodSync(path, 0o755);
		for (const entry of readdirSync(path)) {
			chmodTree(join(path, entry));
		}
	} else {
		chmodSync(path, 0o644);
	}
}
