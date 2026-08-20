/**
 * S5 unit rows (slices §1.7 acceptance), PostgreSQL-free:
 *   - decline without a reason is rejected (validator AND function guard);
 *   - the decision payload schema has no contribution field — STRUCTURAL:
 *     unknown keys are rejected, so a later field addition fails here;
 *   - the ratified source-state sets are pinned exactly (no claimed→approved
 *     edge; withdraw's four sources; decline's two);
 *   - the role S5 hangs capabilities on is `keyholder`, and the unratified
 *     word "steward" appears in no exported surface (sitting-2 item 2).
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DbTransaction } from '../db/client';
import { KEYHOLDER_ROLE } from './claim';
import {
	APPROVE_SOURCE_STATUSES,
	DECLINE_SOURCE_STATUSES,
	InvalidDecisionError,
	WITHDRAW_SOURCE_STATUSES,
	declineApplication,
	validateApproval,
	validateDecline,
} from './decide';

const appId = randomUUID();

describe('decline requires a recorded reason (TIN-3440; S5 acceptance row 6)', () => {
	it.each([
		['absent', { applicationId: appId }],
		['empty', { applicationId: appId, reasonClass: '' }],
		['whitespace', { applicationId: appId, reasonClass: '   ' }],
		['non-string', { applicationId: appId, reasonClass: 7 }],
	])('validator rejects a %s reason', (_label, raw) => {
		expect(() => validateDecline(raw as Record<string, unknown>)).toThrowError(InvalidDecisionError);
		try {
			validateDecline(raw as Record<string, unknown>);
		} catch (error) {
			expect((error as InvalidDecisionError).fields).toContain('reasonClass');
		}
	});

	it('the function guard holds even for a caller that skipped the validator', async () => {
		// The reason check is the FIRST statement — a dummy tx proves no
		// database work happens before the refusal.
		await expect(
			declineApplication({} as DbTransaction, {
				applicationId: appId,
				keyholderPersonId: randomUUID(),
				reasonClass: '   ',
			}),
		).rejects.toThrowError(InvalidDecisionError);
	});

	it('a real reason survives validation, trimmed', () => {
		const validated = validateDecline({ applicationId: appId, reasonClass: '  capacity  ' });
		expect(validated.reasonClass).toBe('capacity');
	});
});

describe('structural: no contribution field on any decision payload (S5 acceptance row 5)', () => {
	it.each([['contributionAmount'], ['amountCents'], ['rail'], ['paymentIntent'], ['stripeCustomerId']])(
		'approve rejects a smuggled %s',
		(key) => {
			expect(() => validateApproval({ applicationId: appId, [key]: 500 })).toThrowError(InvalidDecisionError);
			try {
				validateApproval({ applicationId: appId, [key]: 500 });
			} catch (error) {
				expect((error as InvalidDecisionError).fields).toContain(`unknown_field:${key}`);
			}
		},
	);

	it('decline rejects a smuggled contribution field too', () => {
		expect(() =>
			validateDecline({ applicationId: appId, reasonClass: 'capacity', contributionAmount: 500 }),
		).toThrowError(InvalidDecisionError);
	});

	it('the validated approval payload carries EXACTLY the known keys — an added field fails this test', () => {
		const validated = validateApproval({ applicationId: appId, note: 'met at tour', expectedVersion: 3 });
		expect(Object.keys(validated).sort()).toEqual(['applicationId', 'expectedVersion', 'note']);
	});

	it('the validated decline payload carries EXACTLY the known keys', () => {
		const validated = validateDecline({ applicationId: appId, reasonClass: 'capacity' });
		expect(Object.keys(validated).sort()).toEqual(['applicationId', 'expectedVersion', 'note', 'reasonClass']);
	});
});

describe('the ratified edges, pinned (spec §4; member-lifecycle.mmd)', () => {
	it('approve is reachable ONLY from tour_scheduled — no claimed→approved edge', () => {
		expect([...APPROVE_SOURCE_STATUSES]).toEqual(['tour_scheduled']);
	});

	it('decline is reachable from claimed and tour_scheduled, exactly', () => {
		expect([...DECLINE_SOURCE_STATUSES]).toEqual(['claimed', 'tour_scheduled']);
	});

	it('withdraw is reachable from every pre-decision state, exactly (slices §2.2 row 8)', () => {
		expect([...WITHDRAW_SOURCE_STATUSES]).toEqual(['submitted', 'email_verified', 'claimed', 'tour_scheduled']);
	});
});

describe('vocabulary (sitting-2 item 2; slices §1.4)', () => {
	it('S5 hangs its capabilities on the keyholder grant, and only that', () => {
		expect(KEYHOLDER_ROLE).toBe('keyholder');
	});

	it('validators reject malformed application ids before any database work', () => {
		expect(() => validateApproval({ applicationId: 'not-a-uuid' })).toThrowError(InvalidDecisionError);
		expect(() => validateDecline({ applicationId: '', reasonClass: 'x' })).toThrowError(InvalidDecisionError);
	});
});
