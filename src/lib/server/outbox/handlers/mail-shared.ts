/**
 * The shared application-mail handler core (TIN-4062): the S3 handler
 * contract, applied once, that `application-receipt-email.ts`,
 * `application-decision-email.ts`, and `application-withdrawn-ack.ts` each
 * configure with their own template and row-render function.
 *
 * THREE PHASES, ONLY THE MIDDLE ONE TOUCHES A SOCKET (PR #208 review E2 —
 * the send used to run INSIDE the phase-1 transaction; it no longer does).
 *
 *   PHASE 1 — one transaction (`withTenant`), commits BEFORE any I/O:
 *     1. Resolve delivery BEFORE opening the transaction at all — the same
 *        "poison caught before I/O" discipline `stripe-project.ts`'s
 *        `parseEventId` establishes. `DisabledDelivery` by default;
 *        `TemplateNotApprovedError` here (no transaction ever opened) when
 *        delivery is enabled but the template is not operator-approved.
 *     2. Check for an existing `outcome` row FIRST — the consumer-side
 *        idempotency receipt `ClaimedJob`'s own docstring requires. Found →
 *        return immediately: no second render, no second send, no second
 *        journal row.
 *     3. Check for an existing `intent` row with NO matching `outcome`.
 *        Found → this is AMBIGUOUS: a prior attempt recorded "about to try"
 *        and never recorded what happened, which can only mean it crashed
 *        somewhere between committing that intent and committing an
 *        outcome — possibly AFTER a real `send()` returned. Refuse to guess:
 *        throw `AmbiguousDeliveryStateError` (no further transaction
 *        mutation), which is the dispatcher's ordinary retry/dead-letter
 *        path — an operator resolves it, exactly the spec §3.1 fail-closed
 *        doctrine applied to a side effect the queue cannot undo.
 *     4. Otherwise: render (mint whatever token the kind needs — the
 *        `application/tokens.ts` docstring's long-standing promise), write
 *        the `intent` row, COMMIT.
 *
 *   PHASE 2 — `delivery.send(message)`, OUTSIDE any open transaction and
 *     after phase 1's transaction has already committed and closed. A hung
 *     peer (see `../../mail/delivery.ts`'s `readResponse` timeout) therefore
 *     blocks only this one dispatch attempt — never a held PostgreSQL
 *     transaction or the connection/lease behind it.
 *
 *   PHASE 3 — a FRESH transaction: write the `outcome` row and commit. If
 *     this phase fails to commit, the NEXT claim of this job hits phase 1
 *     step 3 above (intent-without-outcome) and dead-letters loudly rather
 *     than re-sending.
 *
 * A missing application/decision row is DETERMINISTIC POISON (spec §3.1),
 * not a soft "skip": application rows are never deleted (migration 0007's
 * `application_no_delete` trigger), so "not found" here can only mean a
 * malformed or stale payload, and the job must retry into dead-letter
 * visibly rather than being silently swallowed.
 */

import type { Db, DbTransaction } from '../../db/client';
import { withTenant } from '../../db/tenant';
import { resolveDelivery, type MailDelivery, type MailMessage } from '../../mail/delivery';
import { findMailJournalPhase, writeMailIntent, writeMailOutcome } from '../../mail/journal';
import type { MailTemplate } from '../../mail/templates';
import type { ClaimedJob, OutboxHandler } from '../schema';

/** A claimed application-mail job whose payload is not the `{ applicationId }` shape every enqueue site writes. */
export class MailHandlerPayloadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MailHandlerPayloadError';
	}
}

/**
 * An `intent` row exists with no matching `outcome` row: the prior attempt
 * may have sent for real before crashing short of recording it. The handler
 * refuses to send again — dead-lettering (after retries) is the correct,
 * visible, operator-resolvable outcome; a silent resend risks a duplicate
 * real message, which the outbox's ordinary at-least-once/idempotent-
 * consumer contract cannot safely paper over for a side effect this
 * repository cannot undo.
 */
export class AmbiguousDeliveryStateError extends Error {
	constructor(kind: string, idempotencyKey: string) {
		super(
			`mail handler: (${kind}, ${idempotencyKey}) has an intent row with no outcome — a prior attempt may have ` +
				'sent for real and crashed before recording it. Refusing to send again; an operator must resolve this ' +
				'manually (confirm with the transport/provider, then journal the outcome by hand) before this job can ' +
				'be replayed safely.',
		);
		this.name = 'AmbiguousDeliveryStateError';
	}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{ applicationId }` only — S3's payload doctrine (`intake.ts`, `decide.ts`): never an address, a reason, or a token. */
export function parseApplicationId(job: ClaimedJob): string {
	const payload = job.payload;
	const applicationId =
		payload && typeof payload === 'object' && 'applicationId' in payload
			? (payload as { applicationId?: unknown }).applicationId
			: undefined;
	if (typeof applicationId !== 'string' || !UUID_RE.test(applicationId)) {
		throw new MailHandlerPayloadError(
			`mail handler: job ${job.id} (kind ${job.kind}) carries a malformed payload (expected { applicationId: uuid })`,
		);
	}
	return applicationId;
}

/** What a kind-specific `render` function produces, or the poison sentinel for "the aggregate is gone." */
export type MailRenderResult<TData> = { to: string; data: TData } | 'not_found';

export interface MailHandlerDeps<TData> {
	template: MailTemplate<TData>;
	render: (tx: DbTransaction, applicationId: string, env: NodeJS.ProcessEnv) => Promise<MailRenderResult<TData>>;
	/** Test seams — production omits both; see the pool-fence note in `stripe-project.ts`. */
	env?: NodeJS.ProcessEnv;
	db?: Db;
	/** Test seam: replaces `resolveDelivery`, e.g. to spy on transport construction without a real env change. */
	deliveryFactory?: (template: MailTemplate<TData>, env: NodeJS.ProcessEnv) => MailDelivery;
}

type Phase1Result<TData> = { done: true } | { done: false; to: string; data: TData };

/**
 * Build the shared `OutboxHandler` for one application-mail kind. The
 * returned function is what `worker.ts`'s registry and every handler test in
 * this module register — the kind identity itself lives in the caller's
 * `EnqueueInput`/registry key, not here.
 */
export function createApplicationMailHandler<TData>(deps: MailHandlerDeps<TData>): OutboxHandler {
	const env = deps.env ?? process.env;
	const deliveryFactory = deps.deliveryFactory ?? resolveDelivery;

	return async function applicationMailHandler(job: ClaimedJob): Promise<void> {
		const applicationId = parseApplicationId(job);

		// Resolve delivery BEFORE any I/O. May throw TemplateNotApprovedError;
		// that throw propagates straight out of this handler (no transaction
		// was ever opened), which is the dispatcher's ordinary retry/dead-letter
		// path.
		const delivery = deliveryFactory(deps.template, env);

		// PHASE 1 — one transaction, commits before any network I/O.
		const phase1 = await withTenant<Phase1Result<TData>>(
			job.tenantId,
			async (tx) => {
				const outcome = await findMailJournalPhase(tx, job.kind, job.idempotencyKey, 'outcome');
				if (outcome) return { done: true };

				const intent = await findMailJournalPhase(tx, job.kind, job.idempotencyKey, 'intent');
				if (intent) {
					throw new AmbiguousDeliveryStateError(job.kind, job.idempotencyKey);
				}

				const rendered = await deps.render(tx, applicationId, env);
				if (rendered === 'not_found') {
					throw new MailHandlerPayloadError(
						`mail handler: job ${job.id} (kind ${job.kind}) names application ${applicationId}, which does not exist`,
					);
				}

				await writeMailIntent(tx, {
					outboxJobId: job.id,
					kind: job.kind,
					idempotencyKey: job.idempotencyKey,
					templateId: deps.template.id,
					templateApproved: deps.template.approved,
				});

				return { done: false, to: rendered.to, data: rendered.data };
			},
			deps.db,
		);

		if (phase1.done) return;

		const message: MailMessage = {
			to: phase1.to,
			subject: deps.template.subject(phase1.data),
			text: deps.template.text(phase1.data),
		};

		// PHASE 2 — the network call. No transaction is open here.
		const outcome = await delivery.send(message);

		// PHASE 3 — a FRESH transaction, after send() has already returned.
		await withTenant(
			job.tenantId,
			(tx) =>
				writeMailOutcome(tx, {
					outboxJobId: job.id,
					kind: job.kind,
					idempotencyKey: job.idempotencyKey,
					templateId: deps.template.id,
					templateApproved: deps.template.approved,
					mode: outcome.mode,
					detail: outcome.detail,
				}),
			deps.db,
		);
	};
}
