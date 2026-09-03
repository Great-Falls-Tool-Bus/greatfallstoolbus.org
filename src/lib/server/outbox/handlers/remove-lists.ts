/**
 * `offboard.remove_lists` (TIN-3440 slice S7; slices §2.3 row 2; spec §4
 * offboarding step 4).
 *
 * THE MAIL PLANE IS NOT THIS REPOSITORY'S (packet 0001 Amendment 1 / AGENTS
 * non-negotiables): Mailman, its credentials, and every list mutation live in
 * `great-falls-tool-bus-infra`; this public repo holds zero secrets and zero
 * cluster endpoints, ever. So the handler is a SEAM: when a delivery function
 * is injected (the infra-owned worker deployment wires one), it unsubscribes
 * — idempotently, because "Mailman unsubscribe of an absent member is a
 * no-op" (§2.3). When automation is gate-disabled the worker leaves this kind
 * unclaimed at `pending`, attempts=0; this handler cannot be constructed
 * without a delivery and therefore cannot record false success.
 *
 * A configured-but-failing delivery throws: retry → dead-letter VISIBLY,
 * membership stays offboarded (spec §11).
 */

import type { ClaimedJob } from '../schema';

/** The injectable delivery seam — infra wires the real Mailman call. */
export type ListRemovalDelivery = (job: ClaimedJob) => Promise<void>;

export interface RemoveListsSeams {
	delivery: ListRemovalDelivery;
}

export function createRemoveListsHandler(seams: RemoveListsSeams) {
	return async function removeListsHandler(job: ClaimedJob): Promise<void> {
		await seams.delivery(job);
	};
}
