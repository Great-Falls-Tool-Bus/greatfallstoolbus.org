import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const svelteKitCli = resolve(dirname(require.resolve('@sveltejs/kit/package.json')), 'svelte-kit.js');

const child = spawn(process.execPath, [svelteKitCli, 'sync', '--mode', 'production'], {
	stdio: 'inherit',
});

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});

child.on('exit', (code) => {
	if (code !== 0) {
		process.exit(code ?? 1);
	}

	if (!existsSync('.svelte-kit/tsconfig.json')) {
		console.error('svelte-kit sync did not generate .svelte-kit/tsconfig.json');
		process.exit(1);
	}
});
