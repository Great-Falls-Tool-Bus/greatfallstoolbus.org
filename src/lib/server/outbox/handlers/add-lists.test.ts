/**
 * Discuss-list desired-state reconciler (TIN-3964): ids-only carrier and
 * aggregate binding, Active/paused projection, terminal removal, and the
 * external-effect races that one preflight state read cannot close.
 */

import { describe, expect, it } from 'vitest';
import { ListJobPayloadError, ProvisionJobPayloadError, type ListProjectionState } from '../../membership/provision';
import type { ClaimedJob } from '../schema';
import {
	ADD_LISTS_JOB_KIND,
	createListReconciliationHandler,
	REMOVE_LISTS_JOB_KIND,
} from './add-lists';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const MEMBERSHIP_ID = '22222222-3333-4444-8555-666666666666';
const PERSON_ID = '33333333-4444-4555-8666-777777777777';

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
	return {
		id: 'job-1',
		tenantId: TENANT_ID,
		kind: ADD_LISTS_JOB_KIND,
		aggregateType: 'membership',
		aggregateId: MEMBERSHIP_ID,
		payload: {
			schemaVersion: 1,
			tenantId: TENANT_ID,
			membershipId: MEMBERSHIP_ID,
			personId: PERSON_ID,
			generation: 1,
		},
		idempotencyKey: `${TENANT_ID}:membership:${MEMBERSHIP_ID}:add_lists:g1`,
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

function removalJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
	return job({
		kind: REMOVE_LISTS_JOB_KIND,
		payload: { membershipId: MEMBERSHIP_ID, personId: PERSON_ID },
		idempotencyKey: `${TENANT_ID}:membership:${MEMBERSHIP_ID}:remove_lists`,
		...overrides,
	});
}

function state(
	membershipStatus: string | null,
	revision: string,
	currentAddress: string | null,
	addresses: string[],
	desiredSubscribedAddresses: string[] =
		(membershipStatus === 'active' || membershipStatus === 'paused') && currentAddress ? [currentAddress] : [],
): ListProjectionState {
	return { membershipStatus, revision, currentAddress, addresses, desiredSubscribedAddresses };
}

function stateReader(states: ListProjectionState[]): () => Promise<ListProjectionState> {
	let index = 0;
	return async () => states[Math.min(index++, states.length - 1)];
}

function memoryDeliveries(initial: string[] = []) {
	const subscribed = new Set(initial);
	const calls: string[] = [];
	return {
		subscribed,
		calls,
		subscribe: async (address: string) => {
			calls.push(`add:${address}`);
			subscribed.add(address);
		},
		unsubscribe: async (address: string) => {
			calls.push(`remove:${address}`);
			subscribed.delete(address);
		},
	};
}

describe('list projection carrier binding', () => {
	it.each([
		[undefined, 'undefined payload'],
		[null, 'null payload'],
		[{}, 'empty payload'],
		[{ membershipId: MEMBERSHIP_ID }, 'legacy unversioned carrier'],
		[
			{
				schemaVersion: 1,
				tenantId: TENANT_ID,
				membershipId: 'not-a-uuid',
				personId: PERSON_ID,
				generation: 1,
			},
			'non-UUID membershipId',
		],
	] as const)('rejects a poisoned activation job (%s) before state or delivery work', async (payload) => {
		const deliveries = memoryDeliveries();
		let reads = 0;
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: async () => {
				reads += 1;
				return state('active', 'v1', 'member@example.org', ['member@example.org']);
			},
		});
		await expect(handler(job({ payload }))).rejects.toThrow(ProvisionJobPayloadError);
		expect(reads).toBe(0);
		expect(deliveries.calls).toEqual([]);
	});

	it('rejects a mismatched aggregate id before state or delivery work', async () => {
		const deliveries = memoryDeliveries();
		let reads = 0;
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: async () => {
				reads += 1;
				return state('active', 'v1', 'member@example.org', ['member@example.org']);
			},
		});
		await expect(
			handler(job({ aggregateId: '44444444-5555-4666-8777-888888888888' })),
		).rejects.toThrow(ListJobPayloadError);
		expect(reads).toBe(0);
		expect(deliveries.calls).toEqual([]);
	});

	it('a same-tenant cross-person carrier fails visibly with zero network calls', async () => {
		const deliveries = memoryDeliveries();
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: async () => state(null, 'missing', null, []),
		});
		await expect(handler(job())).rejects.toThrow(/not bound/u);
		expect(deliveries.calls).toEqual([]);
	});
});

describe('list projection desired-state convergence', () => {
	it.each(['active', 'paused'])('ensures only the current address for an entitled %s membership', async (status) => {
		const deliveries = memoryDeliveries(['old@example.org']);
		const current = state(status, 'v2', 'new@example.org', ['old@example.org', 'new@example.org']);
		const handler = createListReconciliationHandler({ ...deliveries, readState: stateReader([current, current]) });
		await handler(job());
		expect(deliveries.calls).toEqual(['remove:old@example.org', 'add:new@example.org']);
		expect([...deliveries.subscribed]).toEqual(['new@example.org']);
	});

	it.each(['left', 'removed'])(
		'ensures every unowned historical address is absent for a terminal %s membership',
		async (status) => {
			const deliveries = memoryDeliveries(['old@example.org', 'new@example.org']);
			const terminal = state(status, 'v3', null, ['old@example.org', 'new@example.org']);
			const handler = createListReconciliationHandler({
				...deliveries,
				readState: stateReader([terminal, terminal]),
			});
			await handler(removalJob());
			expect(deliveries.calls).toEqual(['remove:old@example.org', 'remove:new@example.org']);
			expect([...deliveries.subscribed]).toEqual([]);
		},
	);

	it('an old removal job preserves the current address after a later valid membership', async () => {
		const deliveries = memoryDeliveries(['new@example.org']);
		const restored = state('active', 'old-removed:new-active', 'new@example.org', [
			'old@example.org',
			'new@example.org',
		]);
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: stateReader([restored, restored]),
		});
		await handler(removalJob());
		expect(deliveries.calls).toEqual(['remove:old@example.org', 'add:new@example.org']);
		expect([...deliveries.subscribed]).toEqual(['new@example.org']);
	});

	it("an old terminal person's job preserves an address now owed to another Active person", async () => {
		const deliveries = memoryDeliveries(['shared@example.org']);
		const terminalWithEntitledOwner = state(
			'left',
			'person-1-left:person-2-active',
			'shared@example.org',
			['shared@example.org'],
			['shared@example.org'],
		);
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: stateReader([terminalWithEntitledOwner, terminalWithEntitledOwner]),
		});
		await handler(removalJob());
		expect(deliveries.calls).toEqual(['add:shared@example.org']);
		expect([...deliveries.subscribed]).toEqual(['shared@example.org']);
	});

	it("an Active person's email reconciliation preserves a historical address now current for another member", async () => {
		const deliveries = memoryDeliveries(['shared@example.org']);
		const bothEntitled = state(
			'active',
			'person-1-new:person-2-shared',
			'new@example.org',
			['shared@example.org', 'new@example.org'],
			['shared@example.org', 'new@example.org'],
		);
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: stateReader([bothEntitled, bothEntitled]),
		});
		await handler(job());
		expect(deliveries.calls).toEqual(['add:shared@example.org', 'add:new@example.org']);
		expect([...deliveries.subscribed].sort()).toEqual(['new@example.org', 'shared@example.org']);
	});

	it('repairs its stale unsubscribe when another person becomes entitled before the second snapshot', async () => {
		const deliveries = memoryDeliveries(['shared@example.org']);
		const unprotected = state('left', 'person-1-left:no-owner', 'shared@example.org', ['shared@example.org']);
		const protectedByAnother = state(
			'left',
			'person-1-left:person-2-active',
			'shared@example.org',
			['shared@example.org'],
			['shared@example.org'],
		);
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: stateReader([unprotected, protectedByAnother, protectedByAnother, protectedByAnother]),
			log: () => undefined,
		});
		await handler(removalJob());
		expect(deliveries.calls).toEqual(['remove:shared@example.org', 'add:shared@example.org']);
		expect([...deliveries.subscribed]).toEqual(['shared@example.org']);
	});

	it('repairs its stale subscribe when the last entitled owner offboards before the second snapshot', async () => {
		const deliveries = memoryDeliveries();
		const protectedByAnother = state(
			'left',
			'person-1-left:person-2-active',
			'shared@example.org',
			['shared@example.org'],
			['shared@example.org'],
		);
		const unprotected = state('left', 'person-1-left:person-2-left', 'shared@example.org', ['shared@example.org']);
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: stateReader([protectedByAnother, unprotected, unprotected, unprotected]),
			log: () => undefined,
		});
		await handler(removalJob());
		expect(deliveries.calls).toEqual(['add:shared@example.org', 'remove:shared@example.org']);
		expect([...deliveries.subscribed]).toEqual([]);
	});

	it('closes the late-add/offboard interleaving with final state absent', async () => {
		const deliveries = memoryDeliveries();
		const active = state('active', 'v1', 'member@example.org', ['member@example.org']);
		const left = state('left', 'v2', null, ['member@example.org']);
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: stateReader([active, left, left, left]),
			log: () => undefined,
		});
		await handler(job());
		expect(deliveries.calls).toEqual(['add:member@example.org', 'remove:member@example.org']);
		expect([...deliveries.subscribed]).toEqual([]);
	});

	it('converges an email change after completed activation, and replay is idempotent', async () => {
		const deliveries = memoryDeliveries(['old@example.org']);
		const old = state('active', 'v1:old', 'old@example.org', ['old@example.org']);
		const changed = state('active', 'v1:new', 'new@example.org', ['old@example.org', 'new@example.org']);
		const handler = createListReconciliationHandler({
			...deliveries,
			readState: stateReader([old, changed, changed, changed, changed, changed]),
			log: () => undefined,
		});
		await handler(job());
		expect([...deliveries.subscribed]).toEqual(['new@example.org']);
		await handler(job({ id: 'job-replay' }));
		expect([...deliveries.subscribed]).toEqual(['new@example.org']);
		expect(deliveries.calls).toEqual([
			'add:old@example.org',
			'remove:old@example.org',
			'add:new@example.org',
			'remove:old@example.org',
			'add:new@example.org',
		]);
	});

	it('throws on persistent state churn so the dispatcher retries visibly', async () => {
		const deliveries = memoryDeliveries();
		let revision = 0;
		const handler = createListReconciliationHandler({
			...deliveries,
			maxPasses: 2,
			readState: async () => state('active', `v${revision++}`, 'member@example.org', ['member@example.org']),
			log: () => undefined,
		});
		await expect(handler(job())).rejects.toThrow(/every reconciliation pass/u);
	});

	it('propagates a configured delivery failure to retry/dead-letter', async () => {
		const current = state('active', 'v1', 'member@example.org', ['member@example.org']);
		const handler = createListReconciliationHandler({
			subscribe: async () => {
				throw new Error('mailman subscribe for discuss.latoolb.us returned HTTP 500');
			},
			unsubscribe: async () => undefined,
			readState: stateReader([current]),
		});
		await expect(handler(job())).rejects.toThrow(/HTTP 500/u);
	});
});
