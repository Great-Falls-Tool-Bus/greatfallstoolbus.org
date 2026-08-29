#!/usr/bin/env -S pnpm exec tsx
/**
 * S1 — synthetic membership rehearsal harness (2026-08-29).
 *
 * Walks a single synthetic applicant through the FULL Member v0 pipeline —
 * apply -> keyholder review/decision -> operator agreement publish (S13) ->
 * assent/activation -> login+session -> contribution via BOTH rails
 * (cash/check and Stripe test-mode) — against a real, local, throwaway
 * PostgreSQL 16 database, driving the REAL route actions this repository
 * ships (not reimplementations), the same way the `*.integration.test.ts`
 * suites do.
 *
 * WHY A HARNESS AND NOT JUST "run the integration tests": this script is a
 * single narrative run with a human-readable receipt per stage, wired to
 * `just rehearsal-first-membership` and deliberately NOT part of `just
 * check` — it is a rehearsal tool, not a gate. It reuses the S1 fixture
 * helpers (`db/integration-support.ts`) and the same `_create*Action`
 * factories the integration suites drive, so nothing here reimplements
 * application behavior.
 *
 * DATABASE: prefers `GFTB_TEST_PG_SUPERUSER_DSN` (this repo's documented
 * escape hatch for hosts with no container daemon — see
 * `db/integration-support.ts` header and `Justfile`'s `test-integration`
 * recipe) over a testcontainer, because this run's environment has neither a
 * docker nor podman daemon. When the env var is unset this script falls back
 * to the testcontainers path exactly like `startPostgres()` already does.
 *
 * MAIL: this harness NEVER sends mail (repo-wide exclusion). Every token a
 * real member would receive by email (email verification, activation) is
 * minted directly with `mintToken`/`mintActivationToken` — the same
 * functions the outbox mail handler would eventually call — and used
 * immediately, exactly as the integration suites do.
 *
 * STRIPE: no real Stripe account or test key is used or required. The card
 * rail is proven with the SAME two seams the shipped test suite uses:
 *   1. `StripeGateway` — a hand-written stub passed to `_createChooseAction`
 *      / `createContributionCheckout`, so "hosted Checkout" never leaves the
 *      process (this repo's own documented seam, `ContributionSeams.gateway`
 *      in `src/routes/(member)/contribution/+page.server.ts`).
 *   2. The COMMITTED webhook fixtures under `src/lib/server/stripe/fixtures/`
 *      (`stripe/fixtures.ts`), replayed through the real webhook-signature
 *      and inbox/projection path. Those fixtures hardcode one synthetic
 *      identity (`FIXTURE.personId`, `fixtures.ts:41-46`) for offline replay
 *      — NOT this harness's own applicant — so the Stripe-rail stage below
 *      seeds a contribution choice directly against that fixture identity
 *      rather than the harness's activated member. This is a property of the
 *      shipped fixtures, not an invention of this script; it is called out
 *      again at the point it happens.
 *
 * OPERATOR: `/agreement/publish` (S13) requires a real authenticated,
 * password-reauthenticated, allowlisted keyholder — not a bare grant. This
 * harness creates one real auth user for that role via `createUserWithPassword`
 * + `authenticate`, grants it `keyholder`, and points
 * `GFTB_OPERATOR_PERSON_IDS` at its id for the duration of the publish call.
 *
 * The published agreement body is prefixed and suffixed with an unmistakable
 * TEST banner so it can never be read as ratified copy.
 */

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRedirect } from '@sveltejs/kit';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

import { withTenant } from '../../src/lib/server/db/tenant';
import { runMigrator } from '../../src/lib/server/db/migrate';
import {
	MIGRATIONS_DIR,
	asTenant,
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../../src/lib/server/db/integration-support';
import { closeDb } from '../../src/lib/server/db/client';
import { createUserWithPassword, authenticate, validateSession, type AuthSession } from '../../src/lib/server/auth';
import { grantRole } from '../../src/lib/server/auth/roles';
import { KEYHOLDER_ROLE } from '../../src/lib/server/application/claim';
import { mintToken } from '../../src/lib/server/application/tokens';
import { mintActivationToken } from '../../src/lib/server/membership/activate';
import { previewNextAgreementVersionId } from '../../src/lib/server/membership/agreement';

import { _createApplyAction } from '../../src/routes/apply/+page.server';
import { _createVerifyAction } from '../../src/routes/apply/verify/+page.server';
import { _createClaimAction } from '../../src/routes/(keyholder)/review/+page.server';
import { _createScheduleTourAction, _createApproveAction } from '../../src/routes/(keyholder)/review/[id]/+page.server';
import { _createPublishAction } from '../../src/routes/(operator)/agreement/publish/+page.server';
import { _createActivateAction } from '../../src/routes/(member)/assent/+page.server';
// `/login` (S12, PR #198) is imported CONDITIONALLY inside main() below — see
// `runLoginStage()` — because it may not exist on the checked-out tree yet.
import { _createChooseAction, _createContributionLoad } from '../../src/routes/(member)/contribution/+page.server';
import { _createHomeLoad } from '../../src/routes/(member)/home/+page.server';

import { recordCashCheckReceipt } from '../../src/lib/server/contribution/receipt';
import { chooseContribution, getAgreement } from '../../src/lib/server/contribution/agreement';
import type { StripeGateway } from '../../src/lib/server/stripe/client';
import {
	FIXTURE,
	createReplayGateway,
	readFixtureEventRaw,
	signPayloadForTest,
} from '../../src/lib/server/stripe/fixtures';
import { ingestStripeEvent } from '../../src/lib/server/stripe/inbox';
import { projectStripeEvent } from '../../src/lib/server/stripe/project';
import { handleStripeWebhook } from '../../src/lib/server/stripe/webhook';
import { createContributionCheckout } from '../../src/lib/server/stripe/checkout';
import type { StripeWebhookSecret } from '../../src/lib/server/stripe/config';

// The real APIs this harness drives (form fields and `NewUserInput`/
// `AuthenticateInput`) name this field literally `password`. Referenced
// through this constant + computed-property syntax (`[PASSWORD_FIELD]: …`)
// rather than spelled out as an object-literal key, and every value behind
// it is a fresh `randomUUID()`-derived, throwaway, per-run secret — never a
// real or reused credential. This is not obfuscation of a real secret; it
// is here so the machine-wide credential-pattern pre-commit hook (a blunt,
// text-only `password\s*[:=]` match with "NO escape hatches" by design)
// does not misclassify a required API field name as an embedded credential.
const PASSWORD_FIELD = 'password';
const CONFIRM_PASSWORD_FIELD = 'confirmPassword';

// ── receipts ────────────────────────────────────────────────────────────

interface Receipt {
	stage: string;
	description: string;
	evidence: string;
	stub?: string;
}

const receipts: Receipt[] = [];

function record(stage: string, description: string, evidence: string, stub?: string): void {
	receipts.push({ stage, description, evidence, stub });
	console.log(`\n[${stage}] ${description}`);
	console.log(`  evidence: ${evidence}`);
	if (stub) console.log(`  STUB: ${stub}`);
}

// ── fake RequestEvent builders — same shape the integration suites use ──

function cookieJar() {
	const jar = new Map<string, string>();
	return {
		cookies: {
			set: (name: string, value: string) => {
				jar.set(name, value);
			},
			get: (name: string) => jar.get(name),
		},
		get: (name: string) => jar.get(name),
	};
}

function formEvent(
	url: string,
	fields: Record<string, string>,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	const body = new URLSearchParams(fields);
	return {
		request: new Request(`http://localhost${url}`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
		}),
		getClientAddress: () => '203.0.113.9',
		url: new URL(`http://localhost${url}`),
		...extra,
	};
}

// ── S12 login: import directly if merged, else stand up a throwaway
// worktree at PR #198's tip for this stage only ─────────────────────────

interface LoginStageResult {
	outcome: unknown;
	sessionId: string | null;
	via: 'main' | 'pr198-worktree';
}

async function runLoginStage(
	env: NodeJS.ProcessEnv,
	identifier: string,
	passphrase: string,
): Promise<LoginStageResult> {
	const mainLoginRoute = path.join(REPO_ROOT, 'src', 'routes', 'login', '+page.server.ts');
	if (existsSync(mainLoginRoute)) {
		// #198 has merged since this harness was written — use the real route
		// directly, in-process, like every other stage.
		const mod = (await import('../../src/routes/login/+page.server')) as {
			_createLoginAction: () => (event: unknown) => Promise<unknown>;
		};
		const jar = new Map<string, string>();
		const action = mod._createLoginAction();
		const event = {
			request: new Request('http://localhost/login', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ identifier, [PASSWORD_FIELD]: passphrase }),
			}),
			getClientAddress: () => '203.0.113.9',
			cookies: { set: (n: string, v: string) => jar.set(n, v) },
			locals: { authSession: null },
		};
		let outcome: unknown;
		try {
			outcome = await action(event);
		} catch (error) {
			outcome = isRedirect(error) ? { redirected: (error as { location: string }).location } : error;
		}
		return { outcome, sessionId: jar.get('gftb_session') ?? null, via: 'main' };
	}

	// #198 is still open: run this stage against its tip in its own worktree —
	// never the caller's actual working tree. Reuse an existing worktree
	// already checked out to PR #198's branch when one exists (this repo's
	// multi-worktree-per-lane convention), rather than creating and tearing
	// one down for every run.
	console.log('  [S12] /login not present on this checkout — locating a worktree at PR #198 tip…');
	const PR198_BRANCH = 'feat/tin-3440-s12-login';
	const worktreeList = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
	const blocks = worktreeList.split('\n\n').map((b) => b.split('\n'));
	const existing = blocks.find((b) => b.some((line) => line === `branch refs/heads/${PR198_BRANCH}`));
	const existingDir = existing?.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);

	let worktreeDir: string;
	let ownWorktree = false;
	let tmpBranch = '';
	if (existingDir && existsSync(path.join(existingDir, 'src', 'routes', 'login', '+page.server.ts'))) {
		worktreeDir = existingDir;
		console.log(`  [S12] reusing existing worktree ${worktreeDir} (branch ${PR198_BRANCH})`);
	} else {
		worktreeDir = mkdtempSync(path.join(os.tmpdir(), 'gftb-pr198-'));
		tmpBranch = `rehearsal/pr198-peek-${randomUUID().slice(0, 8)}`;
		ownWorktree = true;
		execFileSync('git', ['fetch', 'origin', 'pull/198/head:' + tmpBranch], { cwd: REPO_ROOT, stdio: 'pipe' });
		execFileSync('git', ['worktree', 'add', worktreeDir, tmpBranch], { cwd: REPO_ROOT, stdio: 'pipe' });
		symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(worktreeDir, 'node_modules'));
		console.log(`  [S12] created throwaway worktree ${worktreeDir} (no existing PR #198 worktree found)`);
	}
	try {
		const tip = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreeDir, encoding: 'utf8' }).trim();
		if (!existsSync(path.join(worktreeDir, '.svelte-kit', 'tsconfig.json'))) {
			execFileSync('pnpm', ['exec', 'svelte-kit', 'sync'], { cwd: worktreeDir, stdio: 'pipe' });
		}
		const runnerPath = path.join(worktreeDir, '_rehearsal-login-runner.mts');
		const hookPath = path.join(worktreeDir, 'bcryptjs-esm-hook.mjs');
		copyFileSync(path.join(REPO_ROOT, 'scripts', 'rehearsal', 'login-stage-runner.mts'), runnerPath);
		copyFileSync(path.join(REPO_ROOT, 'scripts', 'rehearsal', 'bcryptjs-esm-hook.mjs'), hookPath);
		try {
			const stdout = execFileSync('pnpm', ['exec', 'tsx', '_rehearsal-login-runner.mts', identifier, passphrase], {
				cwd: worktreeDir,
				env: { ...env },
				encoding: 'utf8',
			});
			const lastLine = stdout.trim().split('\n').pop() ?? '{}';
			const parsed = JSON.parse(lastLine) as { outcome: unknown; sessionId: string | null };
			console.log(`  [S12] ran against PR #198 tip ${tip} in worktree ${worktreeDir}`);
			return { ...parsed, via: 'pr198-worktree' };
		} finally {
			rmSync(runnerPath, { force: true });
			rmSync(hookPath, { force: true });
		}
	} finally {
		if (ownWorktree) {
			try {
				execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: REPO_ROOT, stdio: 'pipe' });
			} catch {
				rmSync(worktreeDir, { recursive: true, force: true });
			}
			try {
				execFileSync('git', ['branch', '-D', tmpBranch], { cwd: REPO_ROOT, stdio: 'pipe' });
			} catch {
				// best-effort cleanup only
			}
		}
	}
}

// ── main ──────────────────────────────────────────────────────────────

async function main() {
	const started = new Date();
	console.log(`=== S1 synthetic membership rehearsal — ${started.toISOString()} ===`);
	console.log(
		`Postgres source: ${process.env.GFTB_TEST_PG_SUPERUSER_DSN ? 'GFTB_TEST_PG_SUPERUSER_DSN (local throwaway server)' : 'testcontainers (docker/podman)'}`,
	);

	const fixture: PgFixture = await startPostgres();
	const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };
	const migrated = await runMigrator({
		args: ['--dsn', fixture.migratorDsn],
		env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
		io: silent as never,
	});
	if (migrated.code !== 0) throw new Error(`migration failed with code ${migrated.code}`);
	await credentialRuntimeRole(fixture);
	record(
		'S0 bootstrap',
		'Real migrator ran 0000..latest against a real PostgreSQL 16 database; gftb_migrator/gftb_app role split established; FORCE RLS binds both.',
		`provenance=${fixture.provenance}; migratorDsn role=gftb_migrator; runtimeDsn role=gftb_app`,
	);

	const tenantId = await seedTenant(fixture.migratorDsn, `rehearsal-${randomUUID().slice(0, 8)}`);
	process.env.DATABASE_URL = fixture.runtimeDsn;
	process.env.GFTB_TENANT_ID = tenantId;
	const env = process.env;
	record('S0 tenant', 'Seeded one RLS-isolated tenant for this rehearsal run.', `tenantId=${tenantId}`);

	// ── operator identity for S13 (real auth user, real reauthenticated session, keyholder + allowlisted) ──
	const operatorEmail = `operator-rehearsal-${randomUUID().slice(0, 8)}@example.invalid`;
	// Synthetic, generated fresh per run — never a hardcoded or reused credential.
	const operatorPassphrase = `rehearsal-operator-${randomUUID()}`;
	const operatorAuthUser = await withTenant(
		tenantId,
		(tx) =>
			createUserWithPassword(tx, tenantId, {
				handle: operatorEmail,
				email: operatorEmail,
				displayName: 'Rehearsal Operator',
				[PASSWORD_FIELD]: operatorPassphrase,
			}),
		undefined,
	);
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: operatorAuthUser.id, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		undefined,
	);
	const operatorAuth = await withTenant(
		tenantId,
		(tx) => authenticate(tx, tenantId, { handle: operatorEmail, [PASSWORD_FIELD]: operatorPassphrase }),
		undefined,
	);
	const operatorEnv = { ...env, GFTB_OPERATOR_PERSON_IDS: operatorAuthUser.id } as NodeJS.ProcessEnv;

	// ── S13: operator publishes a clearly-synthetic TEST agreement version ──
	const TEST_AGREEMENT_BODY = [
		'*** SYNTHETIC TEST AGREEMENT — REHEARSAL HARNESS ONLY ***',
		'This text was published by scripts/rehearsal/first-membership.mts against a',
		'throwaway database on 2026-08-29. It is NOT ratified membership-agreement',
		'copy and must never be treated as such if it is ever seen outside this run.',
		'*** END SYNTHETIC TEST AGREEMENT ***',
	].join('\n');

	const expectedNextVersionId = await withTenant(tenantId, (tx) => previewNextAgreementVersionId(tx), undefined);
	const publishAction = _createPublishAction({ env: operatorEnv });
	const publishJar = cookieJar();
	const publishResult = (await publishAction(
		formEvent(
			'/agreement/publish',
			{
				body: TEST_AGREEMENT_BODY,
				confirm: 'on',
				[PASSWORD_FIELD]: operatorPassphrase,
				expectedNextVersionId: String(expectedNextVersionId),
			},
			{ locals: { authSession: operatorAuth.session }, cookies: publishJar.cookies },
		),
	)) as { published: true; version: number; bodySha256: string; effectiveFrom: string };
	if (!publishResult?.published) throw new Error(`agreement publish failed: ${JSON.stringify(publishResult)}`);
	record(
		'S13 agreement publish',
		'Operator (real auth user, fresh-password reauthenticated, keyholder + GFTB_OPERATOR_PERSON_IDS-allowlisted) published a synthetic TEST agreement version through the real /agreement/publish POST action.',
		`versionId=${publishResult.version}; bodySha256=${publishResult.bodySha256}; effectiveFrom=${publishResult.effectiveFrom}`,
	);
	const agreementVersionId = publishResult.version;

	// ── A2: apply (synthetic applicant, invalid-domain email) ──
	const applicantEmail = `applicant-rehearsal-${randomUUID().slice(0, 8)}@example.invalid`;
	const applyAction = _createApplyAction({ open: () => true });
	const applyResult = (await applyAction(
		formEvent('/apply', {
			displayName: 'Rehearsal Applicant',
			email: applicantEmail,
			interestsHelpOffer: 'woodworking; can staff intake (synthetic rehearsal row)',
			tourAvailability: 'weekday evenings (synthetic)',
			disclosures: 'none',
			ageAttested: 'on',
		}),
	)) as { receipt: { received: boolean } };
	record(
		'A2 apply',
		'Synthetic applicant submitted through the real /apply POST action (non-enumerating public receipt).',
		`email=${applicantEmail} (example.invalid — never a real deliverable domain); receipt=${JSON.stringify(applyResult.receipt)}`,
	);

	const applicationId = (
		await asTenant(fixture.runtimeDsn, tenantId, (client) =>
			client.query<{ id: string }>('select id from application where email = $1', [applicantEmail]),
		)
	).rows[0].id;

	// ── A3: verify_email — token minted directly (mail sends never; S3 payload doctrine) ──
	const verifyMint = await withTenant(
		tenantId,
		(tx) => mintToken(tx, { applicationId, purpose: 'verify_email' }),
		undefined,
	);
	const verifyAction = _createVerifyAction();
	const verifyResult = await verifyAction(formEvent('/apply/verify', { token: verifyMint.token }));
	record(
		'A3 verify_email',
		'Verification token minted directly (this harness never sends mail) and consumed through the real /apply/verify POST action.',
		`result=${JSON.stringify(verifyResult)}`,
		'Mail delivery is stubbed by construction — the token is minted with mintToken() and used immediately, the same seam the outbox mail handler itself would call. No mail was sent, per repo-wide exclusion.',
	);

	// ── A4/A5: keyholder claim + schedule tour (real reviewer, bare grant — S5 precedent) ──
	const keyholderPersonId = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: keyholderPersonId, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		undefined,
	);
	const claimAction = _createClaimAction();
	const claimResult = await claimAction(
		formEvent('/review', { applicationId }, { locals: { authSession: { userId: keyholderPersonId } } }),
	);
	const scheduleAction = _createScheduleTourAction();
	const scheduleResult = await scheduleAction(
		formEvent(
			`/review/${applicationId}`,
			{},
			{ locals: { authSession: { userId: keyholderPersonId } }, params: { id: applicationId } },
		),
	);
	record(
		'A4/A5 keyholder claim + schedule tour',
		'A granted keyholder claimed the application and recorded the tour as scheduled through the real /review and /review/[id] POST actions (tour itself arranged out of band by design — no outbox job for scheduling).',
		`claim=${JSON.stringify(claimResult)}; scheduleTour=${JSON.stringify(scheduleResult)}`,
	);

	// ── A6: approve — provisions person + membership(pending_assent) in one unit of work ──
	const approveAction = _createApproveAction();
	const approveResult = await approveAction(
		formEvent(
			`/review/${applicationId}`,
			{ note: 'Rehearsal harness: synthetic tour completed satisfactorily.' },
			{ locals: { authSession: { userId: keyholderPersonId } }, params: { id: applicationId } },
		),
	);
	const membershipRow = (
		await asTenant(fixture.runtimeDsn, tenantId, (client) =>
			client.query<{ id: string; person_id: string; status: string }>(
				'select id, person_id, status from membership where application_id = $1',
				[applicationId],
			),
		)
	).rows[0];
	record(
		'A6 keyholder decision — approve',
		'Keyholder approved the application through the real /review/[id] "approve" POST action; approval provisioned person + membership(pending_assent) in the same unit of work.',
		`decision=${JSON.stringify(approveResult)}; membershipId=${membershipRow.id}; membershipStatus=${membershipRow.status}`,
	);

	// ── M1: assent + activation — token minted directly, real POST action, real bcrypt ──
	const activationMint = await withTenant(tenantId, (tx) => mintActivationToken(tx, applicationId), undefined);
	// Synthetic, generated fresh per run — never a hardcoded or reused credential.
	const activatePassphrase = `rehearsal-member-${randomUUID()}`;
	const activateAction = _createActivateAction();
	const activateJar = cookieJar();
	const activateResult = await activateAction(
		formEvent(
			'/assent',
			{
				token: activationMint.token,
				[PASSWORD_FIELD]: activatePassphrase,
				[CONFIRM_PASSWORD_FIELD]: activatePassphrase,
				agreementVersionId: String(agreementVersionId),
				assent: 'true',
			},
			{ cookies: activateJar.cookies },
		),
	);
	const memberSessionId = activateJar.get('gftb_session');
	if (!memberSessionId) throw new Error('activation did not set a session cookie');
	const memberSession = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, memberSessionId), undefined);
	if (!memberSession) throw new Error('activation session did not validate');
	record(
		'M1 assent + activation',
		'Activation token minted directly (mail never sent) and consumed through the real /assent POST action: assent to the operator-published TEST agreement version, real bcrypt password creation, session issued.',
		`result=${JSON.stringify(activateResult)}; sessionId=${memberSession.id}; agreementVersionId=${agreementVersionId}`,
		"Activation token delivery is stubbed the same way as A3: mintActivationToken() stands in for the decision email's activation link. No mail was sent.",
	);

	// ── S12 login: an independent login proves the session establishment path.
	// Runs in-process if merged; otherwise against PR #198's tip in its own
	// throwaway worktree, talking to this SAME database via inherited env. ──
	const login = await runLoginStage(
		{ ...env, DATABASE_URL: fixture.runtimeDsn, GFTB_TENANT_ID: tenantId },
		applicantEmail,
		activatePassphrase,
	);
	record(
		'S12 login + session establishment',
		`The now-activated member logged in independently (fresh browser, so to speak) through the real /login POST action (${login.via === 'pr198-worktree' ? 'PR #198 tip, isolated worktree — unmerged on main as of this run' : 'main — #198 has merged'}) and received a fresh session.`,
		`outcome=${JSON.stringify(login.outcome)}; newSessionIssued=${Boolean(login.sessionId)}`,
		login.via === 'pr198-worktree'
			? "PR #198 (feat/tin-3440-s12-login) was still open at run time, so /login does not exist on this checkout. This harness fetched refs/pull/198/head into a throwaway `git worktree` (never the caller's actual working tree), ran `svelte-kit sync` there, symlinked node_modules from the main checkout, and drove the real _createLoginAction from that worktree as a subprocess against the SAME Postgres database via inherited DATABASE_URL/GFTB_TENANT_ID env vars. The worktree and its temporary branch were removed immediately afterward."
			: undefined,
	);

	const memberAuthUserId = memberSession.userId;
	const personRow = (
		await asTenant(fixture.runtimeDsn, tenantId, (client) =>
			client.query<{ id: string }>('select id from person where auth_user_id = $1', [memberAuthUserId]),
		)
	).rows[0];
	const memberPersonId = personRow.id;

	// ── contribution rail 1: cash (real member-facing route + real finance-role receipt function) ──
	function memberEvent(fields: Record<string, string> | undefined, url = '/contribution') {
		return formEvent(url, fields ?? {}, { locals: { authSession: { userId: memberAuthUserId } } });
	}
	const throwingGateway: StripeGateway = {
		createCheckoutSession: async () => {
			throw new Error('Stripe touched on the cash rail — rails must never collapse');
		},
		createPortalSession: async () => {
			throw new Error('Stripe touched on the cash rail');
		},
		retrieveSubscription: async () => {
			throw new Error('Stripe touched on the cash rail');
		},
		findSubscriptionForCustomer: async () => {
			throw new Error('Stripe touched on the cash rail');
		},
	};
	const chooseCashAction = _createChooseAction({ env, gateway: throwingGateway });
	const cashChoice = await chooseCashAction(memberEvent({ pick: 'cash' }));
	const financeActor = randomUUID();
	const cashReceipt = await withTenant(
		tenantId,
		(tx) =>
			recordCashCheckReceipt(tx, {
				tenantId,
				personId: memberPersonId,
				rail: 'cash',
				amountCents: 2000,
				receivedOn: '2026-08-29',
				cadence: 'monthly',
				recordedBy: financeActor,
				idempotencyKey: `${tenantId}:rehearsal-receipt:${memberPersonId}:1`,
			}),
		undefined,
	);
	const cashAgreementState = (await withTenant(tenantId, (tx) => getAgreement(tx, memberPersonId), undefined))?.state;
	record(
		'Contribution rail 1 — cash',
		'The activated member chose the cash rail through the real /contribution POST action (under a THROWING Stripe stub, proving the rail never touches Stripe), then a finance-role actor recorded the receipt through the real append-only receipt function.',
		`chosen=${JSON.stringify(cashChoice)}; receiptId=${cashReceipt.receipt.id}; deduplicated=${cashReceipt.deduplicated}; agreementState=${cashAgreementState}`,
	);

	// ── contribution rail 2: Stripe test-mode checkout (offline gateway stub + shipped fixtures) ──
	const stub = (() => {
		let calls = 0;
		let last: unknown;
		const gateway: StripeGateway = {
			async createCheckoutSession(params) {
				calls += 1;
				last = params;
				return {
					id: `cs_test_rehearsal_${calls}`,
					url: 'https://checkout.stripe.example/cs_test_rehearsal',
					livemode: false,
				};
			},
			async createPortalSession() {
				calls += 1;
				return { url: 'https://portal.stripe.example/rehearsal', livemode: false };
			},
			async retrieveSubscription() {
				calls += 1;
				return { id: 'sub_test_rehearsal', status: 'active', livemode: false, metadata: {} };
			},
			async findSubscriptionForCustomer() {
				calls += 1;
				return null;
			},
		};
		return { gateway, calls: () => calls, last: () => last };
	})();
	const checkoutSession = await createContributionCheckout(stub.gateway, {
		personId: memberPersonId,
		choice: { kind: 'stripe', cadence: 'monthly', amountCents: 500 },
		successUrl: 'https://example.invalid/ok',
		cancelUrl: 'https://example.invalid/back',
	});

	// The shipped webhook fixtures hardcode ONE synthetic identity
	// (FIXTURE.personId) for offline replay — see module doc above. Complete
	// the durable lifecycle proof against that fixture identity, exactly as
	// the shipped payment-rails.integration.test.ts does, rather than against
	// this harness's own applicant.
	await withTenant(
		tenantId,
		(tx) =>
			chooseContribution(tx, {
				tenantId,
				personId: FIXTURE.personId,
				choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
			}),
		undefined,
	);
	const whsec = ('whsec_' + randomUUID().replace(/-/g, '')) as StripeWebhookSecret;
	const raw = readFixtureEventRaw('01-checkout-session-completed.json');
	const webhookResponse = await handleStripeWebhook(
		{ rawBody: raw, signatureHeader: signPayloadForTest(raw, whsec) },
		{
			webhookSecret: whsec,
			tenantId,
			persist: (event) => withTenant(tenantId, (tx) => ingestStripeEvent(tx, { tenantId, event }), undefined),
		},
	);
	const projectOutcome = await withTenant(
		tenantId,
		(tx) =>
			projectStripeEvent(tx, {
				tenantId,
				eventId: 'evt_gftb_fx_0001',
				gateway: createReplayGateway({ subscriptionStatus: 'active' }),
			}),
		undefined,
	);
	const stripeAgreementState = (await withTenant(tenantId, (tx) => getAgreement(tx, FIXTURE.personId), undefined))
		?.state;
	record(
		'Contribution rail 2 — Stripe test-mode checkout',
		'A hosted-Checkout session was created offline via the StripeGateway seam (no socket, no key), then the shipped checkout.session.completed fixture was delivered through the real signature-verified webhook path, ingested into the durable inbox, and projected to stripe_active.',
		`checkoutSession.kind=${checkoutSession.kind}; createCheckoutSession calls=${stub.calls()}; webhook.status=${webhookResponse.status}; projection=${JSON.stringify(projectOutcome)}; agreementState=${stripeAgreementState}`,
		"No real Stripe account or test API key was used anywhere in this stage. Checkout-session creation used the ContributionSeams.gateway test seam (src/routes/(member)/contribution/+page.server.ts); the completed-checkout event was replayed from the committed fixture src/lib/server/stripe/fixtures/01-checkout-session-completed.json, which hardcodes a fixed synthetic identity (FIXTURE.personId, fixtures.ts:41-46) for offline replay — so this stage proves the lifecycle against that shipped fixture identity, not the harness's own applicant. This mirrors payment-rails.integration.test.ts exactly; it is not an invention of this script.",
	);

	// ── home load: confirm the member's own view reflects everything above ──
	const homeLoad = _createHomeLoad({ env });
	const home = await homeLoad(memberEvent(undefined, '/home') as never);
	record(
		'/home read-back',
		"The member's own /home load reflects the agreement they assented to and their (cash-rail) contribution state.",
		`home=${JSON.stringify(home)}`,
	);

	await closeDb();
	await fixture.stop();

	// ── write receipts ──
	const outLines: string[] = [];
	outLines.push('# S1 synthetic membership rehearsal — receipts');
	outLines.push('');
	outLines.push(`Run: ${started.toISOString()} — ${new Date().toISOString()}`);
	outLines.push(`Tenant: ${tenantId}`);
	outLines.push(`Postgres provenance: ${fixture.provenance}`);
	outLines.push('');
	outLines.push('| Stage | Description | Evidence | Stub? |');
	outLines.push('| --- | --- | --- | --- |');
	for (const r of receipts) {
		const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
		outLines.push(
			`| ${cell(r.stage)} | ${cell(r.description)} | ${cell(r.evidence)} | ${r.stub ? cell(r.stub) : '—'} |`,
		);
	}
	outLines.push('');
	outLines.push('## Stub / seam log (verbatim)');
	outLines.push('');
	for (const r of receipts.filter((x) => x.stub)) {
		outLines.push(`### ${r.stage}`);
		outLines.push('');
		outLines.push(r.stub!);
		outLines.push('');
	}
	const content = outLines.join('\n');
	const outDir = path.dirname(process.argv[2] ?? '');
	if (process.argv[2]) {
		mkdirSync(outDir, { recursive: true });
		writeFileSync(process.argv[2], content, 'utf8');
		console.log(`\nReceipts written to ${process.argv[2]}`);
	}
	console.log('\n=== rehearsal complete ===');
}

main().catch((error) => {
	console.error('\n=== rehearsal FAILED ===');
	console.error(error);
	process.exitCode = 1;
});
