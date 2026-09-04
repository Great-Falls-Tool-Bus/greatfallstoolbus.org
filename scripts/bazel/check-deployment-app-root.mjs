#!/usr/bin/env node
/** Exercise the exact app root exported inside //:deployment_bundle. */

import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const appRootArg = process.argv[2];
if (!appRootArg) throw new Error('expected the extracted deployment_app_root path');

const appRoot = await realpath(path.resolve(appRootArg));
const nodeModulesPath = path.join(appRoot, 'node_modules');
const pgPath = path.join(nodeModulesPath, 'pg');

if (!(await lstat(nodeModulesPath)).isSymbolicLink()) {
	throw new Error('deployment app root node_modules must retain the relative rules_js link');
}
if (!(await lstat(pgPath)).isSymbolicLink()) {
	throw new Error('deployment app root pg must retain its rules_js package-store link');
}

function outputText(chunks) {
	return Buffer.concat(chunks).toString('utf8').slice(-8_000);
}

async function runNodeProof(label, cwd, args) {
	const stdout = [];
	const stderr = [];
	const child = spawn(process.execPath, args, {
		cwd,
		// Deliberately do not inherit rules_js/runfiles environment. The child
		// must resolve only what the exported application root carries.
		env: { NODE_ENV: 'production' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.stdout.on('data', (chunk) => stdout.push(chunk));
	child.stderr.on('data', (chunk) => stderr.push(chunk));

	const result = await new Promise((resolveResult, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolveResult({ code, signal }));
	});
	if (result.code !== 0) {
		throw new Error(
			`${label} failed (code=${result.code}, signal=${result.signal ?? 'none'})\n` +
				`stdout:\n${outputText(stdout)}\nstderr:\n${outputText(stderr)}`,
		);
	}
	return { stdout: outputText(stdout), stderr: outputText(stderr) };
}

async function runImportProof(label, cwd, source) {
	return runNodeProof(label, cwd, ['--input-type=module', '--eval', source]);
}

await runImportProof(
	'direct production bare imports',
	appRoot,
	[
		"await import('@tummycrypt/tinyland-auth');",
		"await import('@tummycrypt/tinyland-auth-pg');",
		"await import('drizzle-orm');",
		"await import('pg');",
	].join('\n'),
);

// Resolve from pg's real package-store directory. These are bare imports from
// the dependency's own point of view, not phantom root-level dependencies.
const pgStorePath = await realpath(pgPath);
await runImportProof(
	'pg transitive bare imports',
	pgStorePath,
	["await import('pg-pool');", "await import('pg-protocol');"].join('\n'),
);

// The owner image decides how these application-owned process boundaries are
// exposed as OCI entrypoints. Prove here that the exact publication input
// carries one dispatcher and that every declared role is independently
// invocable without a database, queue, or network.
for (const role of ['web', 'worker', 'migrator']) {
	const result = await runNodeProof(`${role} dispatcher help`, appRoot, [
		'scripts/platform-entrypoint.mjs',
		role,
		'--help',
	]);
	if (!result.stdout.includes(`Usage: ${role} [--help]`)) {
		throw new Error(
			`${role} dispatcher help omitted its usage contract\n` +
				`stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
}

const host = '127.0.0.1';
const port = 20_000 + (process.pid % 20_000);
const origin = `http://${host}:${port}`;
const stdout = [];
const stderr = [];
const server = spawn(process.execPath, ['server.js'], {
	cwd: appRoot,
	env: {
		HOST: host,
		NODE_ENV: 'production',
		ORIGIN: origin,
		PORT: String(port),
	},
	stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => stdout.push(chunk));
server.stderr.on('data', (chunk) => stderr.push(chunk));

let serverExit;
const serverExited = new Promise((resolveExit, reject) => {
	server.once('error', reject);
	server.once('exit', (code, signal) => {
		serverExit = { code, signal };
		resolveExit(serverExit);
	});
});

try {
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (serverExit) break;
		try {
			const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(1_000) });
			await response.body?.cancel();
			if (response.ok) {
				ready = true;
				break;
			}
		} catch {
			// The adapter-node process is still starting; the bounded loop owns timeout.
		}
		await delay(100);
	}

	if (!ready) {
		throw new Error(
			`adapter-node did not answer from the exact deployment app root` +
				` (exit=${JSON.stringify(serverExit)})\nstdout:\n${outputText(stdout)}` +
				`\nstderr:\n${outputText(stderr)}`,
		);
	}
} finally {
	if (!serverExit) server.kill('SIGTERM');
	await Promise.race([
		serverExited,
		delay(5_000).then(() => {
			if (!serverExit) server.kill('SIGKILL');
			return serverExited;
		}),
	]);
}

console.log(
	'deployment app-root proof OK: direct/transitive imports, three role dispatches, and adapter-node startup',
);
