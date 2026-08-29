/**
 * The mail journal's content gate (TIN-4062). Pure, no database — mirrors
 * `audit/write.test.ts`'s scope split: the database-backed half (the
 * idempotency-receipt round trip) lives in
 * `src/lib/server/outbox/handlers/mail.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { InvalidMailJournalInputError, MAX_DETAIL_LENGTH, assertDetail } from './journal';

describe('assertDetail — the mail journal content gate', () => {
	it('accepts a short operator-facing note', () => {
		expect(assertDetail('mail delivery gate disabled — recorded no-op')).toBe(
			'mail delivery gate disabled — recorded no-op',
		);
	});

	it('rejects an empty string', () => {
		expect(() => assertDetail('   ')).toThrow(InvalidMailJournalInputError);
	});

	it('rejects anything over MAX_DETAIL_LENGTH', () => {
		expect(() => assertDetail('x'.repeat(MAX_DETAIL_LENGTH + 1))).toThrow(InvalidMailJournalInputError);
	});

	it('rejects a URL shape', () => {
		expect(() => assertDetail('see https://example.invalid/leak for details')).toThrow(InvalidMailJournalInputError);
	});

	it('rejects an address shape', () => {
		expect(() => assertDetail('sent to someone@example.invalid')).toThrow(InvalidMailJournalInputError);
	});

	it('rejects a token-shaped run of 32+ base64url characters', () => {
		expect(() => assertDetail(`token ${'A'.repeat(40)}`)).toThrow(InvalidMailJournalInputError);
	});

	it('rejects embedded newlines/tabs', () => {
		expect(() => assertDetail('line one\nline two')).toThrow(InvalidMailJournalInputError);
	});
});
