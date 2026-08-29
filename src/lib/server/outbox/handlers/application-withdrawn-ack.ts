/**
 * `application.withdrawn_ack` — the A8 withdrawal acknowledgement (TIN-4062;
 * TIN-3440 slice S5; slices §2.2 row 8).
 *
 * `decide.ts`'s `withdrawApplication` enqueues this kind with `{
 * applicationId }` only, after the application has already reached
 * `withdrawn` in the SAME transaction. No token is minted here — withdrawal
 * is already complete by the time this job runs; the mail is confirmation,
 * not a bearer credential carrier. The applicant's own withdrawal token was
 * already single-use-consumed by `consumeToken` in `withdrawApplication`
 * before this job was ever enqueued.
 */

import { eq } from 'drizzle-orm';
import type { MailDelivery } from '../../mail/delivery';
import { WITHDRAWN_ACK_EMAIL_TEMPLATE, type WithdrawnAckEmailData, type MailTemplate } from '../../mail/templates';
import { application } from '../../db/schema';
import { createApplicationMailHandler, type MailRenderResult } from './mail-shared';
import type { Db, DbTransaction } from '../../db/client';

export { WITHDRAWN_ACK_JOB_KIND } from '../../application/decide';

async function render(tx: DbTransaction, applicationId: string): Promise<MailRenderResult<WithdrawnAckEmailData>> {
	const rows = await tx.select().from(application).where(eq(application.id, applicationId)).limit(1);
	const row = rows[0];
	if (!row) return 'not_found';
	return { to: row.email, data: { applicationId } };
}

export interface CreateWithdrawnAckHandlerOptions {
	env?: NodeJS.ProcessEnv;
	db?: Db;
	/** Test seam: forwarded verbatim to `createApplicationMailHandler` — see its own docstring. */
	deliveryFactory?: (template: MailTemplate<WithdrawnAckEmailData>, env: NodeJS.ProcessEnv) => MailDelivery;
}

export function createWithdrawnAckHandler(options: CreateWithdrawnAckHandlerOptions = {}) {
	return createApplicationMailHandler({
		template: WITHDRAWN_ACK_EMAIL_TEMPLATE,
		render,
		env: options.env,
		db: options.db,
		deliveryFactory: options.deliveryFactory,
	});
}
