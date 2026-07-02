#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
	StaticProjectionSnapshotError,
	validateActivityPubActorKeyDocument,
	validateProjectionHttpSignature,
	validateStaticProjectionSnapshot,
	type ActivityPubActorKeyValidationResult,
	type JsonValue,
	type ProjectionHttpSignatureHeaders,
} from '../src/lib/projection/static-snapshot.ts';

type CliOptions = {
	expectedSourceAuthority?: string;
	expectedSpokeTarget?: string;
	actorDocument?: string;
	expectedActorId?: string;
	expectedActorKeyId?: string;
	requireSignature: boolean;
	dryRun: boolean;
};

type SnapshotSource = {
	raw: string;
	url?: URL;
	headers?: ProjectionHttpSignatureHeaders;
};

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

function usage(): never {
	console.error(`Usage:
  tsx scripts/static-projection-snapshot.mts validate <snapshot.json> [--expected-source-authority tinyland.dev] [--expected-spoke <host>] [--actor-document <actor.json|https-url>] [--expected-actor-id <url>] [--expected-actor-key-id <url#main-key>]
  tsx scripts/static-projection-snapshot.mts sync <source.json|https-url> <target.json> [--expected-source-authority tinyland.dev] [--expected-spoke <host>] [--actor-document <actor.json|https-url>] [--expected-actor-id <url>] [--expected-actor-key-id <url#main-key>] [--require-signature] [--dry-run]

This tool validates checked-in static Tinyland projection snapshots. It does not
enable runtime broker fetches, mutation APIs, checkout sessions, or ActivityPub
delivery workers in a generated sister site. Actor document validation checks
public-key publication readiness. Passing --require-signature additionally
requires a fail-closed Tinyland HTTP Signature over the fetched snapshot body.`);
	process.exit(2);
}

function parseOptions(args: string[]): { positional: string[]; options: CliOptions } {
	const positional: string[] = [];
	const options: CliOptions = { dryRun: false, requireSignature: false };

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--expected-source-authority') {
			options.expectedSourceAuthority = args[index + 1];
			index += 1;
		} else if (arg === '--expected-spoke') {
			options.expectedSpokeTarget = args[index + 1];
			index += 1;
		} else if (arg === '--actor-document') {
			options.actorDocument = args[index + 1];
			index += 1;
		} else if (arg === '--expected-actor-id') {
			options.expectedActorId = args[index + 1];
			index += 1;
		} else if (arg === '--expected-actor-key-id') {
			options.expectedActorKeyId = args[index + 1];
			index += 1;
		} else if (arg === '--dry-run') {
			options.dryRun = true;
		} else if (arg === '--require-signature') {
			options.requireSignature = true;
		} else if (arg.startsWith('--')) {
			usage();
		} else {
			positional.push(arg);
		}
	}

	if (
		options.expectedSourceAuthority === '' ||
		options.expectedSpokeTarget === '' ||
		options.actorDocument === '' ||
		options.expectedActorId === '' ||
		options.expectedActorKeyId === '' ||
		(options.expectedSourceAuthority === undefined && args.includes('--expected-source-authority')) ||
		(options.expectedSpokeTarget === undefined && args.includes('--expected-spoke')) ||
		(options.actorDocument === undefined && args.includes('--actor-document')) ||
		(options.expectedActorId === undefined && args.includes('--expected-actor-id')) ||
		(options.expectedActorKeyId === undefined && args.includes('--expected-actor-key-id'))
	) {
		usage();
	}

	return { positional, options };
}

function parseJsonSnapshot(raw: string, sourceLabel: string): JsonValue {
	try {
		return JSON.parse(raw) as JsonValue;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${sourceLabel} is not valid JSON: ${message}`);
	}
}

function parseHttpsSource(source: string): URL | undefined {
	try {
		const url = new URL(source);
		if (url.protocol !== 'https:') {
			throw new Error('remote snapshot source must use https');
		}
		if (url.username || url.password || url.search || url.hash) {
			throw new Error('remote snapshot URL must not include credentials, query params, or fragments');
		}
		return url;
	} catch (error) {
		if (source.startsWith('http://') || source.startsWith('https://')) {
			throw error;
		}
		return undefined;
	}
}

async function readSnapshotSource(source: string): Promise<SnapshotSource> {
	const httpsSource = parseHttpsSource(source);
	if (!httpsSource) {
		return { raw: await readFile(resolve(source), 'utf8') };
	}

	const response = await fetch(httpsSource);
	if (!response.ok) {
		throw new Error(`failed to fetch ${httpsSource.href}: HTTP ${response.status}`);
	}

	const lengthHeader = response.headers.get('content-length');
	if (lengthHeader && Number.parseInt(lengthHeader, 10) > MAX_SNAPSHOT_BYTES) {
		throw new Error(`snapshot exceeds ${MAX_SNAPSHOT_BYTES} byte limit`);
	}

	const raw = await response.text();
	if (Buffer.byteLength(raw, 'utf8') > MAX_SNAPSHOT_BYTES) {
		throw new Error(`snapshot exceeds ${MAX_SNAPSHOT_BYTES} byte limit`);
	}

	return {
		raw,
		url: httpsSource,
		headers: {
			digest: response.headers.get('digest'),
			signature: response.headers.get('signature'),
			signatureCreated: response.headers.get('x-tinyland-signature-created'),
		},
	};
}

function printValidationSummary(command: string, result: ReturnType<typeof validateStaticProjectionSnapshot>): void {
	const projectionKind = result.projectionKind ? ` projectionKind=${result.projectionKind}` : '';
	const sourceAuthority = result.sourceAuthority ? ` sourceAuthority=${result.sourceAuthority}` : '';
	const spokeTarget = result.spokeTarget ? ` spokeTarget=${result.spokeTarget}` : '';
	console.log(
		`${command}: schemaVersion=${result.schemaVersion} itemCount=${result.itemCount}${projectionKind}${sourceAuthority}${spokeTarget}`,
	);
}

async function validateActorDocument(options: CliOptions): Promise<ActivityPubActorKeyValidationResult | undefined> {
	if (!options.actorDocument) {
		return undefined;
	}

	const source = await readSnapshotSource(options.actorDocument);
	const actor = parseJsonSnapshot(source.raw, options.actorDocument);
	const result = validateActivityPubActorKeyDocument(actor, {
		expectedActorId: options.expectedActorId,
		expectedPublicKeyId: options.expectedActorKeyId,
		expectedPublicKeyOwner: options.expectedActorId,
	});
	console.log(
		`actor-key-ready: actorId=${result.actorId} publicKeyId=${result.publicKeyId} fingerprintSha256=${result.publicKeyFingerprintSha256}`,
	);
	return result;
}

function validateSignatureIfRequired(
	source: SnapshotSource,
	actor: ActivityPubActorKeyValidationResult | undefined,
	options: CliOptions,
): void {
	if (!options.requireSignature) {
		return;
	}

	if (!source.url) {
		throw new Error('--require-signature requires an https snapshot source');
	}

	if (!actor) {
		throw new Error('--require-signature requires --actor-document');
	}

	const result = validateProjectionHttpSignature({
		body: source.raw,
		requestUrl: source.url,
		headers: source.headers ?? {},
		publicKeyPem: actor.publicKeyPem,
		expectedKeyId: options.expectedActorKeyId ?? actor.publicKeyId,
	});
	console.log(
		`snapshot-signature-ready: keyId=${result.keyId} algorithm=${result.algorithm} created=${result.signatureCreated}`,
	);
}

async function validateCommand(snapshotPath: string, options: CliOptions): Promise<void> {
	const source = await readSnapshotSource(snapshotPath);
	const snapshot = parseJsonSnapshot(source.raw, snapshotPath);
	const result = validateStaticProjectionSnapshot(snapshot, options);
	printValidationSummary('validated', result);
	const actor = await validateActorDocument(options);
	validateSignatureIfRequired(source, actor, options);
}

async function syncCommand(source: string, target: string, options: CliOptions): Promise<void> {
	if (target.startsWith('http://') || target.startsWith('https://')) {
		throw new Error('target must be a local checked-in JSON file path');
	}

	const snapshotSource = await readSnapshotSource(source);
	const snapshot = parseJsonSnapshot(snapshotSource.raw, source);
	const result = validateStaticProjectionSnapshot(snapshot, options);
	printValidationSummary(options.dryRun ? 'validated-dry-run' : 'synced', result);
	const actor = await validateActorDocument(options);
	validateSignatureIfRequired(snapshotSource, actor, options);

	if (!options.dryRun) {
		const targetPath = resolve(target);
		await mkdir(dirname(targetPath), { recursive: true });
		await writeFile(targetPath, `${JSON.stringify(snapshot, null, '\t')}\n`);
	}
}

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	const { positional, options } = parseOptions(rest);

	if (command === 'validate' && positional.length === 1) {
		await validateCommand(positional[0], options);
		return;
	}

	if (command === 'sync' && positional.length === 2) {
		await syncCommand(positional[0], positional[1], options);
		return;
	}

	usage();
}

main().catch((error: unknown) => {
	if (error instanceof StaticProjectionSnapshotError) {
		console.error(error.message);
	} else if (error instanceof Error) {
		console.error(error.message);
	} else {
		console.error(String(error));
	}
	process.exit(1);
});
