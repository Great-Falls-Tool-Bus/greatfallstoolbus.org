/**
 * Unit tests for the I1 constants (TIN-3814 slice I1).
 *
 * ADR 0014 §7 (:190): "Loans default to seven days." Spec §8 checkout step 2
 * (:361–362): "seven-day due date." Slices §1.2 acceptance: "unit: the loan
 * default term constant is seven days."
 */

import { describe, expect, it } from 'vitest';
import {
	ASSET_COMPONENT_KINDS,
	ASSET_STATES,
	DEFAULT_LOAN_TERM_DAYS,
	INSPECTION_KINDS,
	LOAN_STATES,
	REPAIR_CLOSE_DISPOSITIONS,
	REPAIR_OPEN_DISPOSITIONS,
	RETURN_DISPOSITIONS,
} from './constants';

describe('DEFAULT_LOAN_TERM_DAYS', () => {
	it('is exactly seven days (ADR 0014 §7 :190; spec §8 :361–362)', () => {
		expect(DEFAULT_LOAN_TERM_DAYS).toBe(7);
	});
});

describe('state and disposition vocabularies match the ratified lists verbatim', () => {
	it('asset states — spec §8 (:349)', () => {
		expect(ASSET_STATES).toEqual(['available', 'checked_out', 'repair', 'quarantined', 'retired']);
	});

	it('loan states — spec §8 (:350)', () => {
		expect(LOAN_STATES).toEqual(['draft', 'active', 'overdue', 'returned', 'cancelled']);
	});

	it('asset component kinds — spec §8 (:340)', () => {
		expect(ASSET_COMPONENT_KINDS).toEqual(['content', 'consumable']);
	});

	it('return dispositions — spec §8 (:377–378)', () => {
		expect(RETURN_DISPOSITIONS).toEqual(['clean', 'needs_repair', 'missing_content', 'damage']);
	});

	it('repair-opening dispositions are every return disposition except clean', () => {
		expect(REPAIR_OPEN_DISPOSITIONS).toEqual(['needs_repair', 'missing_content', 'damage']);
	});

	it('repair close dispositions — §2.1 ASSUMPTION', () => {
		expect(REPAIR_CLOSE_DISPOSITIONS).toEqual(['serviceable', 'retired']);
	});

	it('inspection kinds — spec §8 checkout step 3 / return steps 2–3', () => {
		expect(INSPECTION_KINDS).toEqual(['checkout', 'return']);
	});
});
