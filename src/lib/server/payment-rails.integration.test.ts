/**
 * Payment rails against real PostgreSQL 16.15 (TIN-3818).
 *
 * Same harness discipline as `db/rls.integration.test.ts`: everything runs as
 * the DML-only runtime role over the S1 fixture, with S1's migrations AND
 * policies applied — a green suite on a policy-free database would prove
 * nothing. Stripe never gets a socket here: the webhook path is exercised by
 * signing the COMMITTED fixture bytes with an ephemeral secret minted per
 * run, and the projector consults the fixture replay gateway.
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chooseContribution, getAgreement } from './contribution/agreement';
import {
	IdempotencyConflictError,
	ReceiptValidationError,
	recordCashCheckReceipt,
	reverseReceipt,
} from './contribution/receipt';
import { createDb, type Db } from './db/client';
import {
	MIGRATIONS_DIR,
	asTenant,
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from './db/integration-support';
import { runMigrator } from './db/migrate';
import { withTenant } from './db/tenant';
import { createContributionCheckout } from './stripe/checkout';
import type { StripeWebhookSecret } from './stripe/config';
import { FIXTURE, createReplayGateway, readFixtureEventRaw, signPayloadForTest } from './stripe/fixtures';
import { STRIPE_PROJECT_JOB_KIND, ingestStripeEvent } from './stripe/inbox';
import { projectStripeEvent } from './stripe/project';
import { handleStripeWebhook } from './stripe/webhook';

let fixture: PgFixture;
let tenantA: string;
let tenantB: string;
let runtimePool: pg.Pool;
let runtimeDb: Db;

/** Ephemeral per-run signing secret — never a committed value. */
const WHSEC = ('whsec_' + randomUUID().replace(/-/g, '')) as StripeWebhookSecret;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

const financeActor = randomUUID();

/** Post one fixture file through the real handler into the real inbox. */
async function deliver(filename: string, options: { tenantId?: string; mutate?: (raw: string) => string } = {}) {
	const tenantId = options.tenantId ?? tenantA;
	const raw = options.mutate ? options.mutate(readFixtureEventRaw(filename)) : readFixtureEventRaw(filename);
	return handleStripeWebhook(
		{ rawBody: raw, signatureHeader: signPayloadForTest(raw, WHSEC) },
		{
			webhookSecret: WHSEC,
			tenantId,
			persist: (event) => withTenant(tenantId, (tx) => ingestStripeEvent(tx, { tenantId, event }), runtimeDb),
		},
	);
}

async function project(eventId: string, subscriptionStatus?: string) {
	const gateway = createReplayGateway({ subscriptionStatus });
	const outcome = await withTenant(
		tenantA,
		(tx) => projectStripeEvent(tx, { tenantId: tenantA, eventId, gateway }),
		runtimeDb,
	);
	return { outcome, gateway };
}

async function agreementState(personId: string): Promise<string | undefined> {
	const agreement = await withTenant(tenantA, (tx) => getAgreement(tx, personId), runtimeDb);
	return agreement?.state;
}

beforeAll(async () => {
	fixture = await startPostgres();
	const migrated = await runMigrator({
		args: ['--dsn', fixture.migratorDsn],
		env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
		io: silent,
	});
	if (migrated.code !== 0) throw new Error(`fixture migration failed with code ${migrated.code}`);
	await credentialRuntimeRole(fixture);

	tenantA = await seedTenant(fixture.migratorDsn, 'rails-a');
	tenantB = await seedTenant(fixture.migratorDsn, 'rails-b');

	runtimePool = new pg.Pool({ connectionString: fixture.runtimeDsn });
	runtimeDb = createDb(runtimePool);
}, 240_000);

afterAll(async () => {
	await runtimePool?.end();
	await fixture?.stop();
});

describe('cash and check are first-class rails', () => {
	const personId = randomUUID();

	it('records an operator receipt and advances the agreement to cash_recorded', async () => {
		await withTenant(
			tenantA,
			(tx) => chooseContribution(tx, { tenantId: tenantA, personId, choice: { kind: 'cash' } }),
			runtimeDb,
		);
		expect(await agreementState(personId)).toBe('cash_pending');

		const result = await withTenant(
			tenantA,
			(tx) =>
				recordCashCheckReceipt(tx, {
					tenantId: tenantA,
					personId,
					rail: 'cash',
					amountCents: 2000,
					receivedOn: '2026-08-20',
					cadence: 'monthly',
					recordedBy: financeActor,
					idempotencyKey: 'receipt-1',
				}),
			runtimeDb,
		);
		expect(result.deduplicated).toBe(false);
		expect(result.receipt.amountCents).toBe(2000);
		expect(await agreementState(personId)).toBe('cash_recorded');
	});

	it('returns the ORIGINAL receipt for a duplicate Idempotency-Key — one row, not two', async () => {
		const duplicate = await withTenant(
			tenantA,
			(tx) =>
				recordCashCheckReceipt(tx, {
					tenantId: tenantA,
					personId,
					rail: 'cash',
					amountCents: 2000,
					receivedOn: '2026-08-20',
					cadence: 'monthly',
					recordedBy: financeActor,
					idempotencyKey: 'receipt-1',
				}),
			runtimeDb,
		);
		expect(duplicate.deduplicated).toBe(true);

		const count = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query(`select count(*)::int as n from finance_receipt where person_id = $1`, [
				personId,
			]);
			return rows[0].n as number;
		});
		expect(count).toBe(1);
	});

	it('corrects by APPENDING a reversal and leaves the original row byte-identical', async () => {
		const [original] = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ id: string; digest: string }>(
				`select id, md5(finance_receipt::text) as digest from finance_receipt where person_id = $1 and reverses_id is null`,
				[personId],
			);
			return rows;
		});

		const reversal = await withTenant(
			tenantA,
			(tx) =>
				reverseReceipt(tx, {
					tenantId: tenantA,
					receiptId: original.id,
					recordedBy: financeActor,
					idempotencyKey: 'receipt-1-reversal',
				}),
			runtimeDb,
		);
		expect(reversal.receipt.reversesId).toBe(original.id);
		expect(reversal.receipt.amountCents).toBe(2000);

		const [after] = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ digest: string }>(
				`select md5(finance_receipt::text) as digest from finance_receipt where id = $1`,
				[original.id],
			);
			return rows;
		});
		expect(after.digest).toBe(original.digest);
	});

	it('refuses to reverse a reversal — the correction chain replaces, never stacks', async () => {
		const reversalId = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ id: string }>(
				`select id from finance_receipt where reverses_id is not null limit 1`,
			);
			return rows[0].id;
		});
		await expect(
			withTenant(
				tenantA,
				(tx) =>
					reverseReceipt(tx, {
						tenantId: tenantA,
						receiptId: reversalId,
						recordedBy: financeActor,
						idempotencyKey: 'reversal-of-reversal',
					}),
				runtimeDb,
			),
		).rejects.toThrow(/cannot itself be reversed/);
	});

	it('is append-only BY GRANT: the runtime role has no UPDATE or DELETE on finance_receipt', async () => {
		await expect(
			asTenant(fixture.runtimeDsn, tenantA, (client) => client.query(`update finance_receipt set note = 'edited'`)),
		).rejects.toThrow(/permission denied/i);
		await expect(
			asTenant(fixture.runtimeDsn, tenantA, (client) => client.query(`delete from finance_receipt`)),
		).rejects.toThrow(/permission denied/i);
	});

	it('REFUSES an Idempotency-Key reused with a DIFFERENT payload — conflict, not a silent wrong receipt (S5)', async () => {
		await expect(
			withTenant(
				tenantA,
				(tx) =>
					recordCashCheckReceipt(tx, {
						tenantId: tenantA,
						personId,
						rail: 'check',
						amountCents: 50_000,
						receivedOn: '2026-08-21',
						cadence: 'one_time',
						recordedBy: financeActor,
						idempotencyKey: 'receipt-1', // reused, but nothing about it matches
					}),
				runtimeDb,
			),
		).rejects.toThrow(IdempotencyConflictError);

		// The conflicting request recorded NOTHING.
		const count = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query(`select count(*)::int as n from finance_receipt where rail = 'check'`);
			return rows[0].n as number;
		});
		expect(count).toBe(0);
	});

	it('REFUSES to silently drop a reversal whose key was already spent — the correction-path S5 case', async () => {
		const originalId = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ id: string }>(
				`select id from finance_receipt where reverses_id is null and person_id = $1 limit 1`,
				[personId],
			);
			return rows[0].id;
		});
		// 'receipt-1' was the ORIGINAL's key; a reversal reusing it must 409, not
		// come back as the original with reverses_id NULL.
		await expect(
			withTenant(
				tenantA,
				(tx) =>
					reverseReceipt(tx, {
						tenantId: tenantA,
						receiptId: originalId,
						recordedBy: financeActor,
						idempotencyKey: 'receipt-1',
					}),
				runtimeDb,
			),
		).rejects.toThrow(IdempotencyConflictError);
	});

	it('REJECTS a cross-tenant reverses_id in the write path AND at the constraint (S4)', async () => {
		// A receipt that belongs to tenant B.
		const foreign = await withTenant(
			tenantB,
			(tx) =>
				recordCashCheckReceipt(tx, {
					tenantId: tenantB,
					personId: randomUUID(),
					rail: 'cash',
					amountCents: 700,
					receivedOn: '2026-08-21',
					cadence: 'one_time',
					recordedBy: financeActor,
					idempotencyKey: 'tenant-b-receipt-1',
				}),
			runtimeDb,
		);

		// App layer: tenant A cannot even name it.
		await expect(
			withTenant(
				tenantA,
				(tx) =>
					recordCashCheckReceipt(tx, {
						tenantId: tenantA,
						personId,
						rail: 'cash',
						amountCents: 700,
						receivedOn: '2026-08-21',
						cadence: 'one_time',
						recordedBy: financeActor,
						idempotencyKey: 'cross-tenant-reversal',
						reversesId: foreign.receipt.id,
					}),
				runtimeDb,
			),
		).rejects.toThrow(ReceiptValidationError);

		// Constraint layer: FK checks bypass RLS, so the composite
		// (tenant_id, reverses_id) FK is what stops a raw INSERT.
		await expect(
			asTenant(fixture.runtimeDsn, tenantA, (client) =>
				client.query(
					`insert into finance_receipt
					   (tenant_id, person_id, rail, amount_cents, received_on, cadence, recorded_by, idempotency_key, reverses_id)
					 values ($1, $2, 'cash', 700, '2026-08-21', 'one_time', $3, 'cross-tenant-reversal-raw', $4)`,
					[tenantA, personId, financeActor, foreign.receipt.id],
				),
			),
		).rejects.toThrow(/foreign key|violates/i);
	});

	it('is finance data another tenant can never see across the boundary', async () => {
		// Tenant B now owns exactly one receipt (the S4 fixture above); it must
		// see that one and NONE of tenant A's trail.
		const visibleToB = await asTenant(fixture.runtimeDsn, tenantB, async (client) => {
			const { rows } = await client.query<{ idempotency_key: string }>(
				`select idempotency_key from finance_receipt order by idempotency_key`,
			);
			return rows.map((r) => r.idempotency_key);
		});
		expect(visibleToB).toEqual(['tenant-b-receipt-1']);

		const aRowsVisibleToB = await asTenant(fixture.runtimeDsn, tenantB, async (client) => {
			const { rows } = await client.query(`select id from finance_receipt where person_id = $1`, [personId]);
			return rows;
		});
		expect(aRowsVisibleToB).toEqual([]);
	});
});

describe('the durable Stripe inbox — checkout → webhook → recorded', () => {
	it('walks the whole recorded lifecycle: pending → active → past_due → recovered → cancelled', async () => {
		// The member chose the card rail; nothing is active until a webhook says so.
		await withTenant(
			tenantA,
			(tx) =>
				chooseContribution(tx, {
					tenantId: tenantA,
					personId: FIXTURE.personId,
					choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
				}),
			runtimeDb,
		);
		// A created-then-abandoned Checkout session (or a success-page redirect
		// with no webhook yet) changes NOTHING durable:
		expect(await agreementState(FIXTURE.personId)).toBe('stripe_pending');

		// checkout.session.completed arrives and is projected.
		expect((await deliver('01-checkout-session-completed.json')).status).toBe(200);
		await project('evt_gftb_fx_0001');
		expect(await agreementState(FIXTURE.personId)).toBe('stripe_active');

		// Renewal failure (the test-clock analogue, replayed from fixtures).
		expect((await deliver('04-invoice-payment-failed.json')).status).toBe(200);
		const failed = await project('evt_gftb_fx_0004', 'past_due');
		expect(failed.gateway.calls.map((c) => c.method)).toEqual(['retrieveSubscription']);
		expect(await agreementState(FIXTURE.personId)).toBe('stripe_past_due');

		// Recovery.
		expect((await deliver('03-invoice-paid.json')).status).toBe(200);
		await project('evt_gftb_fx_0003', 'active');
		expect(await agreementState(FIXTURE.personId)).toBe('stripe_active');

		// Portal cancellation lands as a deletion event.
		expect((await deliver('06-customer-subscription-deleted.json')).status).toBe(200);
		await project('evt_gftb_fx_0006');
		expect(await agreementState(FIXTURE.personId)).toBe('cancelled');
	});

	it('owes exactly one projection job per distinct event, in the same transaction as the inbox row', async () => {
		const kinds = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ idempotency_key: string }>(
				`select idempotency_key from outbox_job where kind = $1 order by idempotency_key`,
				[STRIPE_PROJECT_JOB_KIND],
			);
			return rows.map((r) => r.idempotency_key);
		});
		expect(kinds).toEqual(['evt_gftb_fx_0001', 'evt_gftb_fx_0003', 'evt_gftb_fx_0004', 'evt_gftb_fx_0006']);
	});

	it('collapses a duplicate delivery to one row and one job, acking both times', async () => {
		const first = await deliver('02-customer-subscription-created.json');
		const second = await deliver('02-customer-subscription-created.json');
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);

		const counts = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const inbox = await client.query(`select count(*)::int as n from stripe_event_inbox where event_id = $1`, [
				'evt_gftb_fx_0002',
			]);
			const jobs = await client.query(
				`select count(*)::int as n from outbox_job where kind = $1 and idempotency_key = $2`,
				[STRIPE_PROJECT_JOB_KIND, 'evt_gftb_fx_0002'],
			);
			return { inbox: inbox.rows[0].n as number, jobs: jobs.rows[0].n as number };
		});
		expect(counts).toEqual({ inbox: 1, jobs: 1 });
	});

	it('survives CONCURRENT deliveries of one event id — the primary key is the lock', async () => {
		const raw = readFixtureEventRaw('05-customer-subscription-updated.json');
		const [a, b] = await Promise.all([
			deliver('05-customer-subscription-updated.json'),
			deliver('05-customer-subscription-updated.json'),
		]);
		expect([a.status, b.status]).toEqual([200, 200]);
		expect(raw).toContain('evt_gftb_fx_0005');

		const count = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query(`select count(*)::int as n from stripe_event_inbox where event_id = $1`, [
				'evt_gftb_fx_0005',
			]);
			return rows[0].n as number;
		});
		expect(count).toBe(1);
	});

	it('projects idempotently: replaying a processed event converges, never doubles', async () => {
		const once = await project('evt_gftb_fx_0006');
		const twice = await project('evt_gftb_fx_0006');
		expect(once.outcome).toMatchObject({ action: 'projected', state: 'cancelled' });
		expect(twice.outcome).toMatchObject({ action: 'projected', state: 'cancelled' });
		expect(await agreementState(FIXTURE.personId)).toBe('cancelled');

		const [row] = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ process_attempts: number; processed_at: string | null }>(
				`select process_attempts, processed_at from stripe_event_inbox where event_id = $1`,
				['evt_gftb_fx_0006'],
			);
			return rows;
		});
		expect(row.processed_at).not.toBeNull();
		expect(row.process_attempts).toBeGreaterThanOrEqual(2);
	});

	it('CANNOT resurrect the cancelled contribution via a late or replayed checkout event (B2)', async () => {
		expect(await agreementState(FIXTURE.personId)).toBe('cancelled');
		// The checkout event is still in the inbox; replay it as a late,
		// out-of-order delivery. The projector retrieves CURRENT subscription
		// state (canceled) instead of trusting the payload snapshot.
		const late = await project('evt_gftb_fx_0001', 'canceled');
		expect(late.gateway.calls.map((c) => c.method)).toEqual(['retrieveSubscription']);
		expect(late.outcome).toMatchObject({ action: 'projected', state: 'cancelled' });
		expect(await agreementState(FIXTURE.personId)).toBe('cancelled');
	});

	it('stamps process_attempts/last_error in a SEPARATE transaction that survives the rethrow (S2)', async () => {
		const failingGateway = {
			calls: [],
			createCheckoutSession: async () => {
				throw new Error('forced gateway failure (S2 row)');
			},
			createPortalSession: async () => {
				throw new Error('forced gateway failure (S2 row)');
			},
			retrieveSubscription: async () => {
				throw new Error('forced gateway failure (S2 row)');
			},
			findSubscriptionForCustomer: async () => {
				throw new Error('forced gateway failure (S2 row)');
			},
		};
		const before = await agreementState(FIXTURE.personId);
		await expect(
			withTenant(
				tenantA,
				(tx) =>
					projectStripeEvent(tx, {
						tenantId: tenantA,
						eventId: 'evt_gftb_fx_0002',
						gateway: failingGateway,
						failureStampDb: runtimeDb,
					}),
				runtimeDb,
			),
		).rejects.toThrow(/forced gateway failure/);

		// The doomed transaction rolled back (agreement untouched) …
		expect(await agreementState(FIXTURE.personId)).toBe(before);
		// … but the forensic stamp COMMITTED through its own connection.
		const [row] = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ process_attempts: number; last_error: string | null }>(
				`select process_attempts, last_error from stripe_event_inbox where event_id = $1`,
				['evt_gftb_fx_0002'],
			);
			return rows;
		});
		expect(row.process_attempts).toBeGreaterThanOrEqual(1);
		expect(row.last_error).toContain('forced gateway failure');
	});

	it('lets the runtime role stamp ONLY its bookkeeping columns — the signed payload is immutable (S3)', async () => {
		await expect(
			asTenant(fixture.runtimeDsn, tenantA, (client) =>
				client.query(`update stripe_event_inbox set payload = '{}'::jsonb`),
			),
		).rejects.toThrow(/permission denied/i);
		await expect(
			asTenant(fixture.runtimeDsn, tenantA, (client) => client.query(`update stripe_event_inbox set livemode = true`)),
		).rejects.toThrow(/permission denied/i);
		// The column-scoped re-grant keeps the consumer's own bookkeeping open.
		await asTenant(fixture.runtimeDsn, tenantA, (client) =>
			client.query(`update stripe_event_inbox set last_error = last_error where event_id = 'evt_gftb_fx_0002'`),
		);
	});

	it('rejects a correctly-signed live-mode event with 4xx and ZERO state change', async () => {
		const before = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query(`select count(*)::int as n from stripe_event_inbox`);
			return rows[0].n as number;
		});
		const response = await deliver('03-invoice-paid.json', {
			mutate: (raw) =>
				raw.replace('"livemode": false', '"livemode": true').replace('evt_gftb_fx_0003', 'evt_gftb_fx_live'),
		});
		expect(response.status).toBe(400);
		const after = await asTenant(fixture.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query(`select count(*)::int as n from stripe_event_inbox`);
			return rows[0].n as number;
		});
		expect(after).toBe(before);
	});

	it('keeps the inbox durable BY GRANT: the runtime role cannot DELETE an event', async () => {
		await expect(
			asTenant(fixture.runtimeDsn, tenantA, (client) => client.query(`delete from stripe_event_inbox`)),
		).rejects.toThrow(/permission denied/i);
	});

	it('is invisible across tenants like everything else', async () => {
		const rows = await asTenant(fixture.runtimeDsn, tenantB, async (client) => {
			const { rows: events } = await client.query(`select event_id from stripe_event_inbox`);
			return events;
		});
		expect(rows).toEqual([]);
	});
});

/**
 * S9 acceptance row 8, second half: "portal-driven cancellation and refund
 * project correctly." The portal SESSION-CREATION half is proven keylessly in
 * `stripe/portal.test.ts` (previously zero coverage of any kind). This half
 * proves the CONSEQUENCE a portal-driven refund produces once its webhook
 * arrives — the same shape as cancellation's `customer.subscription.deleted`
 * proof elsewhere in this file, applied to `charge.refunded`, which
 * previously fell through to the default skip and left the schema's
 * `refunded` state dead/unreachable code.
 *
 * Runs in its OWN tenant (not `tenantA`) so it cannot perturb the exact
 * event-list/count assertions the lifecycle describe block above depends on.
 */
describe('charge.refunded — the schema state a payload-skip left unreachable (S9 row 8)', () => {
	it('projects a FULLY refunded charge to refunded, and the cash/check ledger stays untouched (append-only across rails)', async () => {
		const tenantId = await seedTenant(fixture.migratorDsn, 'refund-gap');
		const stateOf = async () =>
			(await withTenant(tenantId, (tx) => getAgreement(tx, FIXTURE.personId), runtimeDb))?.state;
		const receiptCount = async () =>
			asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query(`select count(*)::int as n from finance_receipt`);
				return rows[0].n as number;
			});

		await withTenant(
			tenantId,
			(tx) =>
				chooseContribution(tx, {
					tenantId,
					personId: FIXTURE.personId,
					choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
				}),
			runtimeDb,
		);

		// Land the subscription active first — a refund on a never-active
		// contribution is not the scenario this row describes.
		expect((await deliver('01-checkout-session-completed.json', { tenantId })).status).toBe(200);
		await withTenant(
			tenantId,
			(tx) =>
				projectStripeEvent(tx, {
					tenantId,
					eventId: 'evt_gftb_fx_0001',
					gateway: createReplayGateway({ subscriptionStatus: 'active' }),
				}),
			runtimeDb,
		);
		expect(await stateOf()).toBe('stripe_active');
		expect(await receiptCount()).toBe(0);

		// The refund itself: durable ingest through the real webhook path, then
		// projection.
		expect((await deliver('07-charge-refunded.json', { tenantId })).status).toBe(200);

		const gateway = createReplayGateway();
		const outcome = await withTenant(
			tenantId,
			(tx) => projectStripeEvent(tx, { tenantId, eventId: 'evt_gftb_fx_0007', gateway }),
			runtimeDb,
		);
		expect(gateway.calls.map((c) => c.method)).toEqual(['findSubscriptionForCustomer']);
		expect(outcome).toMatchObject({ action: 'projected', state: 'refunded', personId: FIXTURE.personId });
		expect(await stateOf()).toBe('refunded');

		// Receipts stay append-only (§1.10 rows 3-4's idiom, applied across the
		// rail boundary): the Stripe refund path never fabricates, mutates, or
		// otherwise touches the cash/check ledger. Zero rows before, zero after.
		expect(await receiptCount()).toBe(0);
	});

	it('BLOCK-3: refunded is ABSORBING — a redelivered invoice.paid retrieving a still-active subscription does not resurrect stripe_active', async () => {
		const tenantId = await seedTenant(fixture.migratorDsn, 'refund-absorbing-gap');
		const stateOf = async () =>
			(await withTenant(tenantId, (tx) => getAgreement(tx, FIXTURE.personId), runtimeDb))?.state;
		const versionOf = async () =>
			(await withTenant(tenantId, (tx) => getAgreement(tx, FIXTURE.personId), runtimeDb))?.version;

		await withTenant(
			tenantId,
			(tx) =>
				chooseContribution(tx, {
					tenantId,
					personId: FIXTURE.personId,
					choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
				}),
			runtimeDb,
		);
		await deliver('01-checkout-session-completed.json', { tenantId });
		await withTenant(
			tenantId,
			(tx) =>
				projectStripeEvent(tx, {
					tenantId,
					eventId: 'evt_gftb_fx_0001',
					gateway: createReplayGateway({ subscriptionStatus: 'active' }),
				}),
			runtimeDb,
		);
		expect(await stateOf()).toBe('stripe_active');

		// The refund lands.
		await deliver('07-charge-refunded.json', { tenantId });
		await withTenant(
			tenantId,
			(tx) => projectStripeEvent(tx, { tenantId, eventId: 'evt_gftb_fx_0007', gateway: createReplayGateway() }),
			runtimeDb,
		);
		expect(await stateOf()).toBe('refunded');
		const versionAfterRefund = await versionOf();

		// A refund does not cancel the subscription in Stripe — it stays
		// "active" — so a STALE or REDELIVERED invoice.paid (Stripe retries
		// deliveries for up to 3 days; this worker's own backoff can retry a
		// backed-off job well after the refund job ran) retrieves that SAME
		// still-active subscription and, absent the guard, would silently
		// overwrite 'refunded' back to 'stripe_active' — exactly the
		// arrival-order dependency spec §5's retrieve-the-truth idiom exists to
		// eliminate (see the module docstring's "REFUNDED IS ABSORBING" note).
		await deliver('03-invoice-paid.json', { tenantId });
		const outcome = await withTenant(
			tenantId,
			(tx) =>
				projectStripeEvent(tx, {
					tenantId,
					eventId: 'evt_gftb_fx_0003',
					gateway: createReplayGateway({ subscriptionStatus: 'active' }),
				}),
			runtimeDb,
		);
		expect(outcome.action).toBe('skipped');
		expect(await stateOf()).toBe('refunded');
		// The guard is a no-op WRITE, not a no-op statement: version does not
		// advance for an absorbed projection (the UPDATE's WHERE matched zero
		// rows).
		expect(await versionOf()).toBe(versionAfterRefund);
	});
});

/**
 * S9 acceptance row 6: "a cancelled Checkout and a success-redirect-without-
 * webhook both leave durable state untouched." Each half runs in its own
 * fresh tenant, isolated from the lifecycle describe block's ordering-
 * sensitive assertions above.
 */
describe('a cancelled Checkout and a success-redirect-without-webhook leave durable state untouched (S9 row 6)', () => {
	it('an expired Checkout session (Stripe\'s real "cancelled" mechanism) is durably ingested but projects to nothing', async () => {
		// Stripe has no separate "cancelled Checkout" webhook: clicking Cancel
		// only redirects the browser to cancel_url, informationally, with no
		// event delivered at all (the second half of this row, below).
		// checkout.session.expired is the real mechanism for an abandoned or
		// timed-out session, and it is durably ingested like any other event
		// even though the projector recognises no case for it.
		const tenantId = await seedTenant(fixture.migratorDsn, 'checkout-expired-gap');
		const stateOf = async () =>
			(await withTenant(tenantId, (tx) => getAgreement(tx, FIXTURE.personId), runtimeDb))?.state;

		await withTenant(
			tenantId,
			(tx) =>
				chooseContribution(tx, {
					tenantId,
					personId: FIXTURE.personId,
					choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
				}),
			runtimeDb,
		);
		expect(await stateOf()).toBe('stripe_pending');

		expect((await deliver('08-checkout-session-expired.json', { tenantId })).status).toBe(200);

		const gateway = createReplayGateway();
		const outcome = await withTenant(
			tenantId,
			(tx) => projectStripeEvent(tx, { tenantId, eventId: 'evt_gftb_fx_0008', gateway }),
			runtimeDb,
		);
		expect(outcome.action).toBe('skipped');
		expect(gateway.calls).toEqual([]);
		expect(await stateOf()).toBe('stripe_pending');
	});

	it('a success-redirect with NO webhook EVER delivered changes nothing: zero membership/contribution state change, zero receipts', async () => {
		const tenantId = await seedTenant(fixture.migratorDsn, 'success-redirect-gap');
		const stateOf = async () =>
			(await withTenant(tenantId, (tx) => getAgreement(tx, FIXTURE.personId), runtimeDb))?.state;

		await withTenant(
			tenantId,
			(tx) =>
				chooseContribution(tx, {
					tenantId,
					personId: FIXTURE.personId,
					choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
				}),
			runtimeDb,
		);
		expect(await stateOf()).toBe('stripe_pending');

		// Exactly what the browser flow does: start a hosted Checkout session and
		// (this is the scenario) land on successUrl with NO webhook ever
		// delivered — a slow/dropped webhook, or the tab closed before Stripe
		// retried. Nothing in this system reacts to the redirect itself; only
		// the webhook inbox moves durable state (spec §5).
		const gateway = createReplayGateway();
		const session = await createContributionCheckout(gateway, {
			personId: FIXTURE.personId,
			choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
			successUrl: 'https://example.test/ok',
			cancelUrl: 'https://example.test/back',
		});
		expect(session.kind).toBe('session');
		expect(await stateOf()).toBe('stripe_pending');

		const counts = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const inbox = await client.query(`select count(*)::int as n from stripe_event_inbox`);
			const jobs = await client.query(`select count(*)::int as n from outbox_job where kind = $1`, [
				STRIPE_PROJECT_JOB_KIND,
			]);
			const receipts = await client.query(`select count(*)::int as n from finance_receipt`);
			return {
				inbox: inbox.rows[0].n as number,
				jobs: jobs.rows[0].n as number,
				receipts: receipts.rows[0].n as number,
			};
		});
		expect(counts).toEqual({ inbox: 0, jobs: 0, receipts: 0 });
		expect(await stateOf()).toBe('stripe_pending');
	});
});
