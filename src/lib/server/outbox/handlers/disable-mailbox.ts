/**
 * `offboard.disable_mailbox` (TIN-3440 slice S7; slices §2.3 row 3; spec §4
 * offboarding step 4's mailbox half).
 *
 * Same posture as `remove-lists.ts`, same reasons: the `MailAccount`
 * resource plane is infra's (account-controller reconciles mail RESOURCES —
 * meta spec :65–69), this repo holds no credential to reach it, so the
 * handler is an injectable seam. Idempotent because "disabling a disabled
 * MailAccount is a no-op" (§2.3); "mail automation may be gate-disabled
 * entirely (spec §7), in which case the job completes as a recorded no-op"
 * — §2.3 row 3, verbatim, and the default here.
 */

import type { ClaimedJob } from '../schema';

/** The injectable seam — infra wires the real MailAccount disable. */
export type MailboxDisableDelivery = (job: ClaimedJob) => Promise<void>;

export interface DisableMailboxSeams {
	delivery?: MailboxDisableDelivery;
	log?: (line: string) => void;
}

export function createDisableMailboxHandler(seams: DisableMailboxSeams = {}) {
	const log = seams.log ?? ((line: string) => console.log(line));
	return async function disableMailboxHandler(job: ClaimedJob): Promise<void> {
		if (!seams.delivery) {
			log(`[offboard.disable_mailbox] mail automation gate-disabled; recorded no-op for membership ${job.aggregateId}`);
			return;
		}
		await seams.delivery(job);
	};
}
