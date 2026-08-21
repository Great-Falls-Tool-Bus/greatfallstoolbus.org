/**
 * The `stripe.project` handler against real PostgreSQL (TIN-3818/TIN-3817
 * S9) — the acceptance row the S8/S9 matrix flagged as unproven end-to-end:
 * "nothing in the deployed worker ever calls [`projectStripeEvent`]… every
 * existing green test calls it directly, bypassing the dispatcher entirely."
 *
 * This file exercises the REAL path instead: a webhook delivery writes the
 * inbox row and owes the `stripe.project` job in one transaction (`inbox.ts`,
 * unchanged), and `dispatchOnce` — the actual S3 claim/lease/complete cycle,
 * not a bypass — claims and runs the handler this PR registers.
 *
 * Same harness discipline as `../outbox.integration.test.ts`: this file
 * builds its OWN `Db` over `drizzle(pool, { schema })` rather than importing
 * `createDb`/`getDb` from `../../db/client`, because those names are
 * lint-fenced to `src/lib/server/db/**` and the process-wide pool reads
 * `DATABASE_URL`, which deliberately does not exist in this suite.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chooseContribution, getAgreement } from '../../contribution/agreement';
import { schema, type Db } from '../../db/client';
import {
	MIGRATIONS_DIR,
	asTenant,
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../../db/integration-support';
import { runMigrator } from '../../db/migrate';
import { withTenant } from '../../db/tenant';
import type { StripeWebhookSecret } from '../../stripe/config';
import {
	FIXTURE,
	createReplayGateway,
	readFixtureEvent,
	readFixtureEventRaw,
	signPayloadForTest,
} from '../../stripe/fixtures';
import { ingestStripeEvent } from '../../stripe/inbox';
import { handleStripeWebhook } from '../../stripe/webhook';
import { dispatchOnce } from '../dispatch';
import { createHandlerRegistry } from '../handlers';
import type { ClaimedJob } from '../schema';
import { STRIPE_PROJECT_JOB_KIND, createStripeProjectHandler } from './stripe-project';

let fixture: PgFixture;
let db: Db;
let pool: pg.Pool;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };
const WHSEC = ('whsec_' + randomUUID().replace(/-/g, '')) as StripeWebhookSecret;

beforeAll(async () => {
	fixture = await startPostgres();
	const migrated = await runMigrator({
		args: ['--dsn', fixture.migratorDsn],
		env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
		io: silent,
	});
	if (migrated.code !== 0) throw new Error(`fixture migration failed with code ${migrated.code}`);
	await credentialRuntimeRole(fixture);

	pool = new pg.Pool({ connectionString: fixture.runtimeDsn, max: 8 });
	db = drizzle(pool, { schema });
}, 240_000);

afterAll(async () => {
	await pool?.end();
	await fixture?.stop();
});

async function newTenant(): Promise<string> {
	return seedTenant(fixture.migratorDsn, `stripe-worker-${randomUUID().slice(0, 8)}`);
}

/** Post one fixture file through the REAL webhook handler — inbox row + owed job, one transaction. */
async function deliver(tenantId: string, filename: string) {
	const raw = readFixtureEventRaw(filename);
	return handleStripeWebhook(
		{ rawBody: raw, signatureHeader: signPayloadForTest(raw, WHSEC) },
		{
			webhookSecret: WHSEC,
			tenantId,
			persist: (event) => withTenant(tenantId, (tx) => ingestStripeEvent(tx, { tenantId, event }), db),
		},
	);
}

async function agreementState(tenantId: string, personId: string): Promise<string | undefined> {
	const agreement = await withTenant(tenantId, (tx) => getAgreement(tx, personId), db);
	return agreement?.state;
}

async function pendingStripeJobCount(tenantId: string): Promise<number> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query<{ n: number }>(
			`select count(*)::int as n from outbox_job where kind = $1 and status = 'pending'`,
			[STRIPE_PROJECT_JOB_KIND],
		);
		return rows[0].n;
	});
}

async function inboxProcessAttempts(tenantId: string, eventId: string): Promise<number> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query<{ process_attempts: number }>(
			`select process_attempts from stripe_event_inbox where event_id = $1`,
			[eventId],
		);
		return rows[0].process_attempts;
	});
}

/** The single pending stripe.project job's id — for the manual-claim (duplicate-handler) scenario below. */
async function firstPendingStripeJobId(tenantId: string): Promise<string> {
	const rows = await withTenant(
		tenantId,
		(tx) =>
			tx.execute<{ id: string }>(
				sql`select id from outbox_job where kind = ${STRIPE_PROJECT_JOB_KIND} and status = 'pending' order by created_at limit 1`,
			),
		db,
	);
	const id = rows.rows[0]?.id;
	if (!id) throw new Error('firstPendingStripeJobId: no pending stripe.project job found');
	return id;
}

async function chooseStripeContribution(tenantId: string, personId: string): Promise<void> {
	await withTenant(
		tenantId,
		(tx) =>
			chooseContribution(tx, {
				tenantId,
				personId,
				choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
			}),
		db,
	);
}

describe('the stripe.project handler, claimed and run by the REAL dispatcher', () => {
	it('claims an enqueued job, projects it, and converges the agreement — the production gap the S8/S9 matrix flagged', async () => {
		const tenantId = await newTenant();
		await chooseStripeContribution(tenantId, FIXTURE.personId);
		expect(await agreementState(tenantId, FIXTURE.personId)).toBe('stripe_pending');

		expect((await deliver(tenantId, '01-checkout-session-completed.json')).status).toBe(200);
		expect(await pendingStripeJobCount(tenantId)).toBe(1);

		const gateway = createReplayGateway({ subscriptionStatus: 'active' });
		const registry = createHandlerRegistry({
			[STRIPE_PROJECT_JOB_KIND]: createStripeProjectHandler({ gateway, db }),
		});

		const summary = await dispatchOnce({ tenantId, worker: 'stripe-project-test', registry, db });
		expect(summary).toMatchObject({ claimed: 1, done: 1, retried: 0, dead: 0, lost: 0 });
		expect(gateway.calls.map((c) => c.method)).toEqual(['retrieveSubscription']);

		expect(await agreementState(tenantId, FIXTURE.personId)).toBe('stripe_active');
		expect(await pendingStripeJobCount(tenantId)).toBe(0);
	});

	it('dead-letters visibly rather than silently succeeding when the payload is poisoned', async () => {
		// A malformed payload never legitimately reaches production (inbox.ts
		// always writes { eventId }), but the dispatcher's own contract (spec
		// §3.1) is that ANY handler throw counts as an attempt and either
		// retries or dead-letters — never a silent 'done'. Proven here with a
		// low max_attempts so the row dead-letters within this one test.
		const tenantId = await newTenant();
		await withTenant(
			tenantId,
			(tx) =>
				tx.execute(
					sql`insert into outbox_job (tenant_id, kind, aggregate_type, aggregate_id, payload, idempotency_key, max_attempts)
					    values (${tenantId}::uuid, ${STRIPE_PROJECT_JOB_KIND}, 'stripe_event', ${randomUUID()}::uuid, '{"nope": true}'::jsonb, ${randomUUID()}, 1)`,
				),
			db,
		);
		const registry = createHandlerRegistry({
			[STRIPE_PROJECT_JOB_KIND]: createStripeProjectHandler({ gateway: createReplayGateway(), db }),
		});
		const summary = await dispatchOnce({ tenantId, worker: 'poison-test', registry, db });
		expect(summary).toMatchObject({ claimed: 1, done: 0, dead: 1 });

		const row = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query<{ status: string; last_error: string }>(
				`select status, last_error from outbox_job where kind = $1`,
				[STRIPE_PROJECT_JOB_KIND],
			);
			return rows[0];
		});
		expect(row.status).toBe('dead');
		expect(row.last_error).toContain('StripeProjectPayloadError');
	});

	it('is DUPLICATE-CLAIM safe at the dispatcher level: a completed job is never reclaimed by a later cycle', async () => {
		const tenantId = await newTenant();
		await chooseStripeContribution(tenantId, FIXTURE.personId);
		await deliver(tenantId, '02-customer-subscription-created.json');

		const registry = createHandlerRegistry({
			[STRIPE_PROJECT_JOB_KIND]: createStripeProjectHandler({
				gateway: createReplayGateway({ subscriptionStatus: 'active' }),
				db,
			}),
		});

		const first = await dispatchOnce({ tenantId, worker: 'w1', registry, db });
		expect(first).toMatchObject({ claimed: 1, done: 1 });

		// A second cycle over the SAME tenant sees nothing to claim: the claim
		// predicate is `status in ('pending','leased')`, and a done job matches
		// neither — the dispatcher's own exclusivity, not application logic.
		const second = await dispatchOnce({ tenantId, worker: 'w2', registry, db });
		expect(second).toMatchObject({ claimed: 0, done: 0 });
	});

	it('is DUPLICATE-CLAIM safe at the handler level: running the SAME claimed job twice converges, never doubles', async () => {
		// Simulates the realistic at-least-once hazard the outbox contract
		// names explicitly (schema.ts's OutboxHandler docstring): a lease
		// reclaimed mid-handler lets a second replica run "the same" job while
		// the first is still in flight. Both calls carry the same
		// tenantId/payload — what the handler actually keys its work on — even
		// though a hand-built ClaimedJob cannot carry two distinct real lease
		// tokens minted by one real claim.
		const tenantId = await newTenant();
		await chooseStripeContribution(tenantId, FIXTURE.personId);
		await deliver(tenantId, '01-checkout-session-completed.json');
		const jobId = await firstPendingStripeJobId(tenantId);

		const claimedJob: ClaimedJob = {
			id: jobId,
			tenantId,
			kind: STRIPE_PROJECT_JOB_KIND,
			aggregateType: 'stripe_event',
			aggregateId: randomUUID(),
			payload: { eventId: readFixtureEvent('01-checkout-session-completed.json').id },
			idempotencyKey: readFixtureEvent('01-checkout-session-completed.json').id,
			status: 'leased',
			attempts: 0,
			maxAttempts: 8,
			availableAt: new Date(),
			leaseOwner: 'worker-a#lease-1',
			leaseExpiresAt: new Date(Date.now() + 60_000),
			lastError: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			leaseToken: 'worker-a#lease-1',
		};

		const handler = createStripeProjectHandler({
			gateway: createReplayGateway({ subscriptionStatus: 'active' }),
			db,
		});

		await expect(handler(claimedJob)).resolves.toBeUndefined();
		await expect(
			handler({ ...claimedJob, leaseOwner: 'worker-b#lease-2', leaseToken: 'worker-b#lease-2' }),
		).resolves.toBeUndefined();

		expect(await agreementState(tenantId, FIXTURE.personId)).toBe('stripe_active');
		// Genuinely re-executed twice (not skipped the second time) — the
		// convergence is because the projection is idempotent, not because the
		// second call was a no-op.
		expect(await inboxProcessAttempts(tenantId, claimedJob.idempotencyKey)).toBeGreaterThanOrEqual(2);
	});
});
