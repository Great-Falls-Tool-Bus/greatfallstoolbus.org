/**
 * Stripe runtime configuration — TEST MODE BY CONSTRUCTION (TIN-3818;
 * ADR 0016 §3 Card C, spec §5 production activation gate).
 *
 * This module is the first of the two independent refusals slices §1.11
 * requires: the configuration TYPE cannot carry a live key. A value that does
 * not start with the test-mode prefix is a thrown `StripeConfigError`, not a
 * warning — `sk_live_…`, a restricted `rk_…`, or anything else fails CLOSED
 * before a client exists to call anything. (The second refusal is the webhook
 * route rejecting `livemode: true` events; see `./gate.ts`.)
 *
 * NAMES ONLY, NEVER VALUES (ADR 0014 §0.2 — this repository is public):
 *
 *   STRIPE_SECRET_KEY       must start `sk_test_`  (server-side API key)
 *   STRIPE_WEBHOOK_SECRET   must start `whsec_`    (endpoint signing secret)
 *   STRIPE_PUBLISHABLE_KEY  must start `pk_test_`  (optional; browser-side)
 *   GFTB_TENANT_ID          the configured tenant's uuid (webhook scoping)
 *
 * WHERE THE OPERATOR'S TEST KEY PLUGS IN. Jess keeps Stripe test keys in the
 * operator secret store (`../lab` sops — operator-only; agents never read or
 * decrypt it). Locally: export the three names above before `just dev` or a
 * gated test run; the gated live-test-mode row additionally reads
 * `STRIPE_TEST_KEY` (see `live-testmode.test.ts`). In-cluster:
 * `great-falls-tool-bus-infra` supplies the same three names to the web/worker
 * Deployments the way it already supplies `DATABASE_URL`. Absent all of them,
 * everything runs keyless against the committed fixtures.
 */

export const SECRET_KEY_TEST_PREFIX = 'sk_test_';
export const PUBLISHABLE_KEY_TEST_PREFIX = 'pk_test_';
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

export const SECRET_KEY_ENV = 'STRIPE_SECRET_KEY';
export const PUBLISHABLE_KEY_ENV = 'STRIPE_PUBLISHABLE_KEY';
export const WEBHOOK_SECRET_ENV = 'STRIPE_WEBHOOK_SECRET';
export const TENANT_ID_ENV = 'GFTB_TENANT_ID';

/** Thrown on any key that is present but not test-shaped. Never echoes the value. */
export class StripeConfigError extends Error {}

declare const brand: unique symbol;
/** A secret key PROVEN to carry the sk_test_ prefix — the only kind a client can be built from. */
export type StripeTestSecretKey = string & { readonly [brand]: 'StripeTestSecretKey' };
export type StripeWebhookSecret = string & { readonly [brand]: 'StripeWebhookSecret' };
export type StripeTestPublishableKey = string & { readonly [brand]: 'StripeTestPublishableKey' };

export interface StripeTestModeConfig {
	readonly mode: 'test';
	readonly secretKey: StripeTestSecretKey;
	readonly webhookSecret: StripeWebhookSecret;
	readonly publishableKey?: StripeTestPublishableKey;
}

export type StripeRuntimeConfig =
	{ readonly configured: false; readonly reason: string } | ({ readonly configured: true } & StripeTestModeConfig);

function requirePrefix(name: string, value: string, prefix: string): string {
	if (!value.startsWith(prefix)) {
		// Deliberately does NOT include the value, its prefix, or its length:
		// a live secret must not leak through an error message or a log line.
		throw new StripeConfigError(
			`${name} is set but does not carry the ${prefix} prefix. ` +
				`This deployment is test-mode only by construction (ADR 0016 §3; the seven-row ` +
				`live gate is CLOSED and ENABLE-LIVE-STRIPE is operator-only). Refusing to start a client.`,
		);
	}
	return value;
}

/**
 * Read the Stripe configuration from the environment, fail-closed.
 *
 *   - nothing set          → `{ configured: false }` (the keyless default;
 *                            fixtures carry every test)
 *   - all set, test-shaped → a `StripeTestModeConfig`
 *   - anything else        → `StripeConfigError` — a half-configured or
 *                            live-shaped environment is a misconfiguration,
 *                            never a degraded mode
 */
export function readStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeRuntimeConfig {
	const secret = env[SECRET_KEY_ENV]?.trim();
	const webhook = env[WEBHOOK_SECRET_ENV]?.trim();
	const publishable = env[PUBLISHABLE_KEY_ENV]?.trim();

	if (!secret && !webhook && !publishable) {
		return {
			configured: false,
			reason: `${SECRET_KEY_ENV} and ${WEBHOOK_SECRET_ENV} are unset — running keyless with fixtures`,
		};
	}
	if (!secret || !webhook) {
		throw new StripeConfigError(
			`Stripe is half-configured: ${SECRET_KEY_ENV} and ${WEBHOOK_SECRET_ENV} must both be set (or neither).`,
		);
	}

	const config: StripeTestModeConfig = {
		mode: 'test',
		secretKey: requirePrefix(SECRET_KEY_ENV, secret, SECRET_KEY_TEST_PREFIX) as StripeTestSecretKey,
		webhookSecret: requirePrefix(WEBHOOK_SECRET_ENV, webhook, WEBHOOK_SECRET_PREFIX) as StripeWebhookSecret,
		...(publishable
			? {
					publishableKey: requirePrefix(
						PUBLISHABLE_KEY_ENV,
						publishable,
						PUBLISHABLE_KEY_TEST_PREFIX,
					) as StripeTestPublishableKey,
				}
			: {}),
	};
	return { configured: true, ...config };
}

/** The configured tenant's uuid for webhook scoping, or undefined when the platform is not provisioned. */
export function readTenantId(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env[TENANT_ID_ENV]?.trim();
	return value || undefined;
}
