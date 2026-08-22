/**
 * Operator allowlist for the agreement-publish route (TIN-3440 slice S13).
 *
 * WHY THIS SHAPE, NOT A FOURTH ROLE. The ratified role model
 * (`decisions/0018`, meta PR #32, sitting-2 item 2, option 1 verbatim) is
 * EXACTLY three roles: `member` (implied by Active membership), `keyholder`
 * (claim/tour/approve/decline/force-remove), `finance` (amount/rail/processor
 * detail). A fourth `operator` grant/role would contradict that ratified
 * model. Neither the ratified record nor anything else in `meta` (spec,
 * decisions, the reconstructed operator-session register) names an
 * operator-authentication pattern — grep-clean as of this slice. Absent a
 * ratified pattern, this is the task's own prescribed least-inventive
 * fallback: an ENV-PINNED allowlist of person ids, checked IN ADDITION TO
 * (never instead of) a live `keyholder` grant — `requireKeyholder` still runs
 * first, checked separately by the route in the same unit of work. This is
 * configuration, not a role-model change: no new grant table, no new string
 * accepted by `grantRole`/`hasRole`.
 *
 * FAIL-CLOSED BY CONSTRUCTION. `GFTB_OPERATOR_PERSON_IDS` unset, empty, or
 * whitespace-only means the allowlist is `null` — and `null` means NOBODY
 * passes, never "everybody passes." There is no code path in this module
 * that treats "unconfigured" as "open."
 */

const OPERATOR_ALLOWLIST_ENV_VAR = 'GFTB_OPERATOR_PERSON_IDS';

/**
 * Parse the comma-separated allowlist value. `null` means unset/empty —
 * fail-closed, not "allow all." Ids are trimmed; blank entries are dropped so
 * a stray trailing comma cannot smuggle in an empty-string "id".
 */
export function parseOperatorAllowlist(raw: string | undefined): Set<string> | null {
	if (raw === undefined) return null;
	const ids = raw
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
	if (ids.length === 0) return null;
	return new Set(ids);
}

/**
 * True only when the env allowlist is configured AND names this exact person
 * id. An unset allowlist and a set-but-not-listed person id both return
 * `false` — the caller (the route) maps both to the same generic refusal, so
 * a probe cannot distinguish "not configured" from "not on the list."
 */
export function isAllowlistedOperator(personId: string, env: NodeJS.ProcessEnv = process.env): boolean {
	const allowlist = parseOperatorAllowlist(env[OPERATOR_ALLOWLIST_ENV_VAR]);
	if (allowlist === null) return false;
	return allowlist.has(personId);
}

export { OPERATOR_ALLOWLIST_ENV_VAR };
