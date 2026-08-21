/**
 * 18+ attestation — the sitting-2 item-1 data slot (TIN-3440 slice S4).
 *
 * Ratified 2026-08-21 — decisions/0018 (meta PR #32, pending operator
 * signature). ADR 0014 §4 and TIN-3440 both state the 18+ rule ("Member v0
 * is for adults 18 and older"; "Adults 18+ only"); sitting #2 ratified the
 * MECHANISM as drafted, option 1, verbatim (packet item 1):
 *
 *   - a single required checkbox, UNCHECKED by default;
 *   - submission rejected if it is not checked (unit-asserted);
 *   - the application row records `age_attested_at timestamptz` and
 *     `age_attestation_version text` — NO date of birth, no age, no identity
 *     document (the strictly larger disclosure for a strictly equal decision);
 *   - a self-declaration, never a verification: no copy may call it verified;
 *   - an under-18 discovered at the tour is declined through the ordinary
 *     decline path (A7) — no separate minor-handling records.
 *
 * The intake mechanics below this constant are fully built and the wording
 * is settled. `/apply` STILL stays closed: `AGE_ATTESTATION_TEXT` is left
 * `undefined` on purpose, not because anything remains unratified. Setting
 * it does not merely record a value — `intakeOpen()` below reads it
 * directly, and `+page.svelte` uses that flag to switch from the closed
 * notice to the live form, publishing the REST of `/apply`'s copy in the
 * same stroke (its own header still calls that copy "agent-drafted
 * placeholder … published: false / TODO"). Whether to accept real public
 * submissions is the operator's launch decision, not a byte in this file;
 * the gate opens when the operator opens intake at launch, tracked
 * separately from this ratification.
 */

/**
 * Ratified 2026-08-21 — decisions/0018 (meta PR #32, pending operator
 * signature). Verbatim, option 1:
 *   "I am 18 years of age or older."
 * This becomes `age_attestation_version` value 1. The constant below stays
 * `undefined` regardless — see the module docstring: opening `/apply` is an
 * operator launch action, not a consequence of ratification landing.
 */
export const AGE_ATTESTATION_TEXT: string | undefined = undefined; // operator sets this at launch

/** Value of `age_attestation_version` once the operator sets the text above. */
export const AGE_ATTESTATION_VERSION = '1';

/**
 * Intake is open exactly when `AGE_ATTESTATION_TEXT` is set. The wording is
 * ratified (decisions/0018); this stays `undefined` until the operator's
 * separate launch decision to open `/apply` publicly — see the module
 * docstring.
 */
export function intakeOpen(): boolean {
	return AGE_ATTESTATION_TEXT !== undefined;
}
