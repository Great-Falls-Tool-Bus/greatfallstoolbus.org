/**
 * Keyless half of the shared application-mail handler core (TIN-4062): the
 * malformed-payload guard and the "resolve delivery before any I/O" ordering,
 * both provable without a database — the same split
 * `stripe-project.test.ts` establishes for its own malformed-payload guard.
 *
 * The database-backed half (idempotent replay, real render/mint/journal,
 * dead-letter on template-unapproved + delivery-enabled) lives in
 * `./mail.integration.test.ts` under `just test-integration`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../db/client';
import type { MailDelivery } from '../../mail/delivery';
import type { MailTemplate } from '../../mail/templates';
import type { ClaimedJob } from '../schema';
import { createApplicationMailHandler, MailHandlerPayloadError } from './mail-shared';

/** Same idiom as `stripe-project.test.ts`'s `neverTouched`: proves a guard fires before any db access. */
const neverTouchedDb = new Proxy(
	{},
	{
		get() {
			throw new Error('handler touched the db before its guard fired');
		},
	},
) as unknown as Db;

const TEMPLATE: MailTemplate<{ applicationId: string }> = {
	id: 'application.receipt_email',
	approved: false,
	subject: () => 'subject',
	text: () => 'text',
};

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
	return {
		id: 'job-1',
		tenantId: '11111111-2222-4333-8444-555555555555',
		kind: 'application.receipt_email',
		aggregateType: 'application',
		aggregateId: '22222222-3333-4444-8555-666666666666',
		payload: { applicationId: '22222222-3333-4444-8555-666666666666' },
		idempotencyKey: 'idem-1',
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

describe('createApplicationMailHandler — the malformed-payload guard', () => {
	it.each([
		[undefined, 'undefined payload'],
		[null, 'null payload'],
		[{}, 'payload missing applicationId'],
		[{ applicationId: '' }, 'blank applicationId'],
		[{ applicationId: 'not-a-uuid' }, 'non-uuid applicationId'],
		[{ applicationId: 42 }, 'non-string applicationId'],
	] as const)(
		'rejects a poisoned job (%s) BEFORE resolving delivery or touching the database',
		async (payload, _label) => {
			const deliveryFactory = vi.fn<() => MailDelivery>(() => {
				throw new Error('deliveryFactory must not be called for a poisoned payload');
			});
			const render = vi.fn(async () => {
				throw new Error('render must not be called for a poisoned payload');
			});
			const handler = createApplicationMailHandler({
				template: TEMPLATE,
				render,
				db: neverTouchedDb,
				deliveryFactory,
			});

			await expect(handler(job({ payload }))).rejects.toThrow(MailHandlerPayloadError);
			expect(deliveryFactory).not.toHaveBeenCalled();
			expect(render).not.toHaveBeenCalled();
		},
	);
});

describe('createApplicationMailHandler — delivery is resolved BEFORE any transaction opens', () => {
	it('propagates a delivery-resolution throw (e.g. TemplateNotApprovedError) without ever touching the database', async () => {
		class Poison extends Error {}
		const deliveryFactory = vi.fn(() => {
			throw new Poison('template not approved');
		});
		const render = vi.fn(async () => {
			throw new Error('render must not run when delivery resolution already threw');
		});
		const handler = createApplicationMailHandler({
			template: TEMPLATE,
			render,
			db: neverTouchedDb, // proves withTenant/the pool were never reached
			deliveryFactory,
		});

		await expect(handler(job())).rejects.toThrow(Poison);
		expect(deliveryFactory).toHaveBeenCalledTimes(1);
		expect(deliveryFactory).toHaveBeenCalledWith(TEMPLATE, expect.anything());
		expect(render).not.toHaveBeenCalled();
	});

	it('calls deliveryFactory with the caller-supplied env, not always process.env', async () => {
		const customEnv = { MARKER: 'yes' } as unknown as NodeJS.ProcessEnv;
		let seenEnv: NodeJS.ProcessEnv | undefined;
		const deliveryFactory = vi.fn((_template: MailTemplate<unknown>, env: NodeJS.ProcessEnv) => {
			seenEnv = env;
			throw new Error('stop before any db access');
		});
		const handler = createApplicationMailHandler({
			template: TEMPLATE,
			render: async () => {
				throw new Error('unreachable');
			},
			db: neverTouchedDb,
			env: customEnv,
			deliveryFactory: deliveryFactory as never,
		});

		await expect(handler(job())).rejects.toThrow();
		expect(seenEnv).toBe(customEnv);
	});
});
