/**
 * The live gate is a constant, not a flag (TIN-3818; spec §5 row 7 — the gate
 * FORM is ratified in ADR 0016 §5.1, signed 2026-08-20; individual gate-row
 * receipts are a separate, still-absent fact per ADR 0016's Boundaries
 * clause).
 */

import { describe, expect, it } from 'vitest';
import { LIVE_STRIPE_GATE, LiveModeRejectedError, assertTestModeEvent, liveGateOpen, testModeOnly } from './gate';

describe('the seven-row live gate', () => {
	it('is CLOSED, frozen, and names its authority honestly (form ratified, rows unreceipted)', () => {
		expect(liveGateOpen()).toBe(false);
		expect(Object.isFrozen(LIVE_STRIPE_GATE)).toBe(true);
		expect(LIVE_STRIPE_GATE.reason).toContain('ENABLE-LIVE-STRIPE');
		expect(LIVE_STRIPE_GATE.reason).toContain('Jess');
		// B1, restated post-signature: the form is ratified in §5.1 (signed
		// 2026-08-20) but that is not a receipt for any of rows 1-6 — the
		// reason must say the rows lack receipts, not imply the form itself
		// is what's missing.
		expect(LIVE_STRIPE_GATE.reason).toContain('§5.1');
		expect(LIVE_STRIPE_GATE.reason.toLowerCase()).toContain('no row receipts');
	});

	it('has no writable escape hatch', () => {
		expect(() => {
			(LIVE_STRIPE_GATE as { open: boolean }).open = true;
		}).toThrow();
		expect(liveGateOpen()).toBe(false);
	});
});

describe('testModeOnly — the predicate every consumer consults', () => {
	it('admits only a literal false while the gate is closed', () => {
		expect(testModeOnly(false)).toBe(true);
		expect(testModeOnly(true)).toBe(false);
	});

	it('FAILS CLOSED on a missing or malformed livemode field (S1)', () => {
		for (const hostile of [undefined, null, 0, '', 'false', 'test', {}]) {
			expect(testModeOnly(hostile), `livemode=${JSON.stringify(hostile)} must be treated as live`).toBe(false);
		}
	});
});

describe('assertTestModeEvent', () => {
	it('rejects live events and passes test-mode ones', () => {
		expect(() => assertTestModeEvent({ livemode: true, id: 'evt_x' })).toThrow(LiveModeRejectedError);
		expect(() => assertTestModeEvent({ livemode: false, id: 'evt_x' })).not.toThrow();
	});

	it('rejects an event with no livemode field at all — fail closed, not open (S1)', () => {
		expect(() => assertTestModeEvent({ livemode: undefined, id: 'evt_x' })).toThrow(LiveModeRejectedError);
	});
});
