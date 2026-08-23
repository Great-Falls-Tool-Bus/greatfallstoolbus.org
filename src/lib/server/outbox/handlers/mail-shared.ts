/**
 * The shared application-mail handler core (TIN-4062): the S3 handler
 * contract, applied once, that `application-receipt-email.ts`,
 * `application-decision-email.ts`, and `application-withdrawn-ack.ts` each
 * configure with their own template and row-render function.
 *
 * THE PIPELINE, IN ORDER, MIRRORS TWO EXISTING PRECEDENTS AT ONCE.
 *   1. Resolve delivery BEFORE opening a transaction or touching the
 *      database — the same "poison caught before I/O" discipline
 *      `stripe-project.ts`'s `parseEventId` establishes. When
 *      `GFTB_MAIL_DELIVERY` is not exactly `"enabled"` this returns
 *      `DisabledDelivery` and nothing more happens here; when it IS enabled
 *      but the template is not operator-approved, `resolveDelivery` throws
 *      `TemplateNotApprovedError` here, before any token is minted or any
 *      journal row written — the dispatcher's ordinary handler-failure path
 *      then retries and eventually dead-letters the job (spec §3.1), and NO
 *      transport was ever constructed for the attempt.
 *   2. Inside `withTenant`, check `findMailJournalReceipt` FIRST — the
 *      consumer-side idempotency receipt `ClaimedJob`'s own docstring
 *      requires ("a receipt keyed on (kind, idempotency_key) before the
 *      effect"). A replay that already has a receipt no-ops immediately:
 *      no second token mint, no second send attempt, no second journal row.
 *   3. Only then does `render` run — reading the application (and, for
 *      decisions, the decision) row and minting whatever bearer token the
 *      kind requires, exactly as `application/tokens.ts`'s docstring always
 *      promised: "the MAIL HANDLER mints the verify/withdraw tokens at
 *      render time."
 *   4. `delivery.send` — `DisabledDelivery` by default: no network I/O,
 *      returns a generic disabled outcome. `SmtpDelivery`, when reachable,
 *      actually transmits.
 *   5. `writeMailJournal` — the durable record and the idempotency receipt
 *      for the NEXT replay, committed in the SAME transaction as the render
 *      and the send.
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
import { findMailJournalReceipt, writeMailJournal } from '../../mail/journal';
import type { MailTemplate } from '../../mail/templates';
import type { ClaimedJob, OutboxHandler } from '../schema';

/** A claimed application-mail job whose payload is not the `{ applicationId }` shape every enqueue site writes. */
export class MailHandlerPayloadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MailHandlerPayloadError';
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

		// Step 1 — resolve delivery BEFORE any I/O. May throw
		// TemplateNotApprovedError; that throw propagates straight out of this
		// handler (no transaction was ever opened), which is the dispatcher's
		// ordinary retry/dead-letter path.
		const delivery = deliveryFactory(deps.template, env);

		await withTenant(
			job.tenantId,
			async (tx) => {
				// Step 2 — the idempotency receipt, checked before any effect.
				const existing = await findMailJournalReceipt(tx, job.kind, job.idempotencyKey);
				if (existing) return;

				// Step 3 — render (reads the aggregate, mints whatever token the kind needs).
				const rendered = await deps.render(tx, applicationId, env);
				if (rendered === 'not_found') {
					throw new MailHandlerPayloadError(
						`mail handler: job ${job.id} (kind ${job.kind}) names application ${applicationId}, which does not exist`,
					);
				}

				const message: MailMessage = {
					to: rendered.to,
					subject: deps.template.subject(rendered.data),
					text: deps.template.text(rendered.data),
				};

				// Step 4 — DisabledDelivery by default; SmtpDelivery only when reachable.
				const outcome = await delivery.send(message);

				// Step 5 — the durable record, same transaction as the render + send.
				await writeMailJournal(tx, {
					outboxJobId: job.id,
					kind: job.kind,
					idempotencyKey: job.idempotencyKey,
					templateId: deps.template.id,
					templateApproved: deps.template.approved,
					mode: outcome.mode,
					detail: outcome.detail,
				});
			},
			deps.db,
		);
	};
}
