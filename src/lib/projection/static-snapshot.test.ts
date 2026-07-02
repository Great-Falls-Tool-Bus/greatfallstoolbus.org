import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	StaticProjectionSnapshotError,
	buildProjectionHttpSignatureString,
	calculatePulseContentHash,
	calculateStaticSpokeContentHash,
	projectionDigestHeaderForBody,
	validateActivityPubActorKeyDocument,
	validateProjectionHttpSignature,
	validateStaticProjectionSnapshot,
	type JsonObject,
} from './static-snapshot';

function makeStaticSpokeSnapshot(overrides: Partial<JsonObject> = {}): JsonObject {
	const snapshot: JsonObject = {
		schemaVersion: 'tinyland.static-spoke.snapshot.v1',
		snapshotId: 'site-scaffold-test-products-2026-05-10',
		generatedAt: '2026-05-10T00:00:00.000Z',
		sourceAuthority: 'tinyland.dev',
		sourceAuthorityUrl: 'https://tinyland.dev',
		contentHash: '',
		itemCount: 0,
		policyVersion: 'site-scaffold-static-projection-test',
		projectionKind: 'products',
		spokeTarget: 'example.tinyland.dev',
		brandRef: 'example-tinyland-dev',
		routePath: '/projections/example-tinyland-dev/public-snapshot.v1.json',
		publicSnapshotUrl: 'https://tinyland.dev/projections/example-tinyland-dev/public-snapshot.v1.json',
		sourceRecordSet: ['content/registry/projections/example-tinyland-dev/products.json'],
		publicationStatus: 'reviewed-empty-public-snapshot',
		activityPubStatus: 'AP-shaped/static projection only; not a public federation launch',
		publicProducts: [],
		...overrides,
	};

	return {
		...snapshot,
		contentHash: calculateStaticSpokeContentHash(snapshot),
	};
}

function requireHash(value: string | undefined): string {
	if (!value) {
		throw new Error('expected content hash');
	}

	return value;
}

function makePulseSnapshot(overrides: Partial<JsonObject> = {}): JsonObject {
	const snapshot: JsonObject = {
		schemaVersion: 'tinyland.pulse.v1.PublicPulseSnapshot',
		generatedAt: '2026-05-10T13:00:00.000Z',
		items: [
			{
				id: 'tinyland-pulse-note-2026-05-10-001',
				kind: 'note',
				occurredAt: '2026-05-10T12:30:00.000Z',
				summary: 'Static Pulse projection is sourced from Tinyland review records.',
				content: 'Static Pulse projection is sourced from Tinyland review records.',
				tags: ['tinyland', 'pulse'],
			},
			{
				id: 'tinyland-pulse-bird-2026-05-10-001',
				kind: 'bird_sighting',
				occurredAt: '2026-05-10T11:42:00.000Z',
				summary: '2x Northern Cardinal',
				content: '',
				tags: ['birds'],
				birdSighting: {
					commonName: 'Northern Cardinal',
					scientificName: 'Cardinalis cardinalis',
					count: 2,
					placeLabel: 'Cayuga Lake basin',
				},
			},
		],
		manifest: {
			schemaVersion: 'tinyland.pulse.v1.PublicPulseSnapshot',
			generatedAt: '2026-05-10T13:00:00.000Z',
			sourceSnapshotId: 'tinyland-pulse-test-2026-05-10',
			contentHash: '',
			itemCount: 2,
			policyVersion: 'm1-2026-04-27',
		},
		...overrides,
	};

	const manifest = snapshot.manifest as JsonObject;
	return {
		...snapshot,
		manifest: {
			...manifest,
			contentHash: requireHash(calculatePulseContentHash(snapshot)),
		},
	};
}

function makeActorDocument(overrides: Partial<JsonObject> = {}): JsonObject {
	return {
		'@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
		id: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev',
		type: 'Service',
		preferredUsername: 'example-tinyland-dev',
		publicKey: {
			id: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev#main-key',
			owner: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev',
			publicKeyPem:
				'-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest\n-----END PUBLIC KEY-----',
		},
		...overrides,
	};
}

function makeSignatureProof(body: string, url: string) {
	const { publicKey, privateKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
	});
	const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
	const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
	const digest = projectionDigestHeaderForBody(body);
	const signatureCreated = '2026-05-11T00:00:00.000Z';
	const signatureString = buildProjectionHttpSignatureString({
		requestUrl: url,
		digest,
		signatureCreated,
	});
	const signer = createSign('RSA-SHA256');
	signer.update(signatureString, 'utf8');
	const signature = signer.sign(privateKeyPem, 'base64');
	const keyId = 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev#main-key';

	return {
		publicKeyPem,
		keyId,
		headers: {
			digest,
			signatureCreated,
			signature: `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host digest x-tinyland-signature-created",signature="${signature}"`,
		},
	};
}

describe('static projection snapshot validation', () => {
	it('accepts a reviewed static spoke snapshot from Tinyland', () => {
		expect(
			validateStaticProjectionSnapshot(makeStaticSpokeSnapshot(), {
				expectedSourceAuthority: 'tinyland.dev',
				expectedSpokeTarget: 'example.tinyland.dev',
			}),
		).toEqual({
			schemaVersion: 'tinyland.static-spoke.snapshot.v1',
			itemCount: 0,
			projectionKind: 'products',
			sourceAuthority: 'tinyland.dev',
			spokeTarget: 'example.tinyland.dev',
		});
	});

	it('rejects static spoke snapshots with bad hashes or source authority drift', () => {
		const snapshot = makeStaticSpokeSnapshot({
			sourceAuthority: 'example.com',
		});
		snapshot.contentHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

		expect(() =>
			validateStaticProjectionSnapshot(snapshot, {
				expectedSourceAuthority: 'tinyland.dev',
			}),
		).toThrow(StaticProjectionSnapshotError);
	});

	it('accepts the M1 Pulse public snapshot contract', () => {
		expect(validateStaticProjectionSnapshot(makePulseSnapshot())).toEqual({
			schemaVersion: 'tinyland.pulse.v1.PublicPulseSnapshot',
			itemCount: 2,
			projectionKind: 'pulse',
		});
	});

	it('rejects Pulse snapshots with private location fields or non-M1 kinds', () => {
		const invalid = makePulseSnapshot({
			items: [
				{
					id: 'private-photo',
					kind: 'photo',
					occurredAt: '2026-05-10T12:30:00.000Z',
					summary: 'Private media must not enter public Pulse M1.',
					latitude: 42.44,
				},
			],
		});

		const manifest = invalid.manifest as JsonObject;
		invalid.manifest = {
			...manifest,
			itemCount: 1,
			contentHash: requireHash(calculatePulseContentHash(invalid)),
		};

		expect(() => validateStaticProjectionSnapshot(invalid)).toThrow(StaticProjectionSnapshotError);
	});

	it('rejects secret-shaped public fields', () => {
		expect(() =>
			validateStaticProjectionSnapshot(
				makeStaticSpokeSnapshot({
					operatorSecret: 'redacted',
				}),
			),
		).toThrow(StaticProjectionSnapshotError);
	});

	it('accepts a Tinyland brand actor public-key document for ingest readiness', () => {
		expect(
			validateActivityPubActorKeyDocument(makeActorDocument(), {
				expectedActorId: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev',
				expectedPublicKeyId: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev#main-key',
			}),
		).toEqual(
			expect.objectContaining({
				actorId: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev',
				publicKeyId: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev#main-key',
				publicKeyOwner: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev',
				publicKeyPem: expect.stringContaining('-----BEGIN PUBLIC KEY-----'),
				publicKeyFingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			}),
		);
	});

	it('rejects actor documents without a matching public-key owner', () => {
		expect(() =>
			validateActivityPubActorKeyDocument(
				makeActorDocument({
					publicKey: {
						id: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev#main-key',
						owner: 'https://evil.example/actor',
						publicKeyPem: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----',
					},
				}),
				{
					expectedActorId: 'https://tinyland.dev/ap/actors/brand/example-tinyland-dev',
				},
			),
		).toThrow(StaticProjectionSnapshotError);
	});

	it('accepts a Tinyland HTTP Signature over a projection snapshot response', () => {
		const body = JSON.stringify(makeStaticSpokeSnapshot(), null, '\t');
		const url = 'https://tinyland.dev/projections/example-tinyland-dev/public-snapshot.v1.json';
		const proof = makeSignatureProof(body, url);

		expect(
			validateProjectionHttpSignature({
				body,
				requestUrl: url,
				headers: proof.headers,
				publicKeyPem: proof.publicKeyPem,
				expectedKeyId: proof.keyId,
			}),
		).toEqual({
			keyId: proof.keyId,
			algorithm: 'rsa-sha256',
			headers: ['(request-target)', 'host', 'digest', 'x-tinyland-signature-created'],
			digest: proof.headers.digest,
			signatureCreated: proof.headers.signatureCreated,
		});
	});

	it('rejects a projection HTTP Signature when the body changes', () => {
		const body = JSON.stringify(makeStaticSpokeSnapshot(), null, '\t');
		const url = 'https://tinyland.dev/projections/example-tinyland-dev/public-snapshot.v1.json';
		const proof = makeSignatureProof(body, url);

		expect(() =>
			validateProjectionHttpSignature({
				body: `${body}\n `,
				requestUrl: url,
				headers: proof.headers,
				publicKeyPem: proof.publicKeyPem,
				expectedKeyId: proof.keyId,
			}),
		).toThrow(StaticProjectionSnapshotError);
	});
});
