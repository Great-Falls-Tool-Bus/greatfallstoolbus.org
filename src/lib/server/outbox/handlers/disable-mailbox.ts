/**
 * `offboard.disable_mailbox` (TIN-3440 slice S7; slices §2.3 row 3; spec §4
 * offboarding step 4's mailbox half).
 *
 * Same protected-interface posture as `offboard.remove_lists`: the mailbox
 * resource plane is infra's (Meta `26bc8c696c4170ffb944d0890b40e34751ef5208`,
 * member-provisioning spec §0.1). This repo holds no credential to reach it,
 * so the handler is an injectable seam. Idempotent because "disabling a disabled
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
