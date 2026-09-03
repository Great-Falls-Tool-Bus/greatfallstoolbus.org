/**
 * Convergent discuss-list projection for both activation/email-change
 * (`provision.add_lists`) and offboarding (`offboard.remove_lists`).
 *
 * The payload carries ids only. Before network work, the handler binds the
 * job tenant and membership aggregate, then the database read proves that the
 * payload person actually owns that membership. Active and paused members
 * converge to exactly their current address: every historical address is
 * removed and the current address is subscribed. Every other membership
 * state converges to no address subscribed.
 *
 * External effects cannot share the membership transaction, so one read is
 * not enough. The handler reads a status/address revision, applies its desired
 * state, and reads again. If a concurrent offboard or email change moved the
 * revision, it repeats from current truth; persistent churn throws and lets
 * the outbox retry visibly. A change after the final stable read is still
 * covered because both offboarding and email change enqueue their own
 * reconciliation trigger in the same transaction as the state change.
 *
 * Mailman mutation remains in `great-falls-tool-bus-infra`. This public repo
 * owns only the delivery seam, ids-only state resolution, and convergence
 * algorithm. A configured failure throws; gate-disabled rows are never
 * claimed and remain pending at attempts=0.
 */

import type { Db } from '../../db/client';
import { withTenant } from '../../db/tenant';
import {
	listProjectionState,
	parseListProjectionJob,
	type ListProjectionState,
} from '../../membership/provision';
import type { ClaimedJob, OutboxHandler } from '../schema';

export const ADD_LISTS_JOB_KIND = 'provision.add_lists';
export const REMOVE_LISTS_JOB_KIND = 'offboard.remove_lists';

/** At most this many state snapshots are applied in one leased attempt. */
export const MAX_LIST_RECONCILIATION_PASSES = 3;

export type ListSubscribeDelivery = (address: string) => Promise<void>;
export type ListUnsubscribeDelivery = (address: string) => Promise<void>;

export interface ListReconciliationSeams {
	subscribe: ListSubscribeDelivery;
	unsubscribe: ListUnsubscribeDelivery;
	log?: (line: string) => void;
	/** Test seam: production uses the pool-fenced withTenant read below. */
	db?: Db;
	/** Test seam for barrier-controlled state changes without a fixture DB. */
	readState?: (job: ClaimedJob) => Promise<ListProjectionState>;
	maxPasses?: number;
}

function isEntitled(status: string): boolean {
	return status === 'active' || status === 'paused';
}

export function createListReconciliationHandler(seams: ListReconciliationSeams): OutboxHandler {
	const log = seams.log ?? ((line: string) => console.log(line));
	const maxPasses = seams.maxPasses ?? MAX_LIST_RECONCILIATION_PASSES;
	if (!Number.isInteger(maxPasses) || maxPasses < 1) {
		throw new Error('list reconciliation requires a positive integer maxPasses');
	}

	return async function reconcileLists(job: ClaimedJob): Promise<void> {
		const payload = parseListProjectionJob(job);
		const readState =
			seams.readState ??
			((j: ClaimedJob) => withTenant(j.tenantId, (tx) => listProjectionState(tx, payload), seams.db));

		for (let pass = 1; pass <= maxPasses; pass += 1) {
			const before = await readState(job);
			if (before.membershipStatus === null) {
				throw new Error(`list projection: membership ${payload.membershipId} is not bound to its payload person`);
			}

			if (isEntitled(before.membershipStatus)) {
				if (!before.currentAddress) {
					throw new Error(
						`list projection: person ${payload.personId} has no current address (job ${job.id})`,
					);
				}
				for (const address of before.addresses) {
					if (address !== before.currentAddress) await seams.unsubscribe(address);
				}
				await seams.subscribe(before.currentAddress);
			} else {
				if (before.addresses.length === 0) {
					throw new Error(`list projection: person ${payload.personId} has no address history (job ${job.id})`);
				}
				for (const address of before.addresses) await seams.unsubscribe(address);
			}

			const after = await readState(job);
			if (after.revision === before.revision) return;
			log(
				`[list-projection] membership ${payload.membershipId} changed during pass ${pass}; reconciling current state`,
			);
		}

		throw new Error(
			`list projection: membership ${payload.membershipId} changed during every reconciliation pass (job ${job.id})`,
		);
	};
}
