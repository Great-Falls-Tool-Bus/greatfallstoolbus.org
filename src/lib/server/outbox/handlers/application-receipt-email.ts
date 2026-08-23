/**
 * `application.receipt_email` — the A2 immediate automated receipt (TIN-4062;
 * TIN-3440 slice S4; slices §2.2 row 2: "immediate automated receipt,
 * carrying a single-use withdrawal token so row 8 is reachable before
 * verification").
 *
 * `intake.ts`'s `submitApplication` enqueues this kind with `{ applicationId
 * }` only and mints no token itself — its own docstring hands that off:
 * "the mail handler mints the verify + withdraw tokens (tokens.ts) at render
 * time in its own unit of work." This is that handler. It mints BOTH the
 * `verify_email` token (A3's bearer credential) and the `withdraw` token (A8's,
 * carried by this same receipt per slices §2.2 row 2) inside the render step,
 * which only runs once per real send — a replay finds the standing journal
 * receipt first and never re-mints (see `./mail-shared.ts`).
 */

import { eq } from 'drizzle-orm';
import { mintToken } from '../../application/tokens';
import { readPublicOrigin } from '../../mail/config';
import { RECEIPT_EMAIL_TEMPLATE, type ReceiptEmailData } from '../../mail/templates';
import { application } from '../../db/schema';
import { createApplicationMailHandler, type MailRenderResult } from './mail-shared';
import type { Db } from '../../db/client';
import type { DbTransaction } from '../../db/client';

export { RECEIPT_EMAIL_JOB_KIND } from '../../application/intake';

async function render(
	tx: DbTransaction,
	applicationId: string,
	env: NodeJS.ProcessEnv,
): Promise<MailRenderResult<ReceiptEmailData>> {
	const rows = await tx.select().from(application).where(eq(application.id, applicationId)).limit(1);
	const row = rows[0];
	if (!row) return 'not_found';

	const origin = readPublicOrigin(env);
	const verify = await mintToken(tx, { applicationId, purpose: 'verify_email' });
	const withdraw = await mintToken(tx, { applicationId, purpose: 'withdraw' });

	return {
		to: row.email,
		data: {
			applicationId,
			verifyUrl: `${origin}/apply/verify?token=${encodeURIComponent(verify.token)}`,
			withdrawUrl: `${origin}/apply/withdraw?token=${encodeURIComponent(withdraw.token)}`,
		},
	};
}

export interface CreateReceiptEmailHandlerOptions {
	env?: NodeJS.ProcessEnv;
	db?: Db;
}

export function createReceiptEmailHandler(options: CreateReceiptEmailHandlerOptions = {}) {
	return createApplicationMailHandler({
		template: RECEIPT_EMAIL_TEMPLATE,
		render,
		env: options.env,
		db: options.db,
	});
}
