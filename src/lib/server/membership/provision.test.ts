/**
 * Provisioning fan-out — pure halves (TIN-3964): the identity-key shape and
 * the ids-only payload guard. No database, no network; the transactional
 * enqueue-at-activation behavior is proven in
 * `./activation.integration.test.ts` (fresh activation → exactly one pending
 * `provision.add_lists` row; converged replay → none added).
 */

import { describe, expect, it } from 'vitest';
import { ListJobPayloadError, PROVISION_JOB_KINDS, parseListJobPayload, provisionIdempotencyKey } from './provision';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const MEMBERSHIP_ID = '22222222-3333-4444-8555-666666666666';
const PERSON_ID = '33333333-4444-4555-8666-777777777777';

describe('provisionIdempotencyKey — the §2.3 identity-key shape, mirrored', () => {
	it('derives from the membership id alone, no caller segment', () => {
		expect(provisionIdempotencyKey(TENANT_ID, MEMBERSHIP_ID, 'provision.add_lists')).toBe(
			`${TENANT_ID}:membership:${MEMBERSHIP_ID}:add_lists`,
		);
	});

	it('covers exactly the one ratified kind — provision.enable_mailbox stays behind the mailbox gate', () => {
		expect(PROVISION_JOB_KINDS).toEqual(['provision.add_lists']);
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
