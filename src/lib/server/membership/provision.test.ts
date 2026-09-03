/** Pure projection-intent key contract; transactional rows are covered by activation integration. */

import { describe, expect, it } from 'vitest';
import {
	PROVISION_JOB_KINDS,
	emailListReconciliationIdempotencyKey,
	provisionIdempotencyKey,
} from './provision';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const MEMBERSHIP_ID = '22222222-3333-4444-8555-666666666666';

describe('projection intent identity keys', () => {
	it('derives a generation-bound key from tenant, membership, and effect', () => {
		expect(provisionIdempotencyKey(TENANT_ID, MEMBERSHIP_ID, 'provision.add_lists')).toBe(
			`${TENANT_ID}:membership:${MEMBERSHIP_ID}:add_lists:g1`,
		);
	});

	it('carries the four unified Member v0 entitlements', () => {
		expect(PROVISION_JOB_KINDS).toEqual([
			'provision.ensure_identity',
			'provision.enable_mailbox',
			'provision.add_lists',
			'provision.ensure_archive',
		]);
	});

	it('keys each verified-email reconciliation by the new address-row id', () => {
		const emailId = '44444444-5555-4666-8777-888888888888';
		expect(emailListReconciliationIdempotencyKey(TENANT_ID, MEMBERSHIP_ID, emailId)).toBe(
			`${TENANT_ID}:membership:${MEMBERSHIP_ID}:add_lists:email:${emailId}`,
		);
	});
});
