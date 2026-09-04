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
	'migrator_bundle',
	'worker_bundle',
	'unit_tests',
	'first_membership_rehearsal_test',
];

const expectedRuntimeHousePackages = new Set([
	':node_modules/@tummycrypt/tinyland-auth',
	':node_modules/@tummycrypt/tinyland-auth-pg',
]);

const packageText = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
const lockText = readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8');
const moduleText = readFileSync(resolve(repoRoot, 'MODULE.bazel'), 'utf8');
const buildText = readFileSync(resolve(repoRoot, 'BUILD.bazel'), 'utf8');
const actionPlanText = readFileSync(resolve(repoRoot, '.github/lanes.json'), 'utf8');

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

function loadLabelList(text, name) {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = text.match(new RegExp(`${escapedName}\\s*=\\s*\\[([\\s\\S]*?)^\\]`, 'm'));
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

function actionPlanFailures(source) {
	let plan;
	try {
		plan = JSON.parse(source);
	} catch (error) {
		return [`ActionPlan is not JSON: ${error.message}`];
	}

	const validate = plan?.actions?.validate;
	if (validate?.command !== 'test') {
		return ['ActionPlan validate action is not a Bazel test action'];
	}
	if (
		!Array.isArray(validate.targets) ||
		!validate.targets.includes('//:deployment_app_root_test')
	) {
		return ['ActionPlan validate action omits //:deployment_app_root_test'];
	}
	return [];
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
	const actualLabels = loadLabelList(buildSource, 'TINYLAND_HOUSE_PACKAGES');
	for (const label of setDifference(expectedLabels, actualLabels).sort()) {
		failures.push(`TINYLAND_HOUSE_PACKAGES omits ${label}`);
	}
	for (const label of setDifference(actualLabels, expectedLabels).sort()) {
		failures.push(`TINYLAND_HOUSE_PACKAGES has unbacked label ${label}`);
	}

	const runtimeLabels = loadLabelList(buildSource, 'TINYLAND_RUNTIME_HOUSE_PACKAGES');
	for (const label of setDifference(expectedRuntimeHousePackages, runtimeLabels).sort()) {
		failures.push(`TINYLAND_RUNTIME_HOUSE_PACKAGES omits ${label}`);
	}
	for (const label of setDifference(runtimeLabels, expectedRuntimeHousePackages).sort()) {
		failures.push(`TINYLAND_RUNTIME_HOUSE_PACKAGES has non-runtime label ${label}`);
	}
	const productionModulesMatch = buildSource.match(
		/PRODUCTION_NODE_MODULES\s*=\s*npm_link_targets\(([\s\S]*?)^\)/m,
	);
	if (
		!productionModulesMatch ||
		!productionModulesMatch[1].includes('dev = False') ||
		!productionModulesMatch[1].includes('prod = True')
	) {
		failures.push('PRODUCTION_NODE_MODULES is not the prod-only npm link set');
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
	for (const [targetName, sourcePath, outputPath, roleOnlyArg] of [
		[
			'migrator_bundle',
			'src/lib/server/db/migrate.ts',
			'bazel-role-bundles/migrator.mjs',
			null,
		],
		[
			'worker_bundle',
			'src/lib/server/worker.ts',
			'bazel-role-bundles/worker.mjs',
			'--alias:$$lib=./src/lib',
		],
	]) {
		const body = loadTargetBody(buildSource, targetName);
		for (const token of [
			sourcePath,
			outputPath,
			'--bundle',
			'--platform=node',
			'--format=esm',
			'--target=node24',
			'--outfile=$@',
			'--external:pg-native',
			'--external:cloudflare:sockets',
			'--tsconfig-raw={}',
			...(roleOnlyArg ? [roleOnlyArg] : []),
		]) {
			if (body === null || !body.includes(token)) {
				failures.push(`${targetName} omits ${token}`);
			}
		}
	}
	const appFilesBody = loadTargetBody(buildSource, 'deployment_app_files');
	for (const carrier of [
		'":build"',
		'":migrator_bundle"',
		'":worker_bundle"',
		'"drizzle/**"',
		'"package.json"',
		'"scripts/platform-entrypoint.mjs"',
		'"server.js"',
		'"bazel-role-bundles": "build"',
	]) {
		if (appFilesBody === null || !appFilesBody.includes(carrier)) {
			failures.push(`deployment_app_files omits ${carrier}`);
		}
	}
	for (const dereferencedGraph of [
		'PRODUCTION_NODE_MODULES',
		'TINYLAND_RUNTIME_HOUSE_PACKAGES',
		'node_modules/.aspect_rules_js',
	]) {
		if (appFilesBody?.includes(dereferencedGraph)) {
			failures.push(`deployment_app_files must not flatten ${dereferencedGraph}`);
		}
	}

	const runtimeGraphBody = loadTargetBody(buildSource, 'deployment_runtime_graph');
	for (const carrier of [
		'PRODUCTION_NODE_MODULES',
		'TINYLAND_RUNTIME_HOUSE_PACKAGES',
		'entry_point = "server.js"',
	]) {
		if (runtimeGraphBody === null || !runtimeGraphBody.includes(carrier)) {
			failures.push(`deployment_runtime_graph omits ${carrier}`);
		}
	}

	const runtimeLayersBody = loadTargetBody(buildSource, 'deployment_runtime_layers');
	for (const carrier of [
		'binary = ":deployment_runtime_graph"',
		'compression = "none"',
		'root = "/app/.rules_js_runtime"',
	]) {
		if (runtimeLayersBody === null || !runtimeLayersBody.includes(carrier)) {
			failures.push(`deployment_runtime_layers omits ${carrier}`);
		}
	}
	for (const [targetName, outputGroup] of [
		['deployment_runtime_package_store_3p', 'package_store_3p'],
		['deployment_runtime_package_store_1p', 'package_store_1p'],
		['deployment_runtime_node_modules', 'node_modules'],
		['deployment_runtime_app', 'app'],
	]) {
		const body = loadTargetBody(buildSource, targetName);
		if (body === null || !body.includes('srcs = [":deployment_runtime_layers"]')) {
			failures.push(`${targetName} does not select deployment_runtime_layers`);
		}
		if (body === null || !body.includes(`output_group = "${outputGroup}"`)) {
			failures.push(`${targetName} does not select ${outputGroup}`);
		}
	}

	const appFilesTarBody = loadTargetBody(buildSource, 'deployment_app_files_tar');
	for (const carrier of [
		'srcs = [":deployment_app_files"]',
		'package_dir = "app"',
		'strip_prefix = "deployment_app_files"',
	]) {
		if (appFilesTarBody === null || !appFilesTarBody.includes(carrier)) {
			failures.push(`deployment_app_files_tar omits ${carrier}`);
		}
	}

	const archiveBody = loadTargetBody(buildSource, 'deployment_app_root_archive');
	const archiveCarriers = [
		'":deployment_app_files_tar"',
		'":deployment_runtime_package_store_3p"',
		'":deployment_runtime_package_store_1p"',
		'":deployment_runtime_node_modules"',
		'":deployment_runtime_app"',
	];
	for (const carrier of [
		...archiveCarriers,
		'"app/node_modules": ".rules_js_runtime/deployment_runtime_graph.runfiles/_main/node_modules"',
	]) {
		if (archiveBody === null || !archiveBody.includes(carrier)) {
			failures.push(`deployment_app_root_archive omits ${carrier}`);
		}
	}
	let previousCarrierPosition = -1;
	for (const carrier of archiveCarriers) {
		const position = archiveBody?.indexOf(carrier) ?? -1;
		if (position <= previousCarrierPosition) {
			failures.push('deployment_app_root_archive does not preserve rules_js layer order');
			break;
		}
		previousCarrierPosition = position;
	}

	const appRootBody = loadTargetBody(buildSource, 'deployment_app_root');
	if (appRootBody === null || !appRootBody.includes('src = ":deployment_app_root_archive"')) {
		failures.push('deployment_app_root does not extract the publication archive');
	}
	const appRootTestBody = loadTargetBody(buildSource, 'deployment_app_root_test');
	for (const carrier of [
		'args = ["$(rootpath :deployment_app_root)"]',
		'data = [":deployment_app_root"]',
		'entry_point = "scripts/bazel/check-deployment-app-root.mjs"',
	]) {
		if (appRootTestBody === null || !appRootTestBody.includes(carrier)) {
			failures.push(`deployment_app_root_test omits ${carrier}`);
		}
	}
	const validationSuiteBody = loadTargetBody(buildSource, 'ci_validation_suite');
	if (validationSuiteBody === null || !validationSuiteBody.includes('":deployment_app_root_test"')) {
		failures.push('ci_validation_suite omits deployment_app_root_test');
	}
	const bundleBody = loadTargetBody(buildSource, 'deployment_bundle');
	if (
		bundleBody === null ||
		!bundleBody.includes('deps = [":deployment_app_root_archive"]') ||
		!bundleBody.includes('package_dir = "/"') ||
		!bundleBody.includes('extension = "tar.gz"')
	) {
		failures.push('deployment_bundle does not wrap the exact app-root archive');
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

	const incompleteBundle = buildText.replace('\n        ":worker_bundle",', '');
	if (
		!contractFailures(packageText, lockText, moduleText, incompleteBundle).some((failure) =>
			failure.includes('deployment_app_files omits ":worker_bundle"'),
		)
	) {
		failures.push('deployment-capsule negative control did not trip');
	}

	const incompleteRuntime = buildText.replace(
		'\n        ":deployment_runtime_package_store_3p",',
		'',
	);
	if (
		!contractFailures(packageText, lockText, moduleText, incompleteRuntime).some((failure) =>
			failure.includes('deployment_app_root_archive omits ":deployment_runtime_package_store_3p"'),
		)
	) {
		failures.push('deployment-runtime-topology negative control did not trip');
	}

	const unenrolledProof = actionPlanText.replace(
		'\n\t\t\t\t"//:deployment_app_root_test",',
		'',
	);
	if (!actionPlanFailures(unenrolledProof).some((failure) => failure.includes('omits'))) {
		failures.push('deployment-proof enrollment negative control did not trip');
	}
	return failures;
}

const failures = contractFailures(packageText, lockText, moduleText, buildText);
failures.push(...actionPlanFailures(actionPlanText));
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
