/**
 * S6 unit rows for the agreement-version mechanics (slices §1.8 ASSUMPTION;
 * sitting-2 item 3): the pure currency rule, the digest, and the slot's
 * pre-ratification honesty.
 *
 * NOTE ON DIGESTS: expected values are COMPUTED at runtime, never inlined —
 * a literal 64-hex digest in a source file trips the machine-level secret
 * hook (S1's recorded gotcha) and would be exactly the copy-paste constant a
 * digest test must not trust anyway.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AgreementVersion } from '../db/schema';
import { AGREEMENT_BODY_V1, agreementBodySha256, pickCurrent } from './agreement';

function version(id: number, effectiveFrom: string): AgreementVersion {
	return {
		tenantId: '00000000-0000-4000-8000-000000000000',
		id,
		body: `body ${id}`,
		bodySha256: agreementBodySha256(`body ${id}`),
		effectiveFrom: new Date(effectiveFrom),
		createdAt: new Date(effectiveFrom),
	};
}

describe('agreementBodySha256', () => {
	it('is SHA-256 hex of the exact body text', () => {
		const body = 'The membership agreement.';
		expect(agreementBodySha256(body)).toBe(createHash('sha256').update(body, 'utf8').digest('hex'));
	});

	it('changes when the body changes by one byte — the immutability anchor', () => {
		expect(agreementBodySha256('a')).not.toBe(agreementBodySha256('a '));
	});
});

describe('pickCurrent — exactly one version is current (drafted scheme)', () => {
	const now = new Date('2026-08-20T12:00:00Z');

	it('returns null when no versions exist (pre-ratification honesty)', () => {
		expect(pickCurrent([], now)).toBeNull();
	});

	it('picks the greatest effective_from at or before now', () => {
		const rows = [version(1, '2026-08-01T00:00:00Z'), version(2, '2026-08-15T00:00:00Z')];
		expect(pickCurrent(rows, now)?.id).toBe(2);
	});

	it('a version published ahead of its effective date is NOT yet current', () => {
		const rows = [version(1, '2026-08-01T00:00:00Z'), version(2, '2026-09-01T00:00:00Z')];
		expect(pickCurrent(rows, now)?.id).toBe(1);
	});

	it('ties on effective_from break to the highest id', () => {
		const rows = [version(1, '2026-08-01T00:00:00Z'), version(2, '2026-08-01T00:00:00Z')];
		expect(pickCurrent(rows, now)?.id).toBe(2);
	});

	it('order of rows does not matter — currency is a pure function', () => {
		const rows = [
			version(3, '2026-08-10T00:00:00Z'),
			version(1, '2026-08-01T00:00:00Z'),
			version(2, '2026-08-15T00:00:00Z'),
		];
		expect(pickCurrent([...rows].reverse(), now)?.id).toBe(pickCurrent(rows, now)?.id);
	});
});

describe('the sitting-2 item-3 slot', () => {
	it('ships UNDEFINED: version 1 body is operator-published data, never agent copy', () => {
		// If this fails, someone committed agreement text into the repository —
		// the exact thing the packet forbids before ratification.
		expect(AGREEMENT_BODY_V1).toBeUndefined();
	});
});
