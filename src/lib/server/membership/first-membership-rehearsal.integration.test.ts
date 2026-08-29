/**
 * Launch-day Member v0 rehearsal.
 *
 * One in-process Vitest row drives the shipped HTTP action factories through
 * apply, review, activation, merged login, both contribution rails, and the
 * member home projection against PostgreSQL 16.15. Mail is never dispatched:
 * verification and activation tokens are minted and consumed directly. No
 * Stripe client is constructed: Checkout and subscription retrieval use the
 * committed replay seam, while the mutated fixture is re-signed locally.
 *
 * This is deliberately a manual, local, no-cache Bazel target. It is launch
 * evidence, not a default CI or Flywheel/RBE target.
 */

import { randomUUID } from 'node:crypto';
import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { closeDb } from '../db/client';
import { withTenant } from '../db/tenant';
import { runMigrator } from '../db/migrate';
import {
	MIGRATIONS_DIR,
	asTenant,
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../db/integration-support';
import { authenticate, createUserWithPassword, grantRole, validateSession } from '../auth';
import { KEYHOLDER_ROLE } from '../application/claim';
import { mintToken } from '../application/tokens';
import { recordCashCheckReceipt } from '../contribution/receipt';
import { getAgreement } from '../contribution/agreement';
import { mintActivationToken } from './activate';
import { previewNextAgreementVersionId } from './agreement';
import type { StripeGateway } from '../stripe/client';
import { FIXTURE, createReplayGateway, readFixtureEventRaw, signPayloadForTest } from '../stripe/fixtures';
import { ingestStripeEvent } from '../stripe/inbox';
import { projectStripeEvent } from '../stripe/project';
import { handleStripeWebhook } from '../stripe/webhook';
import type { StripeWebhookSecret } from '../stripe/config';
import { _createApplyAction } from '../../../routes/apply/+page.server';
import { _createVerifyAction } from '../../../routes/apply/verify/+page.server';
import { _createClaimAction } from '../../../routes/(keyholder)/review/+page.server';
import { _createApproveAction, _createScheduleTourAction } from '../../../routes/(keyholder)/review/[id]/+page.server';
import { _createPublishAction } from '../../../routes/(operator)/agreement/publish/+page.server';
import { _createActivateAction } from '../../../routes/(member)/assent/+page.server';
import { _createChooseAction } from '../../../routes/(member)/contribution/+page.server';
import { _createHomeLoad } from '../../../routes/(member)/home/+page.server';
import { _createLoginAction } from '../../../routes/login/+page.server';

const PASSWORD_FIELD = 'password';
const CONFIRM_PASSWORD_FIELD = 'confirmPassword';
const SESSION_COOKIE = 'gftb_session';
const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

function receipt(stage: string): void {
	// Stage names only: no identifiers, session ids, addresses, DSNs, tokens,
	// or action payloads enter the successful rehearsal log.
	console.info(`[first-membership-rehearsal] PASS ${stage}`);
}

function restoreEnv(name: string, previous: string | undefined): void {
	if (previous === undefined) delete process.env[name];
	else process.env[name] = previous;
}

function cookieJar() {
	const values = new Map<string, string>();
	return {
		cookies: {
			set: (name: string, value: string) => values.set(name, value),
			get: (name: string) => values.get(name),
		},
		get: (name: string) => values.get(name),
	};
}

function formEvent(
	pathname: string,
	fields: Record<string, string>,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	const url = new URL(`http://localhost${pathname}`);
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(fields),
		}),
		getClientAddress: () => '203.0.113.9',
		url,
		...extra,
	};
}

function memberEvent(authUserId: string, fields?: Record<string, string>, pathname = '/contribution') {
	return formEvent(pathname, fields ?? {}, { locals: { authSession: { userId: authUserId } } });
}

function throwingStripeGateway(): StripeGateway {
	const refuse = (): never => {
		throw new Error('Stripe gateway was touched on the cash rail');
	};
	return {
		createCheckoutSession: async () => refuse(),
		createPortalSession: async () => refuse(),
		retrieveSubscription: async () => refuse(),
		findSubscriptionForCustomer: async () => refuse(),
	};
}

type CheckoutParams = Parameters<StripeGateway['createCheckoutSession']>[0];

interface MutableCheckoutFixture {
	id: string;
	data: {
		object: {
			client_reference_id: string | null;
			metadata: Record<string, string>;
		};
	};
}

describe('first membership launch rehearsal', () => {
	it('drives one member through both rails and reads the exact durable end state', async () => {
		let fixture: PgFixture | undefined;
		const previousDatabaseUrl = process.env.DATABASE_URL;
		const previousTenantId = process.env.GFTB_TENANT_ID;

		try {
			fixture = await startPostgres();
			const migrated = await runMigrator({
				args: ['--dsn', fixture.migratorDsn],
				env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
				io: silent,
			});
			expect(migrated.code, '[S0 bootstrap] migrator must return zero').toBe(0);
			await credentialRuntimeRole(fixture);
			const serverVersion = await asTenant(fixture.runtimeDsn, null, async (client) => {
				const { rows } = await client.query<{ server_version_num: string }>('show server_version_num');
				return rows[0]?.server_version_num;
			});
			expect(serverVersion, '[S0 bootstrap] PostgreSQL must be exactly 16.15').toBe('160015');
			receipt('S0 bootstrap — PostgreSQL 16.15 + migrations');

			const tenantSlug = `rehearsal-${randomUUID().slice(0, 8)}`;
			const tenantId = await seedTenant(fixture.migratorDsn, tenantSlug);
			process.env.DATABASE_URL = fixture.runtimeDsn;
			process.env.GFTB_TENANT_ID = tenantId;
			const runtimeEnv = {
				DATABASE_URL: fixture.runtimeDsn,
				GFTB_TENANT_ID: tenantId,
			} as NodeJS.ProcessEnv;
			const seededTenant = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query<{ tenant_id: string; slug: string }>(
					'select tenant_id, slug from tenant where tenant_id = $1',
					[tenantId],
				);
				return rows[0];
			});
			expect(seededTenant?.tenant_id, '[S0 tenant] tenant id must read back under its own RLS context').toBe(tenantId);
			expect(seededTenant?.slug, '[S0 tenant] tenant slug must read back unchanged').toBe(tenantSlug);
			receipt('S0 tenant — RLS-scoped seed/read-back');

			// One real, freshly authenticated keyholder drives review and, only
			// after approval, the reauthenticated operator publish action.
			const operatorEmail = `operator-${randomUUID().slice(0, 8)}@example.invalid`;
			const operatorPassphrase = `rehearsal-operator-${randomUUID()}`;
			const operatorUser = await withTenant(tenantId, (tx) =>
				createUserWithPassword(tx, tenantId, {
					handle: operatorEmail,
					email: operatorEmail,
					displayName: 'Synthetic Rehearsal Operator',
					[PASSWORD_FIELD]: operatorPassphrase,
				}),
			);
			await withTenant(tenantId, (tx) =>
				grantRole(tx, tenantId, {
					personId: operatorUser.id,
					role: KEYHOLDER_ROLE,
					grantedBy: randomUUID(),
				}),
			);
			const operatorAuth = await withTenant(tenantId, (tx) =>
				authenticate(tx, tenantId, { handle: operatorEmail, [PASSWORD_FIELD]: operatorPassphrase }),
			);
			const operatorEnv = {
				...runtimeEnv,
				GFTB_OPERATOR_PERSON_IDS: operatorUser.id,
			} as NodeJS.ProcessEnv;

			// A2: submit one synthetic applicant through the public route.
			const applicantEmail = `applicant-${randomUUID().slice(0, 8)}@example.invalid`;
			const applyResult = (await _createApplyAction({ open: () => true, env: runtimeEnv })(
				formEvent('/apply', {
					displayName: 'Synthetic Rehearsal Applicant',
					email: applicantEmail,
					interestsHelpOffer: 'woodworking; can staff intake',
					tourAvailability: 'weekday evenings',
					disclosures: 'none',
					ageAttested: 'on',
				}) as never,
			)) as { receipt?: { received?: boolean } };
			expect(applyResult.receipt?.received, '[A2 apply] non-enumerating receipt must report received').toBe(true);
			const applications = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query<{ id: string; status: string }>(
					'select id, status from application where email = $1',
					[applicantEmail],
				);
				return rows;
			});
			expect(applications, '[A2 apply] exactly one durable application must exist').toHaveLength(1);
			expect(applications[0]?.status, '[A2 apply] durable state must be submitted').toBe('submitted');
			const applicationId = applications[0]!.id;
			receipt('A2 apply — public action + durable submitted row');

			// A3: mail remains excluded; mint and consume the same token the mail
			// carrier would have transported.
			const verification = await withTenant(tenantId, (tx) =>
				mintToken(tx, { applicationId, purpose: 'verify_email' }),
			);
			const verifyResult = await _createVerifyAction({ env: runtimeEnv })(
				formEvent('/apply/verify', { token: verification.token }) as never,
			);
			expect(
				(verifyResult as { verified?: boolean }).verified,
				'[A3 verify_email] verifyResult.verified must be true',
			).toBe(true);
			const verifiedStatus = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query<{ status: string }>('select status from application where id = $1', [
					applicationId,
				]);
				return rows[0]?.status;
			});
			expect(verifiedStatus, '[A3 verify_email] durable state must be email_verified').toBe('email_verified');
			receipt('A3 verify_email — direct token consumption, no mail');

			// A4/A5: the real authenticated keyholder claims and schedules.
			const reviewerLocals = { authSession: operatorAuth.session };
			const claimResult = await _createClaimAction({ env: runtimeEnv })(
				formEvent('/review', { applicationId }, { locals: reviewerLocals }) as never,
			);
			expect((claimResult as { claimed?: boolean }).claimed, '[A4 keyholder claim] claimed must be true').toBe(true);
			expect(
				(claimResult as { applicationId?: string }).applicationId,
				'[A4 keyholder claim] action must name the expected application',
			).toBe(applicationId);
			expect((claimResult as { replayed?: boolean }).replayed, '[A4 keyholder claim] first claim is not replayed').toBe(
				false,
			);
			receipt('A4 keyholder claim — expected application claimed');

			const scheduleResult = await _createScheduleTourAction({ env: runtimeEnv })(
				formEvent(`/review/${applicationId}`, {}, { locals: reviewerLocals, params: { id: applicationId } }) as never,
			);
			expect(
				(scheduleResult as { tourScheduled?: boolean }).tourScheduled,
				'[A5 schedule tour] tourScheduled must be true',
			).toBe(true);
			expect((scheduleResult as { status?: string }).status, '[A5 schedule tour] state must be tour_scheduled').toBe(
				'tour_scheduled',
			);
			receipt('A5 schedule tour — durable tour_scheduled state');

			// A6: approval must provision exactly one pending membership.
			const approveResult = await _createApproveAction({ env: runtimeEnv })(
				formEvent(
					`/review/${applicationId}`,
					{ note: 'Synthetic rehearsal tour completed.' },
					{ locals: reviewerLocals, params: { id: applicationId } },
				) as never,
			);
			expect((approveResult as { decided?: string }).decided, '[A6 approve] decided must be approved').toBe('approved');
			expect((approveResult as { replayed?: boolean }).replayed, '[A6 approve] first decision is not replayed').toBe(
				false,
			);
			const memberships = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query<{ id: string; person_id: string; status: string }>(
					'select id, person_id, status from membership where application_id = $1',
					[applicationId],
				);
				return rows;
			});
			expect(memberships, '[A6 approve] exactly one membership must be provisioned').toHaveLength(1);
			expect(memberships[0]?.status, '[A6 approve] provisioned membership must await assent').toBe('pending_assent');
			const membershipId = memberships[0]!.id;
			const memberPersonId = memberships[0]!.person_id;
			receipt('A6 approve — one pending_assent membership');

			// S13 comes after review because successful password reauthentication
			// rotates the operator session. The same real session therefore proves
			// review first, then publish, without a synthetic bare-grant reviewer.
			const expectedAgreementVersion = await withTenant(tenantId, (tx) => previewNextAgreementVersionId(tx));
			const agreementBody = [
				'*** SYNTHETIC TEST AGREEMENT — REHEARSAL ONLY ***',
				'This text exists only inside a throwaway PostgreSQL fixture.',
				'It is not ratified membership-agreement copy.',
				'*** END SYNTHETIC TEST AGREEMENT ***',
			].join('\n');
			const publishJar = cookieJar();
			const publishResult = (await _createPublishAction({ env: operatorEnv })(
				formEvent(
					'/agreement/publish',
					{
						body: agreementBody,
						confirm: 'on',
						[PASSWORD_FIELD]: operatorPassphrase,
						expectedNextVersionId: String(expectedAgreementVersion),
					},
					{ locals: { authSession: operatorAuth.session }, cookies: publishJar.cookies },
				) as never,
			)) as { published?: boolean; version?: number; bodySha256?: string; effectiveFrom?: string };
			expect(publishResult.published, '[S13 agreement publish] action must publish').toBe(true);
			expect(publishResult.version, '[S13 agreement publish] version must match the previewed next id').toBe(
				expectedAgreementVersion,
			);
			expect(publishResult.bodySha256, '[S13 agreement publish] receipt must carry a SHA-256 digest').toMatch(
				/^[0-9a-f]{64}$/,
			);
			expect(
				Number.isNaN(Date.parse(publishResult.effectiveFrom ?? '')),
				'[S13 agreement publish] effectiveFrom must be a valid timestamp',
			).toBe(false);
			receipt('S13 agreement publish — authorized synthetic version');

			// M1: mint the activation token directly (no mail), assent to the
			// published agreement, and validate the issued session.
			const activation = await withTenant(tenantId, (tx) => mintActivationToken(tx, applicationId));
			const memberPassphrase = `rehearsal-member-${randomUUID()}`;
			const activationJar = cookieJar();
			const activateResult = await _createActivateAction({ env: runtimeEnv })(
				formEvent(
					'/assent',
					{
						token: activation.token,
						[PASSWORD_FIELD]: memberPassphrase,
						[CONFIRM_PASSWORD_FIELD]: memberPassphrase,
						agreementVersionId: String(expectedAgreementVersion),
						assent: 'true',
					},
					{ cookies: activationJar.cookies },
				) as never,
			);
			expect((activateResult as { activated?: boolean }).activated, '[M1 activation] activated must be true').toBe(
				true,
			);
			expect(
				(activateResult as { replayed?: boolean }).replayed,
				'[M1 activation] first activation is not replayed',
			).toBe(false);
			const activationSessionId = activationJar.get(SESSION_COOKIE) ?? '';
			expect(activationSessionId, '[M1 activation] action must issue a session cookie').not.toBe('');
			const activationSession = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, activationSessionId));
			expect(activationSession, '[M1 activation] issued session must validate').not.toBeNull();
			const activatedMembership = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query<{ status: string; agreement_version_id: number }>(
					'select status, agreement_version_id from membership where id = $1',
					[membershipId],
				);
				return rows[0];
			});
			expect(activatedMembership?.status, '[M1 activation] durable membership must be active').toBe('active');
			expect(
				activatedMembership?.agreement_version_id,
				'[M1 activation] membership must bind the published agreement version',
			).toBe(expectedAgreementVersion);
			receipt('M1 activation — assent + active membership + valid session');

			// S12: merged login only, in-process. Both the redirect and the fresh
			// independently validated session are required evidence.
			const loginJar = cookieJar();
			const loginOutcome = await _createLoginAction({ env: runtimeEnv })(
				formEvent(
					'/login',
					{ identifier: applicantEmail, [PASSWORD_FIELD]: memberPassphrase },
					{ locals: { authSession: null }, cookies: loginJar.cookies },
				) as never,
			).catch((error) => error);
			expect(isRedirect(loginOutcome), '[S12 login redirect] login must redirect').toBe(true);
			expect((loginOutcome as { status?: number }).status, '[S12 login redirect] redirect status must be 303').toBe(
				303,
			);
			expect((loginOutcome as { location?: string }).location, '[S12 login redirect] destination must be /home').toBe(
				'/home',
			);
			receipt('S12 login redirect — merged route to /home');
			const loginSessionId = loginJar.get(SESSION_COOKIE) ?? '';
			expect(loginSessionId, '[S12 login session] login must issue a session cookie').not.toBe('');
			const loginSession = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, loginSessionId));
			expect(loginSession, '[S12 login session] new session must validate').not.toBeNull();
			expect(loginSession?.userId, '[S12 login session] new session must resolve to the activated auth user').toBe(
				activationSession?.userId,
			);
			const memberAuthUserId = loginSession!.userId;
			receipt('S12 login session — fresh validated member session');

			// Rail 1: the real contribution action records cash_pending while a
			// throwing gateway proves the rail cannot touch Stripe. The real finance
			// receipt transition must then land cash_recorded.
			const cashChoice = await _createChooseAction({ env: runtimeEnv, gateway: throwingStripeGateway() })(
				memberEvent(memberAuthUserId, { pick: 'cash' }) as never,
			);
			expect(cashChoice, '[cash route] real action must record cash_pending').toEqual({ chosen: 'cash_pending' });
			receipt('cash route — cash_pending with Stripe unreachable');
			const cashReceipt = await withTenant(tenantId, (tx) =>
				recordCashCheckReceipt(tx, {
					tenantId,
					personId: memberPersonId,
					rail: 'cash',
					amountCents: 2000,
					receivedOn: '2026-08-29',
					cadence: 'monthly',
					recordedBy: randomUUID(),
					idempotencyKey: `${tenantId}:rehearsal-cash:${memberPersonId}`,
				}),
			);
			expect(cashReceipt.deduplicated, '[cash state] first receipt must not be a replay').toBe(false);
			const cashAgreement = await withTenant(tenantId, (tx) => getAgreement(tx, memberPersonId));
			expect(cashAgreement?.state, '[cash state] agreement must be cash_recorded').toBe('cash_recorded');
			receipt('cash state — append-only receipt projected cash_recorded');

			// Rail 2 revises THE SAME agreement through the real route. The replay
			// gateway captures Checkout metadata and later returns the same member
			// identity from retrieveSubscription(), which projection prefers.
			const replayGateway = createReplayGateway({ subscriptionStatus: 'active' });
			let checkoutParams: CheckoutParams | undefined;
			let retrievedSubscriptionId: string | undefined;
			const sameMemberGateway: StripeGateway = {
				async createCheckoutSession(params) {
					checkoutParams = params;
					return replayGateway.createCheckoutSession(params);
				},
				createPortalSession: (...args) => replayGateway.createPortalSession(...args),
				async retrieveSubscription(subscriptionId) {
					retrievedSubscriptionId = subscriptionId;
					const replayed = await replayGateway.retrieveSubscription(subscriptionId);
					return { ...replayed, metadata: { gftb_person_id: memberPersonId } };
				},
				findSubscriptionForCustomer: (...args) => replayGateway.findSubscriptionForCustomer(...args),
			};
			const stripeOutcome = await _createChooseAction({ env: runtimeEnv, gateway: sameMemberGateway })(
				memberEvent(memberAuthUserId, { pick: 'preset:500' }) as never,
			).catch((error) => error);
			expect(isRedirect(stripeOutcome), '[Stripe route revision] real action must redirect to hosted Checkout').toBe(
				true,
			);
			expect(
				(stripeOutcome as { status?: number }).status,
				'[Stripe route revision] hosted Checkout redirect must use 303',
			).toBe(303);
			expect(
				(stripeOutcome as { location?: string }).location,
				'[Stripe route revision] redirect must use the replay Checkout URL',
			).toBe(`https://checkout.stripe.com/c/pay/${FIXTURE.checkoutSessionId}`);
			expect(
				(checkoutParams as CheckoutParams | undefined)?.client_reference_id,
				'[Stripe route revision] Checkout client_reference_id must name the same member',
			).toBe(memberPersonId);
			expect(
				(checkoutParams?.metadata as Record<string, string> | undefined)?.gftb_person_id,
				'[Stripe route revision] Checkout metadata must name the same member',
			).toBe(memberPersonId);
			expect(
				(checkoutParams?.subscription_data?.metadata as Record<string, string> | undefined)?.gftb_person_id,
				'[Stripe route revision] subscription metadata must name the same member',
			).toBe(memberPersonId);
			const stripePending = await withTenant(tenantId, (tx) => getAgreement(tx, memberPersonId));
			expect(stripePending?.id, '[Stripe route revision] cash and Stripe must revise one agreement row').toBe(
				cashAgreement?.id,
			);
			expect(stripePending?.state, '[Stripe route revision] route must land stripe_pending').toBe('stripe_pending');
			expect(
				(stripePending?.version ?? 0) > (cashAgreement?.version ?? 0),
				'[Stripe route revision] revision must increment the agreement version',
			).toBe(true);
			receipt('Stripe route revision — same agreement moved to stripe_pending');

			// Mutate BOTH identity fields in the committed checkout fixture, then
			// sign those exact bytes. Projection still requires the independently
			// rewritten retrieveSubscription metadata above.
			const checkoutFixture = JSON.parse(
				readFixtureEventRaw('01-checkout-session-completed.json'),
			) as MutableCheckoutFixture;
			expect(
				checkoutFixture.data.object.client_reference_id,
				'[Stripe webhook] control fixture must begin with the committed fixture identity',
			).toBe(FIXTURE.personId);
			expect(
				checkoutFixture.data.object.metadata.gftb_person_id,
				'[Stripe webhook] control fixture metadata must begin with the committed fixture identity',
			).toBe(FIXTURE.personId);
			checkoutFixture.id = `evt_rehearsal_${randomUUID().replace(/-/g, '')}`;
			checkoutFixture.data.object.client_reference_id = memberPersonId;
			checkoutFixture.data.object.metadata.gftb_person_id = memberPersonId;
			const signedRaw = JSON.stringify(checkoutFixture);
			const webhookSecret = `whsec_${randomUUID().replace(/-/g, '')}` as StripeWebhookSecret;
			const webhookResponse = await handleStripeWebhook(
				{ rawBody: signedRaw, signatureHeader: signPayloadForTest(signedRaw, webhookSecret) },
				{
					webhookSecret,
					tenantId,
					persist: (event) => withTenant(tenantId, (tx) => ingestStripeEvent(tx, { tenantId, event })),
				},
			);
			expect(webhookResponse.status, '[Stripe webhook] signature-verified delivery must return 200').toBe(200);
			expect(webhookResponse.body.received, '[Stripe webhook] signed event must be durably received').toBe(true);
			receipt('Stripe webhook — mutated same-member fixture re-signed and persisted');

			const projection = await withTenant(tenantId, (tx) =>
				projectStripeEvent(tx, {
					tenantId,
					eventId: checkoutFixture.id,
					gateway: sameMemberGateway,
				}),
			);
			expect(retrievedSubscriptionId, '[Stripe projection] projector must retrieve the fixture subscription').toBe(
				FIXTURE.subscriptionId,
			);
			expect(projection.action, '[Stripe projection] action must be projected').toBe('projected');
			expect(projection.personId, '[Stripe projection] projection must resolve the same member').toBe(memberPersonId);
			expect(projection.state, '[Stripe projection] state must be stripe_active').toBe('stripe_active');
			const stripeActive = await withTenant(tenantId, (tx) => getAgreement(tx, memberPersonId));
			expect(stripeActive?.id, '[Stripe projection] projection must retain the same agreement row').toBe(
				cashAgreement?.id,
			);
			expect(stripeActive?.state, '[Stripe projection] durable agreement must be stripe_active').toBe('stripe_active');
			const inboxProof = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query<{
					processed_at: Date | null;
					client_reference_id: string | null;
					metadata_person_id: string | null;
				}>(
					`select processed_at,
						        payload #>> '{data,object,client_reference_id}' as client_reference_id,
						        payload #>> '{data,object,metadata,gftb_person_id}' as metadata_person_id
						 from stripe_event_inbox where event_id = $1`,
					[checkoutFixture.id],
				);
				return rows[0];
			});
			expect(inboxProof?.processed_at, '[Stripe projection] inbox row must be stamped processed').not.toBeNull();
			expect(
				inboxProof?.client_reference_id,
				'[Stripe projection] signed payload client_reference_id must be the same member',
			).toBe(memberPersonId);
			expect(
				inboxProof?.metadata_person_id,
				'[Stripe projection] signed payload metadata must be the same member',
			).toBe(memberPersonId);
			const survivingCashReceipts = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query<{ rail: string; amount_cents: number }>(
					'select rail, amount_cents from finance_receipt where person_id = $1 order by created_at, id',
					[memberPersonId],
				);
				return rows;
			});
			expect(
				survivingCashReceipts,
				'[Stripe projection] prior append-only cash receipt must survive the Stripe revision',
			).toEqual([{ rail: 'cash', amount_cents: 2000 }]);
			receipt('Stripe projection — same member reached durable stripe_active');

			// Final member-owned readback: active membership, exact agreement,
			// and the Stripe state produced above. No session id is logged.
			const home = await _createHomeLoad({ env: runtimeEnv })(
				memberEvent(memberAuthUserId, undefined, '/home') as never,
			);
			expect(home.available, '[/home] runtime must be available').toBe(true);
			expect(home.authenticated, '[/home] login session must authenticate').toBe(true);
			expect(home.member?.membership.status, '[/home] membership must remain active').toBe('active');
			expect(home.member?.agreement?.versionId, '[/home] exact assented agreement must be visible').toBe(
				expectedAgreementVersion,
			);
			expect(home.member?.contribution.state, '[/home] contribution must read back stripe_active').toBe(
				'stripe_active',
			);
			expect(home.member?.contribution.rail, '[/home] contribution rail must be stripe').toBe('stripe');
			expect(home.member?.contribution.cadence, '[/home] contribution cadence must be monthly').toBe('monthly');
			expect(home.member?.contribution.amountCents, '[/home] contribution amount must be the $5 preset').toBe(500);
			receipt('/home — active membership + exact agreement + stripe_active');
		} finally {
			try {
				await closeDb();
			} finally {
				restoreEnv('DATABASE_URL', previousDatabaseUrl);
				restoreEnv('GFTB_TENANT_ID', previousTenantId);
				await fixture?.stop();
			}
		}
	}, 300_000);
});
