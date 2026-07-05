import { describe, expect, it } from 'vitest';
import {
	buildMailtoHref,
	contactApiUrl,
	emptyContactValues,
	hasErrors,
	isHoneypotTripped,
	toContactPayload,
	validateContactForm,
	type ContactFormValues,
} from './contact-form';

// Unit contract for the /contact submission helpers (TIN-2420 Path B, site
// side). These are the pure decisions the component defers to: is this a bot,
// is this form submittable, and what does the manual fallback look like.

function values(overrides: Partial<ContactFormValues> = {}): ContactFormValues {
	return { name: 'Ada', email: 'ada@example.org', message: 'I want to borrow the welder.', website: '', ...overrides };
}

describe('isHoneypotTripped', () => {
	it('passes a clean form (honeypot empty)', () => {
		expect(isHoneypotTripped(values())).toBe(false);
	});

	it('treats a whitespace-only honeypot as clean', () => {
		expect(isHoneypotTripped(values({ website: '   ' }))).toBe(false);
	});

	it('trips when a bot fills the hidden website field', () => {
		expect(isHoneypotTripped(values({ website: 'http://spam.example' }))).toBe(true);
	});
});

describe('validateContactForm', () => {
	it('accepts a well-formed submission', () => {
		expect(validateContactForm(values())).toEqual({});
		expect(hasErrors(validateContactForm(values()))).toBe(false);
	});

	it('flags a missing name', () => {
		expect(validateContactForm(values({ name: '   ' })).name).toBeTruthy();
	});

	it('flags a missing email distinctly from a malformed one', () => {
		const missing = validateContactForm(values({ email: '' })).email;
		const malformed = validateContactForm(values({ email: 'ada-at-example' })).email;
		expect(missing).toBeTruthy();
		expect(malformed).toBeTruthy();
		expect(missing).not.toBe(malformed);
	});

	it('rejects an email with no domain dot', () => {
		expect(validateContactForm(values({ email: 'ada@localhost' })).email).toBeTruthy();
	});

	it('flags a too-short message', () => {
		expect(validateContactForm(values({ message: 'hi' })).message).toBeTruthy();
	});

	it('reports every invalid field at once', () => {
		const errors = validateContactForm({ name: '', email: '', message: '', website: '' });
		expect(hasErrors(errors)).toBe(true);
		expect(Object.keys(errors).sort()).toEqual(['email', 'message', 'name']);
	});

	it('ignores the honeypot (validation stays silent about it)', () => {
		expect(validateContactForm(values({ website: 'bot' }))).toEqual({});
	});
});

describe('toContactPayload', () => {
	it('trims the human fields but preserves the honeypot verbatim', () => {
		const payload = toContactPayload(values({ name: '  Ada  ', email: ' ada@example.org ', website: ' bot ' }));
		expect(payload).toEqual({
			name: 'Ada',
			email: 'ada@example.org',
			message: 'I want to borrow the welder.',
			website: ' bot ',
		});
	});
});

describe('contactApiUrl', () => {
	it('appends the contact route to a bare origin', () => {
		expect(contactApiUrl('https://forms.latoolb.us')).toBe('https://forms.latoolb.us/api/contact');
	});

	it('tolerates one or more trailing slashes on the endpoint', () => {
		expect(contactApiUrl('https://forms.latoolb.us/')).toBe('https://forms.latoolb.us/api/contact');
		expect(contactApiUrl('https://forms.latoolb.us///')).toBe('https://forms.latoolb.us/api/contact');
	});
});

describe('buildMailtoHref', () => {
	it('addresses the keyholders list with an em-dash-free subject', () => {
		const href = buildMailtoHref('keyholders@latoolb.us', values());
		expect(href.startsWith('mailto:keyholders@latoolb.us?')).toBe(true);
		expect(href).toContain(encodeURIComponent('Tool Bus contact: Ada'));
		expect(href).not.toContain('%E2%80%94'); // no em-dash in the encoded subject
	});

	it('falls back to a generic subject when the name is blank', () => {
		const href = buildMailtoHref('keyholders@latoolb.us', values({ name: '' }));
		expect(href).toContain(encodeURIComponent('Tool Bus contact: website visitor'));
	});

	it('carries name, email, and message into the body', () => {
		const href = buildMailtoHref('keyholders@latoolb.us', values());
		const body = decodeURIComponent(href.split('body=')[1]);
		expect(body).toContain('Name: Ada');
		expect(body).toContain('Email: ada@example.org');
		expect(body).toContain('I want to borrow the welder.');
	});
});

describe('emptyContactValues', () => {
	it('seeds a blank, submittable-shaped record', () => {
		expect(emptyContactValues()).toEqual({ name: '', email: '', message: '', website: '' });
	});
});
