#!/usr/bin/env node
/** Assert Bazel-only ingestion of every first-party package (TIN-2881). */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inHouseScopes = ['@tummycrypt/', '@tinyland/'];
const inHouseModulePrefixes = ['tummycrypt_', 'tinyland_'];
const requiredGraphConsumers = [
	'sveltekit_sync_bin',
	'svelte_check_bin',
	'svelte_check_test',
	'eslint_test',
	'prettier_check_test',
	'vite_build_bin',
	'unit_tests',
	'first_membership_rehearsal_test',
];

const packageText = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
const lockText = readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8');
const moduleText = readFileSync(resolve(repoRoot, 'MODULE.bazel'), 'utf8');
const buildText = readFileSync(resolve(repoRoot, 'BUILD.bazel'), 'utf8');

function isInHouse(name) {
	return inHouseScopes.some((scope) => name.startsWith(scope));
}

function npmToBazelModule(packageName) {
	const [scope, name] = packageName.split('/', 2);
	return `${scope.slice(1)}_${name}`.replaceAll('-', '_');
}

function loadInHouseNpmSpecifiers(text) {
	const packageJson = JSON.parse(text);
	const specifiers = new Map();
	for (const section of [
		'dependencies',
		'devDependencies',
		'peerDependencies',
		'optionalDependencies',
	]) {
		for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
			if (isInHouse(name)) specifiers.set(name, String(version));
		}
	}
	return specifiers;
}

function loadInHouseLockReferences(text) {
	return text
		.split('\n')
		.map((line, index) => ({ line, number: index + 1 }))
		.filter(({ line }) => inHouseScopes.some((scope) => line.includes(scope)))
		.map(({ number }) => number);
}

function loadGraphLinks(text) {
	const links = new Map();
	const pattern =
		/npm_link_package\(\s*name\s*=\s*"node_modules\/(@[^"]+)"\s*,\s*src\s*=\s*"@([^/"]+)\/\/:pkg"\s*,?\s*\)/g;
	for (const match of text.matchAll(pattern)) {
		if (isInHouse(match[1])) links.set(match[1], match[2]);
	}
	return links;
}

function loadInHouseBazelDeps(text) {
	const deps = new Set();
	for (const match of text.matchAll(/bazel_dep\(\s*name\s*=\s*"([^"]+)"/g)) {
		if (inHouseModulePrefixes.some((prefix) => match[1].startsWith(prefix))) {
			deps.add(match[1]);
		}
	}
	return deps;
}

function loadInHouseBazelVersions(text) {
	const versions = new Map();
	for (const match of text.matchAll(
		/bazel_dep\(\s*name\s*=\s*"([^"]+)"\s*,\s*version\s*=\s*"([^"]+)"/g,
	)) {
		if (inHouseModulePrefixes.some((prefix) => match[1].startsWith(prefix))) {
			versions.set(match[1], match[2]);
		}
	}
	return versions;
}

function loadHousePackageLabels(text) {
	const match = text.match(/TINYLAND_HOUSE_PACKAGES\s*=\s*\[([\s\S]*?)^\]/m);
	if (!match) return new Set();
	return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]));
}

function loadTargetBody(text, targetName) {
	const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const start = new RegExp(
		`(?:[A-Za-z_][A-Za-z0-9_.]*)\\(\\s*name\\s*=\\s*"${escapedName}"\\s*,`,
		'm',
	).exec(text);
	if (!start) return null;
	const tail = text.slice(start.index + start[0].length);
	const end = tail.search(/^\)/m);
	return end === -1 ? null : tail.slice(0, end);
}

function setDifference(left, right) {
	return [...left].filter((item) => !right.has(item));
}

function contractFailures(packageSource, lockSource, moduleSource, buildSource) {
	const failures = [];
	for (const [name, version] of [...loadInHouseNpmSpecifiers(packageSource)].sort()) {
		failures.push(
			`${name} remains an npm source specifier (${JSON.stringify(version)}); first-party packages are Bazel-only`,
		);
	}
	for (const lineNumber of loadInHouseLockReferences(lockSource)) {
		failures.push(`pnpm-lock.yaml:${lineNumber} retains a first-party npm edge`);
	}

	const links = loadGraphLinks(buildSource);
	const bazelDeps = loadInHouseBazelDeps(moduleSource);
	const linkedModules = new Set(links.values());
	if (links.size === 0) failures.push('no first-party npm_link_package :pkg edges found');
	for (const [packageName, linkedModule] of [...links].sort()) {
		const expectedModule = npmToBazelModule(packageName);
		if (linkedModule !== expectedModule) {
			failures.push(
				`${packageName} links @${linkedModule}//:pkg, expected @${expectedModule}//:pkg`,
			);
		}
		if (!bazelDeps.has(linkedModule)) {
			failures.push(`${packageName} links @${linkedModule}//:pkg without a bazel_dep`);
		}
	}
	for (const moduleName of setDifference(bazelDeps, linkedModules).sort()) {
		failures.push(`bazel_dep(${moduleName}) has no npm_link_package :pkg edge`);
	}

	const expectedLabels = new Set([...links.keys()].map((name) => `:node_modules/${name}`));
	const actualLabels = loadHousePackageLabels(buildSource);
	for (const label of setDifference(expectedLabels, actualLabels).sort()) {
		failures.push(`TINYLAND_HOUSE_PACKAGES omits ${label}`);
	}
	for (const label of setDifference(actualLabels, expectedLabels).sort()) {
		failures.push(`TINYLAND_HOUSE_PACKAGES has unbacked label ${label}`);
	}

	for (const targetName of requiredGraphConsumers) {
		const body = loadTargetBody(buildSource, targetName);
		if (body === null) failures.push(`BUILD.bazel is missing target ${targetName}`);
		else if (!body.includes('TINYLAND_HOUSE_PACKAGES')) {
			failures.push(`target ${targetName} omits TINYLAND_HOUSE_PACKAGES`);
		}
	}
	const buildBody = loadTargetBody(buildSource, 'build');
	if (buildBody === null || !buildBody.includes('tool = ":vite_build_bin"')) {
		failures.push('build does not consume the house-keyed vite_build_bin');
	}
	const bundleBody = loadTargetBody(buildSource, 'deployment_bundle');
	if (bundleBody === null || !bundleBody.includes('":build"')) {
		failures.push('deployment_bundle does not consume the canonical build');
	}
	return failures;
}

function installedGraphFailures(packageSource, moduleSource, buildSource) {
	const failures = [];
	const packageJson = JSON.parse(packageSource);
	const availableDependencies = new Set(
		['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
			(section) => Object.keys(packageJson[section] ?? {}),
		),
	);
	const links = loadGraphLinks(buildSource);
	const bazelVersions = loadInHouseBazelVersions(moduleSource);

	for (const [packageName, moduleName] of links) {
		const manifestPath = resolve(repoRoot, 'node_modules', packageName, 'package.json');
		if (!existsSync(manifestPath)) {
			failures.push(`${packageName} graph output has no package.json`);
			continue;
		}
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		if (manifest.name !== packageName) {
			failures.push(`${packageName} graph output declares name ${JSON.stringify(manifest.name)}`);
		}
		const expectedVersion = bazelVersions.get(moduleName);
		if (manifest.version !== expectedVersion) {
			failures.push(
				`${packageName} graph output version ${manifest.version} != BCR pin ${expectedVersion}`,
			);
		}

		for (const dependencyName of [
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
		]) {
			if (!availableDependencies.has(dependencyName) && !links.has(dependencyName)) {
				failures.push(
					`${packageName} requires ${dependencyName}, but the consumer graph does not supply it`,
				);
			}
		}
	}
	return failures;
}

function negativeControlFailures() {
	const failures = [];
	const injectedPackage = JSON.parse(packageText);
	injectedPackage.dependencies ??= {};
	injectedPackage.dependencies['@tummycrypt/probe'] = '0.0.0';
	if (
		!contractFailures(JSON.stringify(injectedPackage), lockText, moduleText, buildText).some(
			(failure) => failure.includes('@tummycrypt/probe'),
		)
	) {
		failures.push('source-edge negative control did not trip');
	}

	const missingCarrier = buildText.replace(
		'data = [":node_modules"] + TINYLAND_HOUSE_PACKAGES',
		'data = [":node_modules"]',
	);
	if (
		!contractFailures(packageText, lockText, moduleText, missingCarrier).some((failure) =>
			failure.includes('sveltekit_sync_bin omits'),
		)
	) {
		failures.push('graph-carrier negative control did not trip');
	}
	return failures;
}

const failures = contractFailures(packageText, lockText, moduleText, buildText);
failures.push(...installedGraphFailures(packageText, moduleText, buildText));
failures.push(...negativeControlFailures());
if (failures.length > 0) {
	console.error('Bazel-only ingestion check failed:');
	console.error(failures.map((failure) => `  - ${failure}`).join('\n'));
	process.exitCode = 1;
} else {
	console.log(
		`Bazel-only ingestion ok: ${loadGraphLinks(buildText).size} first-party package(s), ` +
			'0 package/lock sources, complete dependency and action carriers',
	);
}
