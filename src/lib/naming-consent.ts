// Naming-consent enforcement shared by the discuss@ draft-staging pipeline
// (scripts/discuss-to-svx.mjs, scripts/validate-discuss-drafts.mts) and any
// future public-log surface that stages operator-authored prose sourced from
// a private list.
//
// Mirrors the doctrine recorded in the private meta repo's
// steering/naming-consent.md: a person is not named in public copy unless
// that record explicitly permits the exact public form; absence means
// redact. Editorial review already applies that rule when a redaction
// proposal is drafted — this module makes two of its highest-consequence
// rows enforceable IN CODE, so a slip cannot ship silently:
//
//   - the bus host has a public-consent row, but ONLY for the initial "J.";
//     the full first name must never appear in public copy.
//   - the identity the doctrine calls out as private-only has NO public
//     form at all — not even an initial. Any reference to the name, or to
//     the fact of that person's list membership, must be struck entirely,
//     never redacted-and-kept.
//
// This is deliberately a narrow, hard-coded pair of checks (not a general
// consent engine) — new rows in naming-consent.md are an editorial decision
// made by a human reading that file, not something this module should infer.
// Backstopped independently by matching custom rules in .gitleaks.toml, so a
// violation also fails `just secrets-scan-dir` / `just check` even if this
// module is never called.
export class NamingConsentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NamingConsentError';
	}
}

// Word-boundary, case-insensitive: catches "Josh"/"JOSH" but not "J." or a
// longer name that merely starts with the same letters (e.g. "Joshua").
const UNREDACTED_BUS_HOST_NAME = /\bjosh\b/i;
// Same shape for the private-only identity. There is no redacted form to
// fall back to for this one — any hit is a hard failure.
const PRIVATE_ONLY_IDENTITY = /\bwalter\b/i;

/**
 * Throws NamingConsentError if `text` contains the bus host's unredacted
 * first name, or any reference to the private-only identity. `context` is a
 * human-readable label (e.g. a file path) prefixed onto the error so a CI
 * failure points straight at the offending source.
 */
export function assertNamingConsent(text: string, context = 'text'): void {
	if (PRIVATE_ONLY_IDENTITY.test(text)) {
		throw new NamingConsentError(
			`${context}: a private-only identity is named. naming-consent.md gives this identity no public form at all — strike the reference entirely, do not initialize it.`,
		);
	}
	if (UNREDACTED_BUS_HOST_NAME.test(text)) {
		throw new NamingConsentError(
			`${context}: the bus host's unredacted first name is present. naming-consent.md permits only the initial "J." in public copy — replace it.`,
		);
	}
}

const RAW_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Local-part-preserving mask so a failure message never re-leaks the address it names. */
function maskAddress(address: string): string {
	const [local, domain] = address.split('@');
	const maskedLocal = local.length <= 1 ? '•' : `${local[0]}${'•'.repeat(Math.min(local.length - 1, 6))}`;
	return `${maskedLocal}@${domain}`;
}

/**
 * Throws NamingConsentError if `text` contains any bare, address-shaped
 * substring (`local@domain.tld`) that is not in `allow` (case-insensitive
 * exact match — meant for the two list addresses themselves, which are
 * public/private LIST identifiers, not a person's contact address). Every
 * other address — including the operator's own — is a leak in staged public
 * copy and fails closed.
 */
export function assertNoBareEmailAddress(text: string, allow: readonly string[] = [], context = 'text'): void {
	const allowLower = new Set(allow.map((a) => a.toLowerCase()));
	for (const match of text.match(RAW_ADDRESS) ?? []) {
		if (allowLower.has(match.toLowerCase())) continue;
		throw new NamingConsentError(
			`${context}: an email address is present (${maskAddress(match)}). Remove it before staging.`,
		);
	}
}
