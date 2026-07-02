import { createHash, createVerify } from 'node:crypto';

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type StaticProjectionValidationOptions = {
	expectedSourceAuthority?: string;
	expectedSpokeTarget?: string;
};

export type StaticProjectionValidationResult = {
	schemaVersion: string;
	itemCount: number;
	projectionKind?: string;
	sourceAuthority?: string;
	spokeTarget?: string;
};

export type ActivityPubActorKeyValidationOptions = {
	expectedActorId?: string;
	expectedPublicKeyId?: string;
	expectedPublicKeyOwner?: string;
};

export type ActivityPubActorKeyValidationResult = {
	actorId: string;
	publicKeyId: string;
	publicKeyOwner: string;
	publicKeyPem: string;
	publicKeyFingerprintSha256: string;
};

export type ProjectionHttpSignatureHeaders = {
	digest?: string | null;
	signature?: string | null;
	signatureCreated?: string | null;
};

export type ProjectionHttpSignatureValidationOptions = {
	body: string;
	requestUrl: string | URL;
	headers: ProjectionHttpSignatureHeaders;
	publicKeyPem: string;
	expectedKeyId?: string;
	method?: string;
};

export type ProjectionHttpSignatureValidationResult = {
	keyId: string;
	algorithm: string;
	headers: string[];
	digest: string;
	signatureCreated: string;
};

export class StaticProjectionSnapshotError extends Error {
	readonly reasons: string[];

	constructor(reasons: string[]) {
		super(`Static projection snapshot validation failed: ${reasons.join(', ')}`);
		this.name = 'StaticProjectionSnapshotError';
		this.reasons = reasons;
	}
}

const STATIC_SPOKE_SCHEMA_VERSION = 'tinyland.static-spoke.snapshot.v1';
const PULSE_SCHEMA_VERSION = 'tinyland.pulse.v1.PublicPulseSnapshot';
const HASH_PREFIX = 'sha256:';
const DIGEST_PREFIX = 'SHA-256=';
const PROJECTION_SIGNATURE_ALGORITHM = 'rsa-sha256';
const PROJECTION_SIGNATURE_CREATED_HEADER = 'x-tinyland-signature-created';
const PROJECTION_SIGNATURE_HEADERS = ['(request-target)', 'host', 'digest', PROJECTION_SIGNATURE_CREATED_HEADER];
const ALLOWED_PULSE_KINDS = new Set(['note', 'bird_sighting']);
const SECRET_KEY_PATTERN =
	/(private.*key|publicKeyPem|secret|apiKey|accessToken|refreshToken|password|credential|kubeconfig|totp|session|webhook|settlement|stripe)/i;
const PULSE_PRIVATE_FIELD_PATTERN =
	/(latitude|longitude|coordinates|exactLocation|gps|privateObjectKey|objectKey|storageKey|localPath|privateMediaKey)/i;
const STATIC_COLLECTION_BY_KIND: Record<string, string> = {
	events: 'events',
	posts: 'posts',
	products: 'publicProducts',
	profiles: 'profiles',
	services: 'services',
};

function isObject(value: JsonValue | unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: JsonValue | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asNumber(value: JsonValue | undefined): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function hasSha256(value: string | undefined): boolean {
	return typeof value === 'string' && value.startsWith(HASH_PREFIX) && value.length === HASH_PREFIX.length + 64;
}

function ensureHttpsUrl(value: string | undefined, fieldName: string, reasons: string[]): void {
	if (!value) {
		reasons.push(`${fieldName}-required`);
		return;
	}

	try {
		const url = new URL(value);
		if (url.protocol !== 'https:') {
			reasons.push(`${fieldName}-must-be-https`);
		}
		if (url.username || url.password || url.search || url.hash) {
			reasons.push(`${fieldName}-must-not-carry-credentials-or-query`);
		}
	} catch {
		reasons.push(`${fieldName}-must-be-valid-url`);
	}
}

export function stableStringify(value: JsonValue): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(',')}]`;
	}

	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(',')}}`;
	}

	return JSON.stringify(value);
}

export function sha256Hex(value: string): string {
	return `${HASH_PREFIX}${createHash('sha256').update(value).digest('hex')}`;
}

export function sha256HexBare(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function projectionDigestHeaderForBody(body: string): string {
	return `${DIGEST_PREFIX}${createHash('sha256').update(body, 'utf8').digest('base64')}`;
}

export function calculateStaticSpokeContentHash(snapshot: JsonObject): string {
	return sha256Hex(JSON.stringify({ ...snapshot, contentHash: '' }));
}

export function calculatePulseContentHash(snapshot: JsonObject): string | undefined {
	const items = snapshot.items;
	if (!Array.isArray(items)) {
		return undefined;
	}

	return sha256Hex(stableStringify(items));
}

function parseProjectionSignatureHeader(signatureHeader: string | null | undefined): {
	keyId: string;
	algorithm: string;
	headers: string[];
	signature: string;
} | null {
	if (!signatureHeader) {
		return null;
	}

	const parts = new Map<string, string>();
	for (const part of signatureHeader.split(',')) {
		const match = part.trim().match(/^([a-zA-Z]+)="([^"]*)"$/);
		if (!match) {
			return null;
		}
		parts.set(match[1], match[2]);
	}

	const keyId = parts.get('keyId');
	const algorithm = parts.get('algorithm');
	const headers = parts.get('headers');
	const signature = parts.get('signature');
	if (!keyId || !algorithm || !headers || !signature) {
		return null;
	}

	return {
		keyId,
		algorithm: algorithm.toLowerCase(),
		headers: headers.split(/\s+/).filter(Boolean),
		signature,
	};
}

export function buildProjectionHttpSignatureString({
	method = 'GET',
	requestUrl,
	digest,
	signatureCreated,
}: {
	method?: string;
	requestUrl: string | URL;
	digest: string;
	signatureCreated: string;
}): string {
	const url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl);
	const requestPath = `${url.pathname}${url.search}`;
	if (!requestPath.startsWith('/')) {
		throw new Error('projection signature request path must start with /');
	}
	if (!digest) {
		throw new Error('projection signature digest is required');
	}
	if (!signatureCreated) {
		throw new Error('projection signature created timestamp is required');
	}

	return [
		`(request-target): ${method.toLowerCase()} ${requestPath}`,
		`host: ${url.host}`,
		`digest: ${digest}`,
		`${PROJECTION_SIGNATURE_CREATED_HEADER}: ${signatureCreated}`,
	].join('\n');
}

export function validateProjectionHttpSignature({
	body,
	requestUrl,
	headers,
	publicKeyPem,
	expectedKeyId,
	method = 'GET',
}: ProjectionHttpSignatureValidationOptions): ProjectionHttpSignatureValidationResult {
	const reasons: string[] = [];
	const digest = headers.digest ?? '';
	const signatureCreated = headers.signatureCreated ?? '';
	const parsed = parseProjectionSignatureHeader(headers.signature);

	if (!digest) {
		reasons.push('projection-signature-digest-required');
	} else if (!digest.startsWith(DIGEST_PREFIX)) {
		reasons.push('projection-signature-digest-algorithm-unsupported');
	} else if (digest !== projectionDigestHeaderForBody(body)) {
		reasons.push('projection-signature-digest-mismatch');
	}

	if (!signatureCreated) {
		reasons.push('projection-signature-created-required');
	}

	if (!parsed) {
		reasons.push('projection-signature-header-required');
	} else {
		if (parsed.algorithm !== PROJECTION_SIGNATURE_ALGORITHM) {
			reasons.push('projection-signature-algorithm-unsupported');
		}

		if (parsed.headers.join(' ') !== PROJECTION_SIGNATURE_HEADERS.join(' ')) {
			reasons.push('projection-signature-headers-mismatch');
		}

		if (expectedKeyId && parsed.keyId !== expectedKeyId) {
			reasons.push('projection-signature-key-id-mismatch');
		}
	}

	if (!publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')) {
		reasons.push('projection-signature-public-key-invalid');
	}

	if (reasons.length === 0 && parsed) {
		const signatureString = buildProjectionHttpSignatureString({
			method,
			requestUrl,
			digest,
			signatureCreated,
		});
		const verifier = createVerify('RSA-SHA256');
		verifier.update(signatureString, 'utf8');
		const valid = verifier.verify(publicKeyPem, Buffer.from(parsed.signature, 'base64'));
		if (!valid) {
			reasons.push('projection-signature-verification-failed');
		}
	}

	if (reasons.length > 0 || !parsed) {
		throw new StaticProjectionSnapshotError(reasons);
	}

	return {
		keyId: parsed.keyId,
		algorithm: parsed.algorithm,
		headers: parsed.headers,
		digest,
		signatureCreated,
	};
}

function collectForbiddenKeys(value: JsonValue, pattern: RegExp, path = '$'): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((item, index) => collectForbiddenKeys(item, pattern, `${path}[${index}]`));
	}

	if (!isObject(value)) {
		return [];
	}

	return Object.entries(value).flatMap(([key, child]) => {
		const currentPath = `${path}.${key}`;
		const childMatches = collectForbiddenKeys(child, pattern, currentPath);
		return pattern.test(key) ? [currentPath, ...childMatches] : childMatches;
	});
}

function validateCommonSnapshot(value: JsonObject, reasons: string[]): void {
	const secretKeys = collectForbiddenKeys(value, SECRET_KEY_PATTERN);
	if (secretKeys.length > 0) {
		reasons.push(`secret-shaped-public-fields:${secretKeys.join('|')}`);
	}
}

function getStaticCollection(snapshot: JsonObject): JsonValue[] | undefined {
	const projectionKind = asString(snapshot.projectionKind);
	if (!projectionKind) {
		return undefined;
	}

	const collectionField = STATIC_COLLECTION_BY_KIND[projectionKind];
	if (!collectionField) {
		return undefined;
	}

	const collection = snapshot[collectionField];
	return Array.isArray(collection) ? collection : undefined;
}

function validateStaticSpokeSnapshot(
	snapshot: JsonObject,
	options: StaticProjectionValidationOptions,
	reasons: string[],
): StaticProjectionValidationResult {
	const contentHash = asString(snapshot.contentHash);
	const itemCount = asNumber(snapshot.itemCount);
	const sourceAuthority = asString(snapshot.sourceAuthority);
	const projectionKind = asString(snapshot.projectionKind);
	const spokeTarget = asString(snapshot.spokeTarget);
	const routePath = asString(snapshot.routePath);

	if (options.expectedSourceAuthority && sourceAuthority !== options.expectedSourceAuthority) {
		reasons.push('source-authority-mismatch');
	}

	if (options.expectedSpokeTarget && spokeTarget !== options.expectedSpokeTarget) {
		reasons.push('spoke-target-mismatch');
	}

	if (!sourceAuthority) {
		reasons.push('source-authority-required');
	}

	if (!projectionKind) {
		reasons.push('projection-kind-required');
	}

	if (!spokeTarget) {
		reasons.push('spoke-target-required');
	}

	if (!routePath?.startsWith('/')) {
		reasons.push('route-path-required');
	}

	ensureHttpsUrl(asString(snapshot.sourceAuthorityUrl), 'sourceAuthorityUrl', reasons);
	ensureHttpsUrl(asString(snapshot.publicSnapshotUrl), 'publicSnapshotUrl', reasons);

	if (!hasSha256(contentHash)) {
		reasons.push('content-hash-required');
	} else if (contentHash !== calculateStaticSpokeContentHash(snapshot)) {
		reasons.push('content-hash-mismatch');
	}

	if (typeof itemCount !== 'number') {
		reasons.push('item-count-required');
	} else {
		const collection = getStaticCollection(snapshot);
		if (collection && collection.length !== itemCount) {
			reasons.push('item-count-mismatch');
		}
	}

	const activityPubStatus = asString(snapshot.activityPubStatus);
	if (
		activityPubStatus &&
		/public (fediverse|federation launch)/i.test(activityPubStatus) &&
		!/\b(no|not|blocked)\b/i.test(activityPubStatus)
	) {
		reasons.push('activitypub-status-overclaims-public-federation');
	}

	return {
		schemaVersion: STATIC_SPOKE_SCHEMA_VERSION,
		itemCount: itemCount ?? -1,
		projectionKind,
		sourceAuthority,
		spokeTarget,
	};
}

function validatePulseSnapshot(snapshot: JsonObject, reasons: string[]): StaticProjectionValidationResult {
	const items = snapshot.items;
	const manifest = snapshot.manifest;

	if (!Array.isArray(items)) {
		reasons.push('pulse-items-required');
	}

	if (!isObject(manifest)) {
		reasons.push('pulse-manifest-required');
		return {
			schemaVersion: PULSE_SCHEMA_VERSION,
			itemCount: -1,
		};
	}

	if (manifest.schemaVersion !== PULSE_SCHEMA_VERSION) {
		reasons.push('pulse-manifest-schema-version-mismatch');
	}

	const itemCount = asNumber(manifest.itemCount);
	if (typeof itemCount !== 'number') {
		reasons.push('pulse-item-count-required');
	} else if (Array.isArray(items) && items.length !== itemCount) {
		reasons.push('pulse-item-count-mismatch');
	}

	const contentHash = asString(manifest.contentHash);
	if (!hasSha256(contentHash)) {
		reasons.push('pulse-content-hash-required');
	} else if (contentHash !== calculatePulseContentHash(snapshot)) {
		reasons.push('pulse-content-hash-mismatch');
	}

	if (Array.isArray(items)) {
		for (const item of items) {
			if (!isObject(item)) {
				reasons.push('pulse-item-must-be-object');
				continue;
			}

			const kind = asString(item.kind);
			if (!kind || !ALLOWED_PULSE_KINDS.has(kind)) {
				reasons.push('pulse-item-kind-not-public-m1');
			}
		}
	}

	const privatePulseKeys = collectForbiddenKeys(snapshot, PULSE_PRIVATE_FIELD_PATTERN);
	if (privatePulseKeys.length > 0) {
		reasons.push(`pulse-private-public-fields:${privatePulseKeys.join('|')}`);
	}

	return {
		schemaVersion: PULSE_SCHEMA_VERSION,
		itemCount: itemCount ?? -1,
		projectionKind: 'pulse',
	};
}

export function validateStaticProjectionSnapshot(
	value: JsonValue,
	options: StaticProjectionValidationOptions = {},
): StaticProjectionValidationResult {
	const reasons: string[] = [];

	if (!isObject(value)) {
		throw new StaticProjectionSnapshotError(['snapshot-must-be-json-object']);
	}

	validateCommonSnapshot(value, reasons);

	const schemaVersion = asString(value.schemaVersion);
	let result: StaticProjectionValidationResult;

	if (schemaVersion === STATIC_SPOKE_SCHEMA_VERSION) {
		result = validateStaticSpokeSnapshot(value, options, reasons);
	} else if (schemaVersion === PULSE_SCHEMA_VERSION) {
		result = validatePulseSnapshot(value, reasons);
	} else {
		result = {
			schemaVersion: schemaVersion ?? 'unknown',
			itemCount: -1,
		};
		reasons.push('unsupported-schema-version');
	}

	if (reasons.length > 0) {
		throw new StaticProjectionSnapshotError(reasons);
	}

	return result;
}

export function validateActivityPubActorKeyDocument(
	value: JsonValue,
	options: ActivityPubActorKeyValidationOptions = {},
): ActivityPubActorKeyValidationResult {
	const reasons: string[] = [];

	if (!isObject(value)) {
		throw new StaticProjectionSnapshotError(['actor-document-must-be-json-object']);
	}

	const actorId = asString(value.id);
	const publicKey = value.publicKey;

	if (!actorId) {
		reasons.push('actor-id-required');
	}

	if (options.expectedActorId && actorId !== options.expectedActorId) {
		reasons.push('actor-id-mismatch');
	}

	if (!isObject(publicKey)) {
		reasons.push('actor-public-key-required');
	} else {
		const publicKeyId = asString(publicKey.id);
		const publicKeyOwner = asString(publicKey.owner);
		const publicKeyPem = asString(publicKey.publicKeyPem);

		if (!publicKeyId) {
			reasons.push('actor-public-key-id-required');
		}

		if (!publicKeyOwner) {
			reasons.push('actor-public-key-owner-required');
		}

		if (!publicKeyPem) {
			reasons.push('actor-public-key-pem-required');
		} else if (
			!publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----') ||
			!publicKeyPem.trimEnd().endsWith('-----END PUBLIC KEY-----')
		) {
			reasons.push('actor-public-key-pem-invalid');
		}

		if (actorId && publicKeyOwner && publicKeyOwner !== actorId) {
			reasons.push('actor-public-key-owner-mismatch');
		}

		if (options.expectedPublicKeyId && publicKeyId !== options.expectedPublicKeyId) {
			reasons.push('actor-public-key-id-mismatch');
		}

		if (options.expectedPublicKeyOwner && publicKeyOwner !== options.expectedPublicKeyOwner) {
			reasons.push('actor-public-key-owner-mismatch');
		}

		if (reasons.length === 0) {
			return {
				actorId: actorId as string,
				publicKeyId: publicKeyId as string,
				publicKeyOwner: publicKeyOwner as string,
				publicKeyPem: publicKeyPem as string,
				publicKeyFingerprintSha256: sha256HexBare(publicKeyPem as string),
			};
		}
	}

	throw new StaticProjectionSnapshotError(reasons);
}
