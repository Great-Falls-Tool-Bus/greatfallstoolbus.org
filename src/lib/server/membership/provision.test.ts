/**
 * Provisioning fan-out — pure halves (TIN-3964): the identity-key shape and
 * the versioned ids-only payload guards. No database, no network; the transactional
 * enqueue-at-activation behavior is proven in
 * `./activation.integration.test.ts` (fresh activation → exactly four pending
 * projection rows; converged replay → none added).
 */

import { describe, expect, it } from 'vitest';
import {
	ListJobPayloadError,
	PROVISION_JOB_KINDS,
	ProvisionJobPayloadError,
	emailListReconciliationIdempotencyKey,
	parseListJobPayload,
	parseProvisionJobPayload,
	provisionIdempotencyKey,
} from './provision';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const MEMBERSHIP_ID = '22222222-3333-4444-8555-666666666666';
const PERSON_ID = '33333333-4444-4555-8666-777777777777';

describe('provisionIdempotencyKey — the §2.3 identity-key shape, mirrored', () => {
	it('derives from the membership id alone, no caller segment', () => {
		expect(provisionIdempotencyKey(TENANT_ID, MEMBERSHIP_ID, 'provision.add_lists')).toBe(
			`${TENANT_ID}:membership:${MEMBERSHIP_ID}:add_lists:g1`,
		);
	});

	it('covers the four activation entitlements; readiness gates defer delivery, never intent', () => {
		expect(PROVISION_JOB_KINDS).toEqual([
			'provision.ensure_identity',
			'provision.enable_mailbox',
			'provision.add_lists',
			'provision.ensure_archive',
		]);
	});

	it('keys each verified-email reconciliation by the inserted address-row id', () => {
		const emailId = '44444444-5555-4666-8777-888888888888';
		expect(emailListReconciliationIdempotencyKey(TENANT_ID, MEMBERSHIP_ID, emailId)).toBe(
			`${TENANT_ID}:membership:${MEMBERSHIP_ID}:add_lists:email:${emailId}`,
		);
	});
});

describe('parseProvisionJobPayload — exact tenant-bound v1 carrier', () => {
	const payload = {
		schemaVersion: 1,
		tenantId: TENANT_ID,
		membershipId: MEMBERSHIP_ID,
		personId: PERSON_ID,
		generation: 1,
	} as const;

	it('accepts only the v1 ids-only carrier emitted by activation', () => {
		expect(parseProvisionJobPayload(payload, 'job-1', TENANT_ID)).toEqual(payload);
	});

	it.each([
		[undefined],
		[{ ...payload, schemaVersion: 2 }],
		[{ ...payload, generation: 2 }],
		[{ ...payload, tenantId: '44444444-5555-4666-8777-888888888888' }],
		[{ ...payload, address: 'must-not-enter-the-outbox@example.org' }],
		[{ ...payload, membershipId: 'not-a-uuid' }],
	])('rejects malformed, cross-tenant, or widened payloads (%j)', (candidate) => {
		expect(() => parseProvisionJobPayload(candidate, 'job-1', TENANT_ID)).toThrow(ProvisionJobPayloadError);
	});

	it('names only the job and violated field, never poisoned content', () => {
		let message = '';
		try {
			parseProvisionJobPayload({ ...payload, personId: 'secret-looking@example.org' }, 'job-poisoned-1', TENANT_ID);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('job-poisoned-1');
		expect(message).not.toContain('secret-looking');
	});
});

describe('parseListJobPayload — the ids-only payload guard', () => {
	it('accepts the { membershipId, personId } shape the fan-outs write', () => {
		expect(parseListJobPayload({ membershipId: MEMBERSHIP_ID, personId: PERSON_ID }, 'job-1')).toEqual({
			membershipId: MEMBERSHIP_ID,
			personId: PERSON_ID,
		});
	});

	it.each([
		[undefined],
		[null],
		[{}],
		[{ membershipId: MEMBERSHIP_ID }],
		[{ personId: PERSON_ID }],
		[{ membershipId: 'not-a-uuid', personId: PERSON_ID }],
		[{ membershipId: MEMBERSHIP_ID, personId: 42 }],
		[{ membershipId: MEMBERSHIP_ID, personId: PERSON_ID, address: 'must-not-enter@example.org' }],
	])('rejects a malformed payload (%j) deterministically', (payload) => {
		expect(() => parseListJobPayload(payload, 'job-1')).toThrow(ListJobPayloadError);
	});

	it('names the job id in the error and quotes no payload content (last_error is durable and public-repo-visible)', () => {
		let message = '';
		try {
			parseListJobPayload({ membershipId: 'secret-looking-value@example.org' }, 'job-poisoned-1');
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('job-poisoned-1');
		expect(message).not.toContain('secret-looking-value');
	});
});
