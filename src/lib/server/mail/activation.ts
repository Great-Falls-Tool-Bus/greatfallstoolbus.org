/**
 * The activation-order hazard (TIN-4062; PR #208 review E3).
 *
 * THE HAZARD, MEASURED. `application.receipt_email`, `application.
 * decision_email`, and `application.withdrawn_ack` all ship `approved:
 * false` (`./templates.ts` — no operator-ratified copy exists anywhere in
 * meta). If an operator sets `GFTB_MAIL_DELIVERY=enabled` (plus a valid
 * transport DSN and from-address) BEFORE approving even one template,
 * `resolveDelivery` throws `TemplateNotApprovedError` for every mail job of
 * every kind — `outbox/handlers/mail.integration.test.ts` proves exactly
 * this dead-letters, not defers. Enabling delivery first therefore does not
 * merely "keep mail off" (the safe, inert state this module's default is
 * designed around) — it ACTIVELY STRANDS every application receipt,
 * decision notice, and withdrawal acknowledgement in `outbox_job.status =
 * 'dead'`, silently, until an operator notices the dead-letter pile and
 * manually replays it.
 *
 * WHY DEAD-LETTER (LOUD, VISIBLE) RATHER THAN DEFER (SILENT, AUTOMATIC) IS
 * THE SAFER CHOICE — spec §3.1's fail-closed doctrine, applied consistently.
 * `outbox/handlers.ts`'s own docstring states the house rule for exactly
 * this shape of failure: "UNKNOWN KIND IS POISON, NOT A CRASH… it burns its
 * attempts and dead-letters VISIBLY… never dropped and never rolls back."
 * A silent "defer until approved" path would instead let a job sit
 * `pending`/retrying indefinitely with no operator-visible signal that
 * anything is wrong — the same "quietest possible bug" `db/client.ts`'s own
 * docstring warns against elsewhere in this codebase. Every other
 * deterministic-failure case in this outbox (an unregistered kind, a
 * malformed payload) already dead-letters loudly; making template-
 * unapproved the one silent exception would be inconsistent with the
 * pattern this PR otherwise follows throughout, and would trade a visible
 * problem for an invisible one. So the handler behavior is UNCHANGED
 * (dead-letter stands); what this module adds is the missing loudness at
 * the point an operator can still act BEFORE the strand happens: worker
 * startup.
 *
 * `activationHazardWarning` is a pure function of the environment and the
 * shipped template set — `worker.ts`'s `runWorker` calls it once, after the
 * registry has been built successfully, and writes any non-null result to
 * `io.stderr` without failing startup (unlike the half-configured-env case
 * in `./config.ts`, "enabled with an unapproved template" is a valid
 * intermediate operator state — approving templates one at a time while
 * delivery is enabled is a legitimate rollout shape — so this warns, it
 * never exits non-zero).
 */

import { readMailConfig } from './config';
import { DECISION_EMAIL_TEMPLATE, RECEIPT_EMAIL_TEMPLATE, WITHDRAWN_ACK_EMAIL_TEMPLATE } from './templates';

/** The three shipped templates, in enqueue order — exported so the unit suite can pin this list against `templates.ts` directly. */
export const SHIPPED_MAIL_TEMPLATES = [RECEIPT_EMAIL_TEMPLATE, DECISION_EMAIL_TEMPLATE, WITHDRAWN_ACK_EMAIL_TEMPLATE];

/**
 * `null` when there is nothing to warn about (delivery disabled, half-
 * configured — `readMailConfig` itself fails closed on that shape elsewhere
 * — or every shipped template already approved). Otherwise the full warning
 * text, naming every unapproved kind that will dead-letter.
 */
export function activationHazardWarning(env: NodeJS.ProcessEnv = process.env): string | null {
	let config: ReturnType<typeof readMailConfig>;
	try {
		config = readMailConfig(env);
	} catch {
		// Half-configured already fails worker startup closed elsewhere
		// (worker.ts's BLOCK-1 call); not this function's job to repeat it.
		return null;
	}
	if (!config.enabled) return null;

	const unapproved = SHIPPED_MAIL_TEMPLATES.filter((t) => !t.approved).map((t) => t.id);
	if (unapproved.length === 0) return null;

	return (
		`mail delivery is enabled but ${unapproved.length} of ${SHIPPED_MAIL_TEMPLATES.length} template(s) are not yet ` +
		`operator-approved (${unapproved.join(', ')}). Every job of an unapproved kind will dead-letter — refused, ` +
		'not deferred (spec §3.1 fail-closed doctrine) — until its template.approved is flipped to true. ' +
		'ACTIVATION ORDER: approve templates FIRST, enable delivery SECOND. Reversing that order strands receipts ' +
		'silently until an operator notices the dead-letter pile.'
	);
}
