import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const svelteCheckCli = resolve(dirname(require.resolve('svelte-check/package.json')), 'bin/svelte-check');

const child = spawn(process.execPath, [svelteCheckCli, '--tsconfig', './tsconfig.json'], {
	stdio: 'inherit',
});

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});

child.on('exit', (code) => {
	process.exit(code ?? 1);
});
