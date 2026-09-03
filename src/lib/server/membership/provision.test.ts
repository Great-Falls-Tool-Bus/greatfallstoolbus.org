/** Pure projection-intent key contract; transactional rows are covered by activation integration. */

import { describe, expect, it } from 'vitest';
import { PROVISION_JOB_KINDS, emailRekeyIdempotencyKey, provisionIdempotencyKey } from './provision';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const MEMBERSHIP_ID = '22222222-3333-4444-8555-666666666666';
const PERSON_ID = '33333333-4444-4555-8666-777777777777';

describe('projection intent identity keys', () => {
	it('derives the P1 key from tenant, membership, and effect', () => {
		expect(provisionIdempotencyKey(TENANT_ID, MEMBERSHIP_ID, 'provision.add_lists')).toBe(
			`${TENANT_ID}:membership:${MEMBERSHIP_ID}:add_lists`,
		);
	});

	it('carries exactly the two P1 activation effects', () => {
		expect(PROVISION_JOB_KINDS).toEqual(['provision.add_lists', 'provision.enable_mailbox']);
	});

	it('keys each P4 email re-projection by person and the new address-row id', () => {
		const emailId = '44444444-5555-4666-8777-888888888888';
		expect(emailRekeyIdempotencyKey(TENANT_ID, PERSON_ID, emailId)).toBe(
			`${TENANT_ID}:person:${PERSON_ID}:rekey:${emailId}`,
		);
	});
});
