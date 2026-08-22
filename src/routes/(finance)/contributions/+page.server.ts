/**
 * `/contributions` — the finance-role read surface (TIN-3818 slice S10;
 * spec §5 "Only the finance role can read amount, rail, processor/customer
 * identifiers, cash notes, or failure detail").
 *
 * NOT PRERENDERED, the S4/S5/S7 split: request-time state, served live by the
 * ADAPTER=node origin, absent from the default adapter-static build.
 *
 * WHO SEES IT: a live session holding a live `finance` grant. The GRANT check
 * runs inside the same `withTenant` unit of work as the query it authorizes
 * (spec §6, `requireFinance`) — never against the session alone, so a
 * revocation committed mid-request is refused.
 *
 * THIS ROUTE HAS NO `actions` EXPORT. Read-only is structural, not a
 * convention to remember: there is no POST handler on this page at all, so
 * there is no charge, refund, receipt-entry, or reversal reachable from it.
 * Recording a cash/check receipt stays `contribution/receipt.ts`'s surface,
 * exposed (if ever) by a distinct finance-WRITE route outside this slice.
 *
 * REFUSAL SHAPE DIFFERS FROM THE KEYHOLDER QUEUE ON PURPOSE. `/review`'s load
 * reads a failed grant check as a soft, 200 "unauthorized" empty queue,
 * because an empty queue is a safe thing to show anyone and the explicit 403
 * lives on its actions. This route has no actions to carry that 403 — its
 * entire content IS the sensitive data — so the load itself throws a real
 * HTTP error: 401 with no session at all, 403 for an authenticated session
 * without the `finance` grant (member and keyholder sessions alike).
 *
 * WHAT IT SHOWS: every contribution offer in the tenant — amount, rail,
 * cadence, lifecycle state, the append-only cash/check receipt trail
 * (rails not collapsed), and the reversal-aware net — plus the frozen
 * `LIVE_STRIPE_GATE` fact (Stripe test-mode status; TIN-3818's seven-row live
 * gate, CLOSED). Copy is recipient-neutral throughout; no field here says
 * more than the schema itself already holds for this role.
 */

import { error as httpError, type RequestEvent } from '@sveltejs/kit';
import { AuthError } from '$lib/server/auth';
import { withTenant } from '$lib/server/db/tenant';
import { listFinanceContributions, type FinanceContributionRow } from '$lib/server/contribution/finance-read';
import { LIVE_STRIPE_GATE } from '$lib/server/stripe/gate';
import type { PageServerLoad } from './$types';
import { resolveFinanceActor } from './actor';

export const prerender = false;

export interface FinanceSeams {
	env?: NodeJS.ProcessEnv;
}

/** Serialisable listing row for the page — dates flattened, cents left as integers (no float money, ever). */
function serializeRow(row: FinanceContributionRow) {
	const agreement = row.view.agreement;
	return {
		personId: row.personId,
		displayName: row.displayName,
		state: agreement?.state ?? 'none',
		rail: agreement?.rail ?? null,
		cadence: agreement?.cadence ?? null,
		amountCents: agreement?.amountCents ?? null,
		helpRequested: agreement?.helpRequested ?? false,
		offeredAt: agreement?.offeredAt?.toISOString() ?? null,
		netReceiptsCents: row.netReceiptsCents,
		receipts: row.view.receipts.map((r) => ({
			id: r.id,
			rail: r.rail,
			amountCents: r.amountCents,
			receivedOn: r.receivedOn,
			cadence: r.cadence,
			note: r.note,
			checkRefLast4: r.checkRefLast4,
			reversesId: r.reversesId,
			createdAt: r.createdAt.toISOString(),
		})),
	};
}

export function _createFinanceLoad(seams: FinanceSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, rows: [], liveGate: LIVE_STRIPE_GATE };
		}

		const actor = resolveFinanceActor(event);
		if (!actor) {
			throw httpError(401, 'This page requires a signed-in finance session.');
		}

		try {
			const rows = await withTenant(tenantId, (tx) => listFinanceContributions(tx, actor.personId));
			return {
				available: true as const,
				rows: rows.map(serializeRow),
				liveGate: LIVE_STRIPE_GATE,
			};
		} catch (err) {
			if (err instanceof AuthError) {
				throw httpError(err.status, err.message);
			}
			console.error('[finance/contributions] load failed:', err instanceof Error ? err.message : err);
			throw httpError(500, 'Finance read failed.');
		}
	};
}

export const load: PageServerLoad = _createFinanceLoad();
