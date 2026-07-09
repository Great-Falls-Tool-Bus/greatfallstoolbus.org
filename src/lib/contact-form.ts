// Pure, framework-free helpers for the /contact in-page submission flow
// (TIN-2420 Path B, site side). Extracted from `+page.svelte` so the honeypot
// and validation logic is unit-testable without mounting a Svelte component:
// this module is pure functions only. The component owns every DOM, fetch, and
// timing concern; nothing here touches `window`, `fetch`, or the clock.
//
// The submission target is the Anubis-guarded form-handler
// (`${PUBLIC_GFTB_FORM_ENDPOINT}/api/contact`), which injects the visitor's
// message to the keyholders list over LMTP. The mailto shape below matches the
// DMARC-safe subject the handler would otherwise set, so the manual fallback
// and the automated path read identically to a keyholder.

export type ContactField = 'name' | 'email' | 'message';

export interface ContactFormValues {
	name: string;
	email: string;
	message: string;
	/** Honeypot. A real person never sees or fills this; bots that autofill
	 *  every field do. Any non-empty value silently drops the submission. */
	website: string;
}

export type ContactFieldErrors = Partial<Record<ContactField, string>>;

// Deliberately permissive: one `@`, a dot in the domain, no whitespace. Real
// address validity is proven by the reply landing, not by a clever regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MIN = 10;

/** A blank set of form values, used to seed component state. */
export function emptyContactValues(): ContactFormValues {
	return { name: '', email: '', message: '', website: '' };
}

/** True when the honeypot caught something. Trimmed so a lone space from an
 *  overzealous autofill still trips it. Kept separate from validation because
 *  the honeypot is silent by design: a tripped form must not tell the bot why. */
export function isHoneypotTripped(values: Pick<ContactFormValues, 'website'>): boolean {
	return values.website.trim().length > 0;
}

/** Field-level validation run before any network call. Returns at most one
 *  message per invalid field; an empty object means the form is submittable.
 *  The honeypot is intentionally NOT reported here (see `isHoneypotTripped`). */
export function validateContactForm(values: ContactFormValues): ContactFieldErrors {
	const errors: ContactFieldErrors = {};

	if (values.name.trim().length === 0) {
		errors.name = 'Tell us who you are.';
	}

	const email = values.email.trim();
	if (email.length === 0) {
		errors.email = 'We need an email so a keyholder can reply.';
	} else if (!EMAIL_RE.test(email)) {
		errors.email = 'That email does not look right. Check it and try again.';
	}

	if (values.message.trim().length < MESSAGE_MIN) {
		errors.message = 'Add a little more about what you are reaching out about.';
	}

	return errors;
}

/** True when `validateContactForm` found at least one problem. */
export function hasErrors(errors: ContactFieldErrors): boolean {
	return Object.keys(errors).length > 0;
}

/** The JSON body POSTed to the form-handler. Trimmed to what the handler injects
 *  over LMTP; the honeypot rides along so the server can also drop bot posts.
 *  `altcha` is the solved ALTCHA proof-of-work payload, present only once the
 *  vendored widget has solved a challenge (TIN-2420 Path B). It is optional on
 *  the wire: the handler accepts legacy bodies without it while its
 *  ALTCHA_REQUIRED flag is false, and enforces it once flipped. */
export interface ContactPayload {
	name: string;
	email: string;
	message: string;
	website: string;
	altcha?: string;
}

export function toContactPayload(values: ContactFormValues, altcha = ''): ContactPayload {
	const payload: ContactPayload = {
		name: values.name.trim(),
		email: values.email.trim(),
		message: values.message.trim(),
		website: values.website,
	};
	// Only attach a non-empty proof, so a legacy submit (widget absent or not yet
	// solved) stays a clean four-field body the handler accepts in grace mode.
	if (altcha) {
		payload.altcha = altcha;
	}
	return payload;
}

/** Join the configured endpoint origin to the contact route, tolerating a
 *  trailing slash on the env value so `https://forms.latoolb.us` and
 *  `https://forms.latoolb.us/` both resolve to one canonical URL. */
export function contactApiUrl(endpoint: string): string {
	return `${endpoint.replace(/\/+$/, '')}/api/contact`;
}

/** The ALTCHA challenge-issuance URL on the same handler origin. The vendored
 *  `<altcha-widget>` GETs this to obtain a signed challenge to solve. */
export function contactChallengeUrl(endpoint: string): string {
	return `${endpoint.replace(/\/+$/, '')}/api/challenge`;
}

/** Build the `mailto:` fallback the page offers when there is no live endpoint
 *  (today) or when a live POST fails. Subject and body match the DMARC-safe mail
 *  shape the handler would inject, so a keyholder sees the same thing either way. */
export function buildMailtoHref(to: string, values: ContactFormValues): string {
	const name = values.name.trim();
	const subject = `Tool Bus contact: ${name || 'website visitor'}`;
	const body = `Name: ${name}\nEmail: ${values.email.trim()}\n\n${values.message.trim()}`;
	return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
