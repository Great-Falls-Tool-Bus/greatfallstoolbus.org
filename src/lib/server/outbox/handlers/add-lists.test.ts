/**
 * `provision.add_lists` handler (TIN-3964) — unit lane: the payload guard,
 * the gate-disabled recorded no-op, and the §5 staleness guard, all provable
 * without a database via the handler's seams (the `stripe-project.test.ts`
 * idiom; state re-reads ride the injectable `readState` seam).
 */

import { describe, expect, it } from 'vitest';
import { ListJobPayloadError } from '../../membership/provision';
import type { ClaimedJob } from '../schema';
import { ADD_LISTS_JOB_KIND, createAddListsHandler } from './add-lists';

const MEMBERSHIP_ID = '22222222-3333-4444-8555-666666666666';
const PERSON_ID = '33333333-4444-4555-8666-777777777777';

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
	return {
		id: 'job-1',
		tenantId: '11111111-2222-4333-8444-555555555555',
		kind: ADD_LISTS_JOB_KIND,
		aggregateType: 'membership',
		aggregateId: MEMBERSHIP_ID,
		payload: { membershipId: MEMBERSHIP_ID, personId: PERSON_ID },
		idempotencyKey: `tenant:membership:${MEMBERSHIP_ID}:add_lists`,
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

describe('createAddListsHandler — the malformed-payload guard', () => {
	it.each([
		[undefined, 'undefined payload'],
		[null, 'null payload'],
		[{}, 'empty payload'],
		[{ membershipId: MEMBERSHIP_ID }, 'missing personId'],
		[{ membershipId: 'not-a-uuid', personId: PERSON_ID }, 'non-UUID membershipId'],
	] as const)('rejects a poisoned job (%s) even while the gate is closed — poison dead-letters, never silently completes', async (payload) => {
		const handler = createAddListsHandler({});
		await expect(handler(job({ payload }))).rejects.toThrow(ListJobPayloadError);
	});

	it('the payload error names ids only — never an address', async () => {
		const handler = createAddListsHandler({});
		let message = '';
		try {
			await handler(job({ id: 'job-poisoned-1', payload: { membershipId: 42 } }));
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('job-poisoned-1');
		expect(message).not.toContain('@');
	});
});

describe('createAddListsHandler — gate-disabled recorded no-op (the default)', () => {
	it('completes without delivery and logs ids only', async () => {
		const lines: string[] = [];
		const handler = createAddListsHandler({ log: (line) => lines.push(line) });
		await expect(handler(job())).resolves.toBeUndefined();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('gate-disabled');
		expect(lines[0]).toContain(MEMBERSHIP_ID);
		expect(lines[0]).not.toContain('@');
	});

	it('never reads state while the gate is closed (zero I/O of any kind)', async () => {
		const handler = createAddListsHandler({
			log: () => undefined,
			readState: () => {
				throw new Error('gate-disabled path touched the database');
			},
		});
		await expect(handler(job())).resolves.toBeUndefined();
	});
});

describe('createAddListsHandler — the §5 staleness guard (delivery wired)', () => {
	it('subscribes the CURRENT address for an active membership', async () => {
		const delivered: string[] = [];
		const handler = createAddListsHandler({
			delivery: async (address) => void delivered.push(address),
			log: () => undefined,
			readState: async () => ({ membershipStatus: 'active', address: 'member@example.org' }),
		});
		await handler(job());
		expect(delivered).toEqual(['member@example.org']);
	});

	it('subscribes a PAUSED membership too — pause preserves discussion access by ratified design', async () => {
		const delivered: string[] = [];
		const handler = createAddListsHandler({
			delivery: async (address) => void delivered.push(address),
			log: () => undefined,
			readState: async () => ({ membershipStatus: 'paused', address: 'member@example.org' }),
		});
		await handler(job());
		expect(delivered).toEqual(['member@example.org']);
	});

	it.each(['left', 'removed'] as const)(
		'completes as a recorded no-op when offboarding raced ahead (%s) — offboard.remove_lists owns the list state',
		async (status) => {
			const delivered: string[] = [];
			const lines: string[] = [];
			const handler = createAddListsHandler({
				delivery: async (address) => void delivered.push(address),
				log: (line) => lines.push(line),
				readState: async () => ({ membershipStatus: status, address: 'member@example.org' }),
			});
			await expect(handler(job())).resolves.toBeUndefined();
			expect(delivered).toEqual([]);
			expect(lines.join('\n')).toContain(status);
			expect(lines.join('\n')).not.toContain('@');
		},
	);

	it('throws when the membership does not exist — retries into dead-letter visibly', async () => {
		const handler = createAddListsHandler({
			delivery: async () => undefined,
			log: () => undefined,
			readState: async () => ({ membershipStatus: null, address: null }),
		});
		await expect(handler(job())).rejects.toThrow(/not found/);
	});

	it('throws when the person has no current address — ids only in the message', async () => {
		const handler = createAddListsHandler({
			delivery: async () => undefined,
			log: () => undefined,
			readState: async () => ({ membershipStatus: 'active', address: null }),
		});
		let message = '';
		try {
			await handler(job());
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain(PERSON_ID);
		expect(message).not.toContain('@example');
	});

	it('a configured-but-failing delivery propagates — the dispatcher owns retry/dead-letter', async () => {
		const handler = createAddListsHandler({
			delivery: async () => {
				throw new Error('mailman subscribe for discuss.latoolb.us returned HTTP 500');
			},
			log: () => undefined,
			readState: async () => ({ membershipStatus: 'active', address: 'member@example.org' }),
		});
		await expect(handler(job())).rejects.toThrow(/HTTP 500/);
	});
});
