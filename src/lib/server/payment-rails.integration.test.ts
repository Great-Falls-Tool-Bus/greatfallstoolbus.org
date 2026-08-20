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
