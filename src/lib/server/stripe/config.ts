/**
 * Stripe runtime configuration — TEST MODE BY CONSTRUCTION (TIN-3818;
 * spec §5 production activation gate; the seven-row gate FORM is PROPOSED in
 * ADR 0016 §5.1, unsigned — §3 records only the 2026-08-18 fallback ruling).
 *
 * This module is the first of the two independent refusals slices §1.11
 * requires: the configuration TYPE cannot carry a live key. A value that does
 * not MATCH the full test-mode shape — anchored, whole-string, no whitespace
 * or control characters to smuggle a second key behind a valid prefix — is a
 * thrown `StripeConfigError`, not a warning: `sk_live_…`, a restricted
 * `rk_…`, `sk_test_ok\nsk_live_…`, or anything else fails CLOSED before a
 * client exists to call anything. Because branded types erase at runtime,
 * `client.ts` re-validates the same shapes at the construction boundary.
 * (The second refusal is the webhook path rejecting `livemode: true` events
 * whenever the live gate is closed; see `./gate.ts`.)
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

/**
 * Full-shape anchors, not `startsWith`: a prefix check accepts
 * `sk_test_ok\nsk_live_REAL` and a bare `sk_test_` with no body
 * (adversarial-review finding B3 on PR #174). `^…$` with an explicit
 * character class closes both — nothing outside `[A-Za-z0-9]` can ride in a
 * validated value, so newline/NUL smuggling and empty bodies are
 * unrepresentable.
 */
export const SECRET_KEY_SHAPE = /^sk_test_[A-Za-z0-9]+$/;
export const PUBLISHABLE_KEY_SHAPE = /^pk_test_[A-Za-z0-9]+$/;
export const WEBHOOK_SECRET_SHAPE = /^whsec_[A-Za-z0-9]+$/;

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

function requireShape(name: string, value: string, prefix: string, shape: RegExp): string {
	if (!shape.test(value)) {
		// Deliberately does NOT include the value, its prefix, or its length:
		// a misdirected secret must not leak through an error message or a log
		// line.
		throw new StripeConfigError(
			`${name} is set but is not a whole-string ${prefix} value. ` +
				`This deployment is test-mode only by construction (spec §5 gate, all rows CLOSED; ` +
				`the gate form is PROPOSED in ADR 0016 §5.1 and ENABLE-LIVE-STRIPE is operator-only). ` +
				`Refusing to start a client.`,
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
		secretKey: requireShape(SECRET_KEY_ENV, secret, SECRET_KEY_TEST_PREFIX, SECRET_KEY_SHAPE) as StripeTestSecretKey,
		webhookSecret: requireShape(
			WEBHOOK_SECRET_ENV,
			webhook,
			WEBHOOK_SECRET_PREFIX,
			WEBHOOK_SECRET_SHAPE,
		) as StripeWebhookSecret,
		...(publishable
			? {
					publishableKey: requireShape(
						PUBLISHABLE_KEY_ENV,
						publishable,
						PUBLISHABLE_KEY_TEST_PREFIX,
						PUBLISHABLE_KEY_SHAPE,
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
