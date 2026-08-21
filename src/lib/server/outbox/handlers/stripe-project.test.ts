/**
 * Keyless half of the `stripe.project` handler (TIN-3818/TIN-3817 S9): the
 * malformed-payload guard, provable without a database because it runs
 * BEFORE `withTenant` is ever called.
 *
 * The database-backed half — claim, dispatch, projection convergence,
 * duplicate-claim safety — lives in `./stripe-project.integration.test.ts`
 * under `just test-integration`.
 */

import { describe, expect, it } from 'vitest';
import type { DbTransaction } from '../../db/client';
import { createReplayGateway } from '../../stripe/fixtures';
import { createStripeProjectHandler, StripeProjectPayloadError, STRIPE_PROJECT_JOB_KIND } from './stripe-project';
import type { ClaimedJob } from '../schema';

/** Same idiom as outbox.test.ts's `neverTouched`: proves a guard fires before any db access. */
const neverTouched = new Proxy(
	{},
	{
		get() {
			throw new Error('handler touched the db before validating its payload');
		},
	},
) as unknown as DbTransaction;

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
	return {
		id: 'job-1',
		tenantId: '11111111-2222-4333-8444-555555555555',
		kind: STRIPE_PROJECT_JOB_KIND,
		aggregateType: 'stripe_event',
		aggregateId: '22222222-3333-4444-8555-666666666666',
		payload: { eventId: 'evt_gftb_fx_0001' },
		idempotencyKey: 'evt_gftb_fx_0001',
		status: 'leased',
		attempts: 0,
		maxAttempts: 8,
		availableAt: new Date(),
		leaseOwner: 'worker#lease-1',
		leaseExpiresAt: new Date(Date.now() + 60_000),
		lastError: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		leaseToken: 'worker#lease-1',
		...overrides,
	};
}

describe('createStripeProjectHandler — the malformed-payload guard', () => {
	it.each([
		[undefined, 'undefined payload'],
		[null, 'null payload'],
		[{}, 'payload missing eventId'],
		[{ eventId: '' }, 'blank eventId'],
		[{ eventId: 42 }, 'non-string eventId'],
	] as const)('rejects a poisoned job (%s) BEFORE touching the database', async (payload, _label) => {
		const handler = createStripeProjectHandler({ gateway: createReplayGateway(), db: neverTouched as never });
		await expect(handler(job({ payload }))).rejects.toThrow(StripeProjectPayloadError);
	});

	it('names the job id and the offending payload in the error — an operator reading the dead-letter needs both', async () => {
		const handler = createStripeProjectHandler({ gateway: createReplayGateway(), db: neverTouched as never });
		await expect(handler(job({ id: 'job-poisoned-1', payload: { wrong: 'shape' } }))).rejects.toThrow(
			/job-poisoned-1.*\{"wrong":"shape"\}/,
		);
	});
});
