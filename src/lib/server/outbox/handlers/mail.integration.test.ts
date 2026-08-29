/**
 * The three application-mail outbox handlers, claimed and run by the REAL
 * dispatcher (TIN-4062) — the S8/S9-matrix-flagged shape applied to mail:
 * every existing green test for `intake.ts`/`decide.ts` calls
 * `submitApplication`/`approveApplication`/`declineApplication`/
 * `withdrawApplication` directly and asserts a job was ENQUEUED; none of
 * them ever claims or runs it. This file closes that gap for all three mail
 * kinds at once, against real PostgreSQL (S1 fixture: real migrator run,
 * real `gftb_migrator`/`gftb_app` role split, FORCE RLS binding both).
 *
 * ROWS PROVEN HERE:
 *   - each kind end-to-end: enqueue → `dispatchOnce` → handler → a
 *     `mail_delivery_journal` row recording the DISABLED outcome (the
 *     default in this fixture's env, exactly like production);
 *   - idempotent re-run: replaying a "done" job (status reset to `pending`,
 *     the shape a stale-lease reclaim or an at-least-once redelivery takes)
 *     produces NO duplicate journal row and mints NO duplicate token;
 *   - dead-letter on template-unapproved + delivery-enabled: with
 *     `GFTB_MAIL_DELIVERY=enabled` and a transport DSN present, every
 *     shipped template's `approved: false` makes `resolveDelivery` throw
 *     BEFORE any transaction opens — the job dead-letters via the ordinary
 *     retry path, and NEITHER a journal row NOR a token is ever written;
 *   - default-env proof that no transport is ever constructed: the journal
 *     row's `mode` is `'disabled'` for every kind under this fixture's
 *     ordinary (unset) `GFTB_MAIL_DELIVERY` — if `SmtpDelivery` had been
 *     constructed and reached, the mode would read `'sent'`.
 */

import { randomUUID } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { KEYHOLDER_ROLE, claimApplication, scheduleTour } from '../../application/claim';
import { approveApplication, declineApplication, withdrawApplication } from '../../application/decide';
import { RECEIPT_EMAIL_JOB_KIND, submitApplication, validateSubmission, verifyEmail } from '../../application/intake';
import { mintToken } from '../../application/tokens';
import { grantRole } from '../../auth/roles';
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
import { MAIL_DELIVERY_ENV, MAIL_FROM_ADDRESS_ENV, MAIL_SMTP_URL_ENV } from '../../mail/config';
import { dispatchOnce } from '../dispatch';
import { createHandlerRegistry } from '../handlers';
import { createDecisionEmailHandler } from './application-decision-email';
import { createReceiptEmailHandler } from './application-receipt-email';
import { createWithdrawnAckHandler } from './application-withdrawn-ack';
import { DECISION_EMAIL_JOB_KIND, WITHDRAWN_ACK_JOB_KIND } from '../../application/decide';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

const DISABLED_ENV = {} as NodeJS.ProcessEnv;
const ENABLED_ENV = {
	[MAIL_DELIVERY_ENV]: 'enabled',
	[MAIL_SMTP_URL_ENV]: 'smtps://user:pass@mail.example.invalid:465',
	[MAIL_FROM_ADDRESS_ENV]: 'noreply@example.invalid',
} as NodeJS.ProcessEnv;

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
	return seedTenant(fixture.migratorDsn, `mail-worker-${randomUUID().slice(0, 8)}`);
}

async function newKeyholder(tenantId: string): Promise<string> {
	const personId = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	return personId;
}

function submission() {
	return validateSubmission({
		displayName: 'Alex Applicant',
		email: `applicant-${randomUUID().slice(0, 8)}@example.invalid`,
		interestsHelpOffer: 'woodworking; can staff intake',
		tourAvailability: 'weekday evenings',
		disclosures: 'none',
		ageAttested: true,
	});
}

async function submitted(tenantId: string) {
	const result = await withTenant(tenantId, (tx) => submitApplication(tx, submission()), db);
	return result.application;
}

async function tourScheduled(tenantId: string, keyholder: string) {
	const submittedApp = await submitted(tenantId);
	const minted = await withTenant(
		tenantId,
		(tx) => mintToken(tx, { applicationId: submittedApp.id, purpose: 'verify_email' }),
		db,
	);
	const verifiedApp = await withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);
	await withTenant(
		tenantId,
		(tx) => claimApplication(tx, { applicationId: verifiedApp.id, keyholderPersonId: keyholder }),
		db,
	);
	return withTenant(
		tenantId,
		(tx) => scheduleTour(tx, { applicationId: verifiedApp.id, keyholderPersonId: keyholder }),
		db,
	);
}

async function pendingJob(tenantId: string, kind: string, applicationId: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(
			`select id, status, attempts, max_attempts, idempotency_key from outbox_job
			 where kind = $1 and aggregate_id = $2 order by created_at limit 1`,
			[kind, applicationId],
		);
		return rows[0] as { id: string; status: string; attempts: number; max_attempts: number; idempotency_key: string };
	});
}

async function setMaxAttempts(tenantId: string, jobId: string, maxAttempts: number) {
	await asTenant(fixture.runtimeDsn, tenantId, (client) =>
		client.query(`update outbox_job set max_attempts = $2 where id = $1`, [jobId, maxAttempts]),
	);
}

async function resetToPending(tenantId: string, jobId: string) {
	await asTenant(fixture.runtimeDsn, tenantId, (client) =>
		client.query(
			`update outbox_job set status = 'pending', lease_owner = null, lease_expires_at = null, available_at = now() where id = $1`,
			[jobId],
		),
	);
}

/**
 * Scoped to `phase = 'outcome'` (PR #208 review E2: a completed job now
 * writes an `intent` row AND an `outcome` row, two INSERTs — this helper
 * keeps testing exactly what it always tested, "what happened," and stays
 * blind to the intermediate `intent` row) and by `kind` as well as
 * `aggregateId`: `tourScheduled`/`submitted` always leaves a pending
 * `application.receipt_email` job behind it (A2's own enqueue), so a
 * decision/withdrawn-ack test's dispatch cycle legitimately claims and
 * journals THAT job too when its handler is also registered — scoping by
 * kind keeps each test's assertion about the kind under test.
 */
async function journalRows(tenantId: string, applicationId: string, kind?: string) {
	return journalPhaseRows(tenantId, applicationId, 'outcome', kind);
}

/** As `journalRows`, but able to see `intent` rows too — for the E2 ambiguous-state proof. */
async function journalPhaseRows(tenantId: string, applicationId: string, phase: 'intent' | 'outcome', kind?: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(
			`select j.mode, j.phase, j.template_id, j.template_approved, j.idempotency_key
			 from mail_delivery_journal j
			 join outbox_job o on o.id = j.outbox_job_id
			 where o.aggregate_id = $1 and j.phase = $2 and ($3::text is null or j.kind = $3)
			 order by j.created_at`,
			[applicationId, phase, kind ?? null],
		);
		return rows as {
			mode: string | null;
			phase: string;
			template_id: string;
			template_approved: boolean;
			idempotency_key: string;
		}[];
	});
}

/** Insert a bare `intent` row directly — simulates a prior attempt that committed intent and crashed before an outcome. */
async function seedOrphanIntent(
	tenantId: string,
	jobId: string,
	kind: string,
	idempotencyKey: string,
	templateId: string,
) {
	await asTenant(fixture.runtimeDsn, tenantId, (client) =>
		client.query(
			`insert into mail_delivery_journal
			   (tenant_id, outbox_job_id, kind, idempotency_key, phase, template_id, template_approved)
			 values ($1, $2, $3, $4, 'intent', $5, false)`,
			[tenantId, jobId, kind, idempotencyKey, templateId],
		),
	);
}

async function tokenCount(tenantId: string, applicationId: string, purpose: string): Promise<number> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query<{ n: string }>(
			`select count(*)::int as n from application_email_token where application_id = $1 and purpose = $2`,
			[applicationId, purpose],
		);
		return Number(rows[0].n);
	});
}

async function jobStatus(tenantId: string, jobId: string): Promise<string> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query<{ status: string }>(`select status from outbox_job where id = $1`, [jobId]);
		return rows[0].status;
	});
}

describe('application.receipt_email — claimed and run by the real dispatcher', () => {
	it('mints verify + withdraw tokens, journals a disabled outcome, and is idempotent on replay', async () => {
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		const job = await pendingJob(tenantId, RECEIPT_EMAIL_JOB_KIND, app.id);
		expect(job.status).toBe('pending');

		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ db, env: DISABLED_ENV }),
		});

		const summary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		expect(summary).toMatchObject({ claimed: 1, done: 1, retried: 0, dead: 0 });

		expect(await tokenCount(tenantId, app.id, 'verify_email')).toBe(1);
		expect(await tokenCount(tenantId, app.id, 'withdraw')).toBe(1);

		const rows = await journalRows(tenantId, app.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			mode: 'disabled',
			template_id: 'application.receipt_email',
			template_approved: false,
		});

		// Idempotent replay: an at-least-once redelivery of the SAME job (the
		// shape a stale-lease reclaim takes) must mint no second pair of
		// tokens and write no second journal row.
		await resetToPending(tenantId, job.id);
		const secondSummary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		expect(secondSummary).toMatchObject({ claimed: 1, done: 1 });

		expect(await tokenCount(tenantId, app.id, 'verify_email')).toBe(1);
		expect(await tokenCount(tenantId, app.id, 'withdraw')).toBe(1);
		expect(await journalRows(tenantId, app.id)).toHaveLength(1);
	});
});

describe('application.decision_email — claimed and run by the real dispatcher', () => {
	it('approved: mints an activate token and journals a disabled outcome, idempotently', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);

		await withTenant(
			tenantId,
			(tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);

		const job = await pendingJob(tenantId, DECISION_EMAIL_JOB_KIND, app.id);
		// `tourScheduled` left a pending `application.receipt_email` job behind
		// it (A2's own enqueue, never dispatched by this test group); register
		// its handler too so ONE dispatch cycle claims and completes BOTH
		// pending jobs, matching production's `defaultRegistry` shape, rather
		// than leaving the receipt job to dead-letter on `UnknownJobKindError`.
		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ db, env: DISABLED_ENV }),
			[DECISION_EMAIL_JOB_KIND]: createDecisionEmailHandler({ db, env: DISABLED_ENV }),
		});

		const summary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		expect(summary).toMatchObject({ claimed: 2, done: 2, retried: 0, dead: 0 });

		expect(await tokenCount(tenantId, app.id, 'activate')).toBe(1);
		const rows = await journalRows(tenantId, app.id, DECISION_EMAIL_JOB_KIND);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ mode: 'disabled', template_id: 'application.decision_email' });

		await resetToPending(tenantId, job.id);
		const secondSummary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		expect(secondSummary).toMatchObject({ claimed: 1, done: 1 });
		expect(await tokenCount(tenantId, app.id, 'activate')).toBe(1);
		expect(await journalRows(tenantId, app.id, DECISION_EMAIL_JOB_KIND)).toHaveLength(1);
	});

	it('declined: journals a disabled outcome and mints NO activation token', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);

		await withTenant(
			tenantId,
			(tx) =>
				declineApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder, reasonClass: 'moved_away' }),
			db,
		);

		// Same leftover-receipt-job reason as the approved case above.
		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ db, env: DISABLED_ENV }),
			[DECISION_EMAIL_JOB_KIND]: createDecisionEmailHandler({ db, env: DISABLED_ENV }),
		});
		const summary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		expect(summary).toMatchObject({ claimed: 2, done: 2, retried: 0, dead: 0 });

		expect(await tokenCount(tenantId, app.id, 'activate')).toBe(0);
		const rows = await journalRows(tenantId, app.id, DECISION_EMAIL_JOB_KIND);
		expect(rows).toHaveLength(1);
		expect(rows[0].mode).toBe('disabled');
	});
});

describe('application.withdrawn_ack — claimed and run by the real dispatcher', () => {
	it('journals a disabled outcome and mints no further token', async () => {
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'withdraw' }),
			db,
		);
		await withTenant(tenantId, (tx) => withdrawApplication(tx, { token: minted.token }), db);

		// `submitted` left a pending `application.receipt_email` job behind it;
		// same reason as the decision_email tests above.
		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ db, env: DISABLED_ENV }),
			[WITHDRAWN_ACK_JOB_KIND]: createWithdrawnAckHandler({ db, env: DISABLED_ENV }),
		});
		const summary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		expect(summary).toMatchObject({ claimed: 2, done: 2, retried: 0, dead: 0 });

		const rows = await journalRows(tenantId, app.id, WITHDRAWN_ACK_JOB_KIND);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ mode: 'disabled', template_id: 'application.withdrawn_ack' });
	});
});

describe('dead-letter on template-unapproved + delivery-enabled — and the default-env transport proof', () => {
	it('receipt_email: with GFTB_MAIL_DELIVERY=enabled, the unapproved shipped template dead-letters the job, never opens a transaction, and writes no journal row or token', async () => {
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		const job = await pendingJob(tenantId, RECEIPT_EMAIL_JOB_KIND, app.id);
		await setMaxAttempts(tenantId, job.id, 1);

		const registry = createHandlerRegistry({
			// Every shipped template ships `approved: false` — see mail/templates.ts —
			// so this env, which WOULD otherwise reach SmtpDelivery, still cannot.
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ db, env: ENABLED_ENV }),
		});

		const summary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		expect(summary).toMatchObject({ claimed: 1, dead: 1, done: 0 });
		expect(await jobStatus(tenantId, job.id)).toBe('dead');

		// TemplateNotApprovedError fires before withTenant ever opens — proof
		// that reaches all the way to "no journal row, no token" in the database.
		expect(await journalRows(tenantId, app.id)).toHaveLength(0);
		expect(await tokenCount(tenantId, app.id, 'verify_email')).toBe(0);
		expect(await tokenCount(tenantId, app.id, 'withdraw')).toBe(0);
	});

	it('default (unset) env: the same job, same fixture, sends for real NEVER — mode is always disabled', async () => {
		const tenantId = await newTenant();
		const app = await submitted(tenantId);

		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ db, env: DISABLED_ENV }),
		});
		await dispatchOnce({ tenantId, worker: 'test', registry, db });

		const rows = await journalRows(tenantId, app.id);
		expect(rows).toHaveLength(1);
		// mode: 'sent' would mean SmtpDelivery reached a server; it never does here.
		expect(rows[0].mode).toBe('disabled');
	});
});

describe('E2 — the two-phase journal: send outside any open transaction, no double-send on an ambiguous replay', () => {
	it('a successful run writes BOTH an intent row and an outcome row, in that order', async () => {
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ db, env: DISABLED_ENV }),
		});
		await dispatchOnce({ tenantId, worker: 'test', registry, db });

		const intentRows = await journalPhaseRows(tenantId, app.id, 'intent', RECEIPT_EMAIL_JOB_KIND);
		const outcomeRows = await journalPhaseRows(tenantId, app.id, 'outcome', RECEIPT_EMAIL_JOB_KIND);
		expect(intentRows).toHaveLength(1);
		expect(outcomeRows).toHaveLength(1);
		expect(intentRows[0].mode).toBeNull();
		expect(outcomeRows[0].mode).toBe('disabled');
	});

	it('an intent row with NO matching outcome (a prior attempt crashed between commit-intent and commit-outcome) refuses to send again — dead-letters, never re-sends, never re-mints', async () => {
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		const job = await pendingJob(tenantId, RECEIPT_EMAIL_JOB_KIND, app.id);
		await setMaxAttempts(tenantId, job.id, 1);

		// Simulate exactly the crash window E2 exists to guard: intent
		// committed, outcome never recorded — WITHOUT ever calling send().
		await seedOrphanIntent(tenantId, job.id, RECEIPT_EMAIL_JOB_KIND, job.idempotency_key, 'application.receipt_email');

		let sendCalls = 0;
		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({
				db,
				env: DISABLED_ENV,
				deliveryFactory: () => ({
					send: async () => {
						sendCalls += 1;
						return { mode: 'disabled' as const, detail: 'must never run — the intent is ambiguous' };
					},
				}),
			}),
		});

		const summary = await dispatchOnce({ tenantId, worker: 'test', registry, db });

		// AmbiguousDeliveryStateError is an ordinary handler failure to the
		// dispatcher: with max_attempts=1 it dead-letters on the first attempt.
		expect(summary).toMatchObject({ claimed: 1, dead: 1, done: 0 });
		expect(await jobStatus(tenantId, job.id)).toBe('dead');
		expect(sendCalls).toBe(0);
		// render() never ran either — no second token minted alongside the orphan intent.
		expect(await tokenCount(tenantId, app.id, 'verify_email')).toBe(0);
		expect(await tokenCount(tenantId, app.id, 'withdraw')).toBe(0);
		// Still exactly the one (seeded) intent row; no outcome row was ever written.
		expect(await journalPhaseRows(tenantId, app.id, 'intent', RECEIPT_EMAIL_JOB_KIND)).toHaveLength(1);
		expect(await journalPhaseRows(tenantId, app.id, 'outcome', RECEIPT_EMAIL_JOB_KIND)).toHaveLength(0);
	});
});

describe('E5 — structural no-transport proof, runtime half: a socket-spy patched to throw', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('the disabled-path dispatch never calls net.connect / net.createConnection / tls.connect — patched to throw, the whole default-env flow still succeeds', async () => {
		// Set up and WARM the pg pool's own connection(s) BEFORE the spy goes
		// up: `pg` itself dials through `net`/`tls`, so the spy must only be
		// live around the exact call this test is about, never around pool
		// setup — otherwise a pool cache miss would fail the test for a reason
		// that has nothing to do with mail delivery.
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ db, env: DISABLED_ENV }),
		});

		const netConnect = vi.spyOn(net, 'connect').mockImplementation(() => {
			throw new Error('E5 guard: net.connect must never be called under DisabledDelivery');
		});
		const netCreateConnection = vi.spyOn(net, 'createConnection').mockImplementation(() => {
			throw new Error('E5 guard: net.createConnection must never be called under DisabledDelivery');
		});
		const tlsConnect = vi.spyOn(tls, 'connect').mockImplementation(() => {
			throw new Error('E5 guard: tls.connect must never be called under DisabledDelivery');
		});

		const summary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		vi.restoreAllMocks();

		expect(summary).toMatchObject({ claimed: 1, done: 1, retried: 0, dead: 0 });
		expect(netConnect).not.toHaveBeenCalled();
		expect(netCreateConnection).not.toHaveBeenCalled();
		expect(tlsConnect).not.toHaveBeenCalled();
		expect((await journalRows(tenantId, app.id))[0]?.mode).toBe('disabled');
	});

	it('reproduces the reviewer mutation and shows it caught: a DisabledDelivery that opens a real socket turns this test RED', async () => {
		// Same warm-before-spy discipline as the test above.
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		const job = await pendingJob(tenantId, RECEIPT_EMAIL_JOB_KIND, app.id);
		await setMaxAttempts(tenantId, job.id, 1);

		const registry = createHandlerRegistry({
			[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({
				db,
				env: DISABLED_ENV,
				deliveryFactory: () => ({
					send: async () => {
						// The mutation: open a socket, exactly as the review's report
						// describes, before returning the SAME disabled-shaped outcome.
						net.connect({ host: 'localhost', port: 1 });
						return { mode: 'disabled', detail: 'mutated: opened a real socket' };
					},
				}),
			}),
		});

		const netConnect = vi.spyOn(net, 'connect').mockImplementation(() => {
			throw new Error('E5 guard: net.connect must never be called under DisabledDelivery');
		});

		const summary = await dispatchOnce({ tenantId, worker: 'test', registry, db });
		vi.restoreAllMocks();

		// The mutation is caught: net.connect threw INSIDE the handler's send(),
		// which the dispatcher counts as an ordinary handler failure — the job
		// does NOT complete as 'done', proving the spy converts the reviewer's
		// silent mutation into a hard, measured failure.
		expect(summary.done).toBe(0);
		expect(netConnect).toHaveBeenCalled();
	});
});
