/**
 * 18+ attestation — the sitting-2 item-1 data slot (TIN-3440 slice S4).
 *
 * MECHANICS NOW, VALUES AS DATA (~2026-08-22). ADR 0014 §4 and TIN-3440 both
 * state the 18+ rule ("Member v0 is for adults 18 and older"; "Adults 18+
 * only"); the MECHANISM is the slices §1.6 AMENDMENT, drafted and NOT
 * ratified, on the sitting #2 agenda (packet item 1):
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
 * The intake mechanics below this constant are fully built; the PUBLIC FORM
 * stays closed while the text is undefined (packet item 1: "S4's field is
 * blocked until this text is ratified") — `/apply` renders an honest
 * not-yet-open state and its action refuses. Setting the ratified text here
 * is the one-line act that opens intake.
 */

/**
 * TODO(sitting-2 item 1, ~2026-08-22): ratified user-facing wording.
 * Drafted (slices §1.6 AMENDMENT, recommended option 1, NOT ratified):
 *   "I am 18 years of age or older."
 * The ratified wording becomes version 1. Do not ship member-visible copy
 * from this draft; the field is blocked until ratified (packet item 1,
 * "S4's field is blocked until this text is ratified").
 */
export const AGE_ATTESTATION_TEXT: string | undefined = undefined; // TODO ratified value

/** Value of `age_attestation_version` once the text is ratified. */
export const AGE_ATTESTATION_VERSION = '1';

/** Intake is open exactly when the ratified attestation text exists. */
export function intakeOpen(): boolean {
	return AGE_ATTESTATION_TEXT !== undefined;
}
