/**
 * `offboard.disable_mailbox` (TIN-3440 slice S7; slices §2.3 row 3; spec §4
 * offboarding step 4's mailbox half).
 *
 * Same posture as `remove-lists.ts`, same reasons: the `MailAccount`
 * resource plane is infra's (account-controller reconciles mail RESOURCES —
 * meta spec :65–69), this repo holds no credential to reach it, so the
 * handler is an injectable seam. Idempotent because "disabling a disabled
 * MailAccount is a no-op" (§2.3). A closed gate is represented by an
 * unclaimed pending row in the worker, never by invoking this handler without
 * a delivery and recording success.
 */

import type { ClaimedJob } from '../schema';

/** The injectable seam — infra wires the real MailAccount disable. */
export type MailboxDisableDelivery = (job: ClaimedJob) => Promise<void>;

export interface DisableMailboxSeams {
	delivery: MailboxDisableDelivery;
}

export function createDisableMailboxHandler(seams: DisableMailboxSeams) {
	return async function disableMailboxHandler(job: ClaimedJob): Promise<void> {
		await seams.delivery(job);
	};
}
