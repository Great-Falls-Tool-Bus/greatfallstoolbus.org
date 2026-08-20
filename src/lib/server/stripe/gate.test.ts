/**
 * The live gate is a constant, not a flag (TIN-3818; ADR 0016 §3 row 7).
 */

import { describe, expect, it } from 'vitest';
import { LIVE_STRIPE_GATE, LiveModeRejectedError, assertTestModeEvent, liveGateOpen } from './gate';

describe('the seven-row live gate', () => {
	it('is CLOSED, frozen, and names its authority', () => {
		expect(liveGateOpen()).toBe(false);
		expect(Object.isFrozen(LIVE_STRIPE_GATE)).toBe(true);
		expect(LIVE_STRIPE_GATE.reason).toContain('ENABLE-LIVE-STRIPE');
		expect(LIVE_STRIPE_GATE.reason).toContain('Jess');
	});

	it('has no writable escape hatch', () => {
		expect(() => {
			(LIVE_STRIPE_GATE as { open: boolean }).open = true;
		}).toThrow();
		expect(liveGateOpen()).toBe(false);
	});

	it('rejects live events and passes test-mode ones', () => {
		expect(() => assertTestModeEvent({ livemode: true, id: 'evt_x' })).toThrow(LiveModeRejectedError);
		expect(() => assertTestModeEvent({ livemode: false, id: 'evt_x' })).not.toThrow();
	});
});
