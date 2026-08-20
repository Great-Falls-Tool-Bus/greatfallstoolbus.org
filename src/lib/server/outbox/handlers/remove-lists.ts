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
 * no-op" (§2.3); when mail automation is GATE-DISABLED — the default, and
 * the truthful state of this deployment — the job completes as a RECORDED
 * no-op (§2.3 row 3's rule applied to lists): completion is the record, the
 * job row's `done` status is durable, and nothing is ever faked as
 * "unsubscribed" when no unsubscribe happened (spec §7 "never faked
 * manually" governs projection STATE, which this handler does not invent).
 *
 * A configured-but-failing delivery throws: retry → dead-letter VISIBLY,
 * membership stays offboarded (spec §11).
 */

import type { ClaimedJob } from '../schema';

/** The injectable delivery seam — infra wires the real Mailman call. */
export type ListRemovalDelivery = (job: ClaimedJob) => Promise<void>;

export interface RemoveListsSeams {
	delivery?: ListRemovalDelivery;
	log?: (line: string) => void;
}

export function createRemoveListsHandler(seams: RemoveListsSeams = {}) {
	const log = seams.log ?? ((line: string) => console.log(line));
	return async function removeListsHandler(job: ClaimedJob): Promise<void> {
		if (!seams.delivery) {
			// Gate-disabled mail automation: complete as a recorded no-op. The
			// line carries ids only — never an address (S3 payload doctrine
			// applies to logs the same way).
			log(`[offboard.remove_lists] mail automation gate-disabled; recorded no-op for membership ${job.aggregateId}`);
			return;
		}
		await seams.delivery(job);
	};
}
