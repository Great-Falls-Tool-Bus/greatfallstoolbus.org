/**
 * S4 unit rows for submission validation (slices §1.6 acceptance): a
 * submission without the 18+ attestation is rejected, and A2's "no
 * contribution field accepted, structurally" guard is a rejection of unknown
 * fields — so a later smuggled field FAILS a test instead of slipping
 * through. Database-bound behaviour lives in application.integration.test.ts.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	InvalidSubmissionError,
	PUBLIC_RECEIPT,
	applicationSubmissionFromForm,
	normalizeEmail,
	validateSubmission,
} from './intake';

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		displayName: 'Alex Applicant',
		email: 'Applicant@Example.org',
		interestsHelpOffer: 'woodworking; can help with intake shifts',
		tourAvailability: 'weekday evenings',
		disclosures: 'none',
		ageAttested: true,
		...overrides,
	};
}

function markupBetween(source: string, start: string, end: string): string {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex);
	if (startIndex < 0 || endIndex < startIndex) {
		throw new Error(`expected markup from ${JSON.stringify(start)} through ${JSON.stringify(end)}`);
	}
	return source.slice(startIndex, endIndex + end.length);
}

function failedFields(raw: Record<string, unknown>): readonly string[] {
	try {
		validateSubmission(raw);
	} catch (error) {
		if (error instanceof InvalidSubmissionError) return error.fields;
		throw error;
	}
	throw new Error('expected InvalidSubmissionError');
}

describe('applicationSubmissionFromForm — the read-only preview cannot enter A2', () => {
	it('the no-script native form serializes only application fields; preview controls are unsuccessful', () => {
		const source = readFileSync(new URL('../../../routes/apply/+page.svelte', import.meta.url), 'utf8');
		const preview = markupBetween(source, '<fieldset class="contribution-preview"', '</fieldset>');
		const applicationForm = markupBetween(source, '<form', '</form>');

		expect(source.indexOf(preview)).toBeLessThan(source.indexOf(applicationForm));
		expect(preview).toContain('type="range"');
		expect(preview).not.toMatch(/\bname\s*=/);
		expect(applicationForm).toContain('method="POST"');

		const successfulControlNames = [
			...applicationForm.matchAll(/<(?:input|textarea|select)\b[^>]*\bname=["']([^"']+)["']/g),
		].map((match) => match[1]);
		expect(successfulControlNames).toEqual([
			'displayName',
			'email',
			'interestsHelpOffer',
			'tourAvailability',
			'disclosures',
			'ageAttested',
		]);
		expect(successfulControlNames).not.toEqual(
			expect.arrayContaining(['pick', 'amount', 'helpRequested', 'paymentIntent', 'stripeToken']),
		);
	});

	it('projects exactly the application fields and drops hostile money-shaped controls', () => {
		const form = new FormData();
		for (const [key, value] of Object.entries({
			displayName: 'Alex Applicant',
			email: 'Applicant@Example.org',
			interestsHelpOffer: 'woodworking',
			tourAvailability: 'weekday evenings',
			disclosures: 'none',
			ageAttested: 'on',
			pick: 'preset:5000',
			amount: '50',
			helpRequested: 'true',
			paymentIntent: 'pi_hostile',
			stripeToken: 'tok_hostile',
		})) {
			form.set(key, value);
		}

		const projected = applicationSubmissionFromForm(form, 'application-key');
		expect(Object.keys(projected).sort()).toEqual([
			'ageAttested',
			'disclosures',
			'displayName',
			'email',
			'idempotencyKey',
			'interestsHelpOffer',
			'tourAvailability',
		]);
		expect(projected).not.toHaveProperty('pick');
		expect(projected).not.toHaveProperty('amount');
		expect(projected).not.toHaveProperty('helpRequested');
		expect(projected).not.toHaveProperty('paymentIntent');
		expect(projected).not.toHaveProperty('stripeToken');
		expect(validateSubmission(projected).idempotencyKey).toBe('application-key');
	});
});

describe('validateSubmission — the A2 guard set (spec §4; TIN-3440 intake list)', () => {
	it('accepts the exact TIN-3440 field list and normalizes it', () => {
		const validated = validateSubmission(input());
		expect(validated.email).toBe('applicant@example.org');
		expect(validated.displayName).toBe('Alex Applicant');
		expect(validated.ageAttested).toBe(true);
	});

	it('rejects a submission without the 18+ attestation (acceptance row 7)', () => {
		expect(failedFields(input({ ageAttested: false }))).toContain('ageAttested');
		expect(failedFields(input({ ageAttested: undefined }))).toContain('ageAttested');
	});

	it('rejects a truthy-but-not-true attestation — "on", 1, "true" are not an attestation', () => {
		for (const wrong of ['on', 'true', 1, 'yes']) {
			expect(failedFields(input({ ageAttested: wrong }))).toContain('ageAttested');
		}
	});

	it('rejects every missing or blank required field by name, without echoing values', () => {
		for (const field of ['displayName', 'email', 'interestsHelpOffer', 'tourAvailability', 'disclosures']) {
			expect(failedFields(input({ [field]: '   ' }))).toContain(field);
			expect(failedFields(input({ [field]: undefined }))).toContain(field);
		}
	});

	it('rejects unknown fields — the structural no-contribution-capture line (A2)', () => {
		for (const smuggled of [
			'contributionAmount',
			'paymentIntent',
			'stripeToken',
			'amountCents',
			'pick',
			'amount',
			'helpRequested',
		]) {
			expect(failedFields(input({ [smuggled]: '20' }))).toContain(`unknown_field:${smuggled}`);
		}
	});

	it('rejects an email without an address shape', () => {
		for (const bad of ['not-an-email', 'a@b', 'two words@example.org']) {
			expect(failedFields(input({ email: bad }))).toContain('email');
		}
	});

	it('rejects a present-but-blank Idempotency-Key and accepts an absent one', () => {
		expect(failedFields(input({ idempotencyKey: '  ' }))).toContain('idempotencyKey');
		expect(validateSubmission(input()).idempotencyKey).toBeUndefined();
		expect(validateSubmission(input({ idempotencyKey: ' k-1 ' })).idempotencyKey).toBe('k-1');
	});

	it('does not include a value echo in the error message', () => {
		try {
			validateSubmission(input({ email: 'secret-address@example.org', displayName: '' }));
			throw new Error('expected InvalidSubmissionError');
		} catch (error) {
			expect((error as Error).message).not.toContain('secret-address');
		}
	});
});

describe('normalizeEmail — spec §4 "normalized" without over-merging', () => {
	it('trims and lowercases only', () => {
		expect(normalizeEmail('  Person+Tag@Example.ORG ')).toBe('person+tag@example.org');
	});
});

describe('PUBLIC_RECEIPT — the one constant success body (non-enumeration)', () => {
	it('is frozen and carries no identifying field', () => {
		expect(PUBLIC_RECEIPT).toEqual({ received: true });
		expect(Object.isFrozen(PUBLIC_RECEIPT)).toBe(true);
	});
});
