/**
 * `application.decision_email` — the A6/A7 decision receipt (TIN-4062;
 * TIN-3440 slice S5/S6; slices §2.2 rows 6-7).
 *
 * `decide.ts`'s `commitDecision` (shared by `approveApplication` and
 * `declineApplication`) enqueues this kind with `{ applicationId }` only.
 * On `approved`, this handler mints the M1 `activate` bearer token —
 * `application/tokens.ts`'s own docstring: "the M1 activation bearer
 * credential is a purpose = 'activate' row … minted at decision-email
 * render time" — and `src/routes/(member)/assent/+page.server.ts` already
 * documents the shape it expects: "The decision email's activation link is a
 * GET carrying `?token=…`." On `declined`, no token is minted; the mail
 * carries the decision only, never the keyholder's `reasonClass` (spec §4:
 * decision records carry "decision and operational notes only" — that
 * boundary is member-facing copy, not this handler's to relax by embedding
 * it in an email body).
 *
 * A `decision_email` job naming an application with no decision row is
 * poison (`commitDecision` always writes the decision row and the outbox job
 * in the SAME transaction — spec §3.1's rollback guarantee — so this can only
 * be a stale or malformed payload) and is treated exactly like a missing
 * application row: `render` returns `'not_found'`, and `mail-shared.ts`
 * throws into the ordinary retry/dead-letter path.
 */

import { eq } from 'drizzle-orm';
import { mintToken } from '../../application/tokens';
import type { MailDelivery } from '../../mail/delivery';
import { readPublicOrigin } from '../../mail/config';
import { DECISION_EMAIL_TEMPLATE, type DecisionEmailData, type MailTemplate } from '../../mail/templates';
import { application, applicationDecision } from '../../db/schema';
import { createApplicationMailHandler, type MailRenderResult } from './mail-shared';
import type { Db, DbTransaction } from '../../db/client';

export { DECISION_EMAIL_JOB_KIND } from '../../application/decide';

async function render(
	tx: DbTransaction,
	applicationId: string,
	env: NodeJS.ProcessEnv,
): Promise<MailRenderResult<DecisionEmailData>> {
	const appRows = await tx.select().from(application).where(eq(application.id, applicationId)).limit(1);
	const appRow = appRows[0];
	if (!appRow) return 'not_found';

	const decisionRows = await tx
		.select()
		.from(applicationDecision)
		.where(eq(applicationDecision.applicationId, applicationId))
		.limit(1);
	const decisionRow = decisionRows[0];
	if (!decisionRow || (decisionRow.decision !== 'approved' && decisionRow.decision !== 'declined')) {
		return 'not_found';
	}
	// `decision` is a plain `text` column (checked at the database, migration
	// 0008's `application_decision_kind` CHECK — not narrowed by drizzle's
	// inferred type), so the cast is safe exactly BECAUSE of the guard above.
	const decision = decisionRow.decision as 'approved' | 'declined';

	let activateUrl: string | undefined;
	if (decision === 'approved') {
		const origin = readPublicOrigin(env);
		const activate = await mintToken(tx, { applicationId, purpose: 'activate' });
		activateUrl = `${origin}/assent?token=${encodeURIComponent(activate.token)}`;
	}

	return { to: appRow.email, data: { applicationId, decision, activateUrl } };
}

export interface CreateDecisionEmailHandlerOptions {
	env?: NodeJS.ProcessEnv;
	db?: Db;
	/** Test seam: forwarded verbatim to `createApplicationMailHandler` — see its own docstring. */
	deliveryFactory?: (template: MailTemplate<DecisionEmailData>, env: NodeJS.ProcessEnv) => MailDelivery;
}

export function createDecisionEmailHandler(options: CreateDecisionEmailHandlerOptions = {}) {
	return createApplicationMailHandler({
		template: DECISION_EMAIL_TEMPLATE,
		render,
		env: options.env,
		db: options.db,
		deliveryFactory: options.deliveryFactory,
	});
}
