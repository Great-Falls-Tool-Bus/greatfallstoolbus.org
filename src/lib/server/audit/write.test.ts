/**
 * S6 unit rows for the audit spine (slices §1.8 acceptance: "a scanner test
 * asserts no audit row contains a token, secret, URL, or free-text personal
 * content"): the seam REFUSES forbidden content — enforcement, not promise —
 * and the spec §6 required-field rules are structural.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AUDIT_EVENTS, AUDIT_REQUIRED_COLUMNS, type AuditEventInput } from './schema';
import { InvalidAuditEventError, assertAuditInput, assertReasonClass } from './write';

function base(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
	return {
		actorType: 'person',
		actorId: randomUUID(),
		aggregateType: 'membership',
		aggregateId: randomUUID(),
		event: 'membership.paused',
		...overrides,
	};
}

describe('the scanner rows — spec §6 forbidden content is REFUSED at the seam', () => {
	it('refuses a token-shaped run (32+ base64url chars — the mint produces 43)', () => {
		const tokenish = randomBytes(32).toString('base64url');
		expect(() => assertReasonClass(tokenish)).toThrow(InvalidAuditEventError);
	});

	it('refuses object URLs in a reason class', () => {
		expect(() => assertReasonClass('see https://example.org/evidence')).toThrow(InvalidAuditEventError);
		expect(() => assertReasonClass('www.example.org record')).toThrow(InvalidAuditEventError);
	});

	it('refuses addresses — personal content has no place in a reason class', () => {
		expect(() => assertReasonClass('emailed someone@example.org twice')).toThrow(InvalidAuditEventError);
	});

	it('refuses free-text narrative shapes: newlines, tabs, runs of spaces, over-length', () => {
		expect(() => assertReasonClass('line one\nline two')).toThrow(InvalidAuditEventError);
		expect(() => assertReasonClass('a\tb')).toThrow(InvalidAuditEventError);
		expect(() => assertReasonClass('padded    narrative')).toThrow(InvalidAuditEventError);
		expect(() => assertReasonClass('x'.repeat(101))).toThrow(InvalidAuditEventError);
		expect(() => assertReasonClass('   ')).toThrow(InvalidAuditEventError);
	});

	it('accepts an honest classification', () => {
		expect(assertReasonClass('moved away')).toBe('moved away');
		expect(assertReasonClass('code_of_conduct')).toBe('code_of_conduct');
	});

	it('refuses a tokenHash that is not exactly a SHA-256 hex digest', () => {
		expect(() => assertAuditInput(base({ tokenHash: 'plaintext-token-here' }))).toThrow(InvalidAuditEventError);
		// The hash itself (computed, never inlined) passes — hash-only at rest.
		const hash = randomBytes(32).toString('hex');
		expect(() => assertAuditInput(base({ tokenHash: hash }))).not.toThrow();
	});
});

describe('the spec §6 required fields, structurally', () => {
	it('pins the required-column contract', () => {
		expect(AUDIT_REQUIRED_COLUMNS).toEqual([
			'actorType',
			'aggregateType',
			'aggregateId',
			'event',
			'result',
			'createdAt',
		]);
	});

	it('rejects an event name outside the ratified vocabulary', () => {
		expect(() => assertAuditInput(base({ event: 'membership.imagined' as never }))).toThrow(InvalidAuditEventError);
	});

	it('the vocabulary is exactly the transition table audit column (rows 2-14)', () => {
		expect([...AUDIT_EVENTS].sort()).toEqual(
			[
				'application.submitted',
				'application.email_verified',
				'application.claimed',
				'application.tour_scheduled',
				'application.approved',
				'application.declined',
				'application.withdrawn',
				'application.expired',
				'membership.created',
				'membership.activated',
				'membership.paused',
				'membership.resumed',
				'membership.left',
				'membership.removed',
			].sort(),
		);
	});

	it('a person actor requires an actorId; system/public forbid one', () => {
		expect(() => assertAuditInput(base({ actorId: undefined }))).toThrow(InvalidAuditEventError);
		expect(() =>
			assertAuditInput(
				base({ actorType: 'system', actorId: undefined, event: 'application.expired', aggregateType: 'application' }),
			),
		).not.toThrow();
		expect(() =>
			assertAuditInput(base({ actorType: 'system', event: 'application.expired', aggregateType: 'application' })),
		).toThrow(InvalidAuditEventError);
	});

	it('membership.activated REQUIRES the agreement version (row 10)', () => {
		expect(() => assertAuditInput(base({ event: 'membership.activated' }))).toThrow(InvalidAuditEventError);
		expect(() => assertAuditInput(base({ event: 'membership.activated', agreementVersionId: 1 }))).not.toThrow();
	});

	it('membership.removed REQUIRES the reauth timestamp (row 14)', () => {
		expect(() => assertAuditInput(base({ event: 'membership.removed' }))).toThrow(InvalidAuditEventError);
		expect(() => assertAuditInput(base({ event: 'membership.removed', reauthAt: new Date() }))).not.toThrow();
	});
});
