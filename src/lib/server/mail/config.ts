/**
 * Mail delivery configuration — DISABLED BY DEFAULT, BY CONSTRUCTION
 * (TIN-4062; operator interview 2026-08-23: "Build the mail leg now …
 * delivery stays OFF until explicit operator activation; agents never send
 * mail").
 *
 * Mirrors `src/lib/server/stripe/config.ts`'s shape deliberately: a
 * configuration TYPE that a caller cannot smuggle "send" out of, read
 * fail-closed, NAMES ONLY in this repository (ADR 0014 §0.2) — never a
 * credential value.
 *
 *   GFTB_MAIL_DELIVERY   must be the EXACT string "enabled" to activate
 *                        anything. Unset, empty, "true", "1", "yes", or any
 *                        other value is the DISABLED default — never a
 *                        warning, never a partial state. This is the value
 *                        in every environment this repository's own tests
 *                        and CI ever run in.
 *   GFTB_MAIL_SMTP_URL   the transport DSN (`smtps://user:pass@host:port`),
 *                        required alongside GFTB_MAIL_DELIVERY=enabled. A
 *                        NAME only; the value lives in the operator secret
 *                        store, never in this repository — exactly like
 *                        DATABASE_URL and the Stripe test keys.
 *
 * HALF-CONFIGURED IS A MISCONFIGURATION, NEVER A DEGRADED MODE — the same
 * refusal `readStripeConfig` makes: `GFTB_MAIL_DELIVERY=enabled` with no DSN
 * throws `MailConfigError` rather than silently staying disabled, because a
 * deployment that BELIEVES delivery is on and isn't is a worse failure than
 * one that refuses to start. The inverse (a DSN present without
 * `GFTB_MAIL_DELIVERY=enabled`) is NOT an error — it is exactly the shape an
 * operator's staged rollout takes (wire the secret first, flip the switch
 * second), and it stays disabled.
 */

export const MAIL_DELIVERY_ENV = 'GFTB_MAIL_DELIVERY';
export const MAIL_SMTP_URL_ENV = 'GFTB_MAIL_SMTP_URL';
export const MAIL_FROM_ADDRESS_ENV = 'GFTB_MAIL_FROM_ADDRESS';

/** The one string that activates anything. Anything else stays disabled. */
export const MAIL_DELIVERY_ENABLED_VALUE = 'enabled';

/** Whole-string anchor, not `startsWith`: mirrors the Stripe config shape guard. */
export const SMTP_URL_SHAPE = /^smtps?:\/\/\S+$/i;

/** Thrown on a half-configured environment. Never echoes the DSN value. */
export class MailConfigError extends Error {}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MailRuntimeConfig =
	| { readonly enabled: false; readonly reason: string }
	| { readonly enabled: true; readonly transportUrl: string; readonly fromAddress: string };

/**
 * Read mail configuration from the environment, fail-closed.
 *
 *   - `GFTB_MAIL_DELIVERY` unset or not exactly `"enabled"` →
 *     `{ enabled: false }`, regardless of whether a DSN or a from-address
 *     happens to be present.
 *   - `GFTB_MAIL_DELIVERY=enabled`, `GFTB_MAIL_SMTP_URL` smtp(s)://-shaped,
 *     and `GFTB_MAIL_FROM_ADDRESS` address-shaped → `{ enabled: true, … }`.
 *   - `GFTB_MAIL_DELIVERY=enabled` with either name missing, blank, or
 *     malformed → `MailConfigError` (half-configured, never a degraded mode).
 */
export function readMailConfig(env: NodeJS.ProcessEnv = process.env): MailRuntimeConfig {
	const raw = env[MAIL_DELIVERY_ENV]?.trim();
	if (raw !== MAIL_DELIVERY_ENABLED_VALUE) {
		return {
			enabled: false,
			reason:
				raw === undefined || raw === ''
					? `${MAIL_DELIVERY_ENV} is unset — mail delivery disabled by default (operator interview 2026-08-23)`
					: `${MAIL_DELIVERY_ENV} is set but is not exactly "enabled" — treated as disabled, never a warning`,
		};
	}

	const transportUrl = env[MAIL_SMTP_URL_ENV]?.trim();
	const fromAddress = env[MAIL_FROM_ADDRESS_ENV]?.trim();
	if (!transportUrl || !fromAddress) {
		throw new MailConfigError(
			`${MAIL_DELIVERY_ENV}=enabled but ${MAIL_SMTP_URL_ENV} and/or ${MAIL_FROM_ADDRESS_ENV} is unset. Mail ` +
				'delivery is half-configured: all three names are required together, or none. This is a ' +
				'misconfiguration, never a degraded mode (the same refusal src/lib/server/stripe/config.ts makes for Stripe).',
		);
	}
	if (!SMTP_URL_SHAPE.test(transportUrl)) {
		// Deliberately does NOT include the value: a malformed DSN can still
		// carry embedded credentials, and this repository is public.
		throw new MailConfigError(
			`${MAIL_SMTP_URL_ENV} is set but is not a whole-string smtp:// or smtps:// URL. Refusing to build a transport.`,
		);
	}
	if (!EMAIL_SHAPE.test(fromAddress)) {
		throw new MailConfigError(`${MAIL_FROM_ADDRESS_ENV} is set but is not a plausible email address.`);
	}

	return { enabled: true, transportUrl, fromAddress };
}

export const PUBLIC_ORIGIN_ENV = 'GFTB_PUBLIC_ORIGIN';

/**
 * The public site origin a rendered link is relative to. Not secret — the
 * production origin is a safe, committed default (`greatfallstoolbus.org` is
 * this repository's own public identity) — so this is a NAME with a default,
 * unlike `DATABASE_URL` or the transport DSN, which are pure names with no
 * fallback. Overridable per environment (preview/tailnet lanes) via the
 * env var.
 */
export const DEFAULT_PUBLIC_ORIGIN = 'https://greatfallstoolbus.org';

export function readPublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
	const raw = env[PUBLIC_ORIGIN_ENV]?.trim();
	return raw && raw.length > 0 ? raw.replace(/\/+$/, '') : DEFAULT_PUBLIC_ORIGIN;
}
