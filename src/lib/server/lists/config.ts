/**
 * List-automation configuration — DISABLED BY DEFAULT, BY CONSTRUCTION
 * (discuss-board lifecycle spec, `docs/spec/discuss-board-lifecycle-2026-09-01.md`;
 * TIN-3964; ADR 0024 §1.5's readiness gate: the gate controls WHEN the
 * external effects run, not whether the member is entitled to them).
 *
 * Mirrors `src/lib/server/mail/config.ts`'s shape deliberately: a
 * configuration TYPE a caller cannot smuggle a live client out of, read
 * fail-closed, NAMES ONLY in this repository (ADR 0014 §0.2) — never a
 * credential value.
 *
 *   GFTB_LIST_AUTOMATION   must be the EXACT string "enabled" to activate
 *                          anything. Unset, empty, "true", "1", "yes", or any
 *                          other value is the DISABLED default — never a
 *                          warning, never a partial state. This is the value
 *                          in every environment this repository's own tests
 *                          and CI ever run in.
 *   GFTB_MAILMAN_API_URL   the Mailman 3 core REST endpoint as a DSN with the
 *                          REST credential embedded
 *                          (`https://user:pass@host/` — the same
 *                          credential-in-DSN shape as GFTB_MAIL_SMTP_URL),
 *                          required alongside GFTB_LIST_AUTOMATION=enabled. A
 *                          NAME only; the value lives apply-plane-side in
 *                          `great-falls-tool-bus-infra` (the credential is the
 *                          one `secrets.contract.yaml` names
 *                          `gftb-mailman-admin-password`, plane
 *                          gftb-infra-sops), never in this repository.
 *
 * HALF-CONFIGURED IS A MISCONFIGURATION, NEVER A DEGRADED MODE — the same
 * refusal `readMailConfig` makes: `GFTB_LIST_AUTOMATION=enabled` with no DSN
 * throws `ListConfigError` rather than silently staying disabled, because a
 * deployment that BELIEVES list automation is on and isn't is a worse failure
 * than one that refuses to start (the worker maps the throw to exit 78 at
 * startup — the BLOCK-1 posture). The inverse (a DSN present without
 * `GFTB_LIST_AUTOMATION=enabled`) is NOT an error — it is exactly the shape
 * an operator's staged rollout takes (wire the secret first, flip the switch
 * second), and it stays disabled.
 *
 * NO ERROR FROM THIS MODULE EVER ECHOES THE DSN: it carries an embedded
 * credential and this repository is public (`readMailConfig`'s precedent; the
 * outbox `last_error` redaction is a backstop only, never the plan).
 */

export const LIST_AUTOMATION_ENV = 'GFTB_LIST_AUTOMATION';
export const MAILMAN_API_URL_ENV = 'GFTB_MAILMAN_API_URL';

/** The one string that activates anything. Anything else stays disabled. */
export const LIST_AUTOMATION_ENABLED_VALUE = 'enabled';

/** Whole-string anchor, not `startsWith`: mirrors the mail config shape guard. */
export const MAILMAN_API_URL_SHAPE = /^https?:\/\/\S+$/i;

/** Thrown on a half-configured environment. Never echoes the DSN value. */
export class ListConfigError extends Error {}

export type ListAutomationConfig =
	| { readonly enabled: false; readonly reason: string }
	| { readonly enabled: true; readonly apiUrl: string };

/**
 * Read list-automation configuration from the environment, fail-closed.
 *
 *   - `GFTB_LIST_AUTOMATION` unset or not exactly `"enabled"` →
 *     `{ enabled: false }`, regardless of whether a DSN happens to be present.
 *   - `GFTB_LIST_AUTOMATION=enabled` and `GFTB_MAILMAN_API_URL`
 *     http(s)://-shaped → `{ enabled: true, … }`.
 *   - `GFTB_LIST_AUTOMATION=enabled` with the DSN missing, blank, or
 *     malformed → `ListConfigError` (half-configured, never a degraded mode).
 */
export function readListAutomationConfig(env: NodeJS.ProcessEnv = process.env): ListAutomationConfig {
	const raw = env[LIST_AUTOMATION_ENV]?.trim();
	if (raw !== LIST_AUTOMATION_ENABLED_VALUE) {
		return {
			enabled: false,
			reason:
				raw === undefined || raw === ''
					? `${LIST_AUTOMATION_ENV} is unset — list automation disabled by default (ADR 0024 §1.5 readiness gate)`
					: `${LIST_AUTOMATION_ENV} is set but is not exactly "enabled" — treated as disabled, never a warning`,
		};
	}

	const apiUrl = env[MAILMAN_API_URL_ENV]?.trim();
	if (!apiUrl) {
		throw new ListConfigError(
			`${LIST_AUTOMATION_ENV}=enabled but ${MAILMAN_API_URL_ENV} is unset. List automation is half-configured: ` +
				'both names are required together, or neither. This is a misconfiguration, never a degraded mode ' +
				'(the same refusal src/lib/server/mail/config.ts makes for mail).',
		);
	}
	if (!MAILMAN_API_URL_SHAPE.test(apiUrl)) {
		// Deliberately does NOT include the value: the DSN carries an embedded
		// credential, and this repository is public.
		throw new ListConfigError(
			`${MAILMAN_API_URL_ENV} is set but is not a whole-string http:// or https:// URL. Refusing to build a client.`,
		);
	}

	return { enabled: true, apiUrl };
}
