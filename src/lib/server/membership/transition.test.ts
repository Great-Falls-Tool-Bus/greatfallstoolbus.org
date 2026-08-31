/**
 * S7 unit rows (slices §1.9): the transition matrix as DATA, pinned — the
 * ratified edges exactly, completeness by enum iteration (a new state or
 * event fails here until classified), and the derived borrowing predicate.
 */

import { describe, expect, it } from 'vitest';
import {
	MEMBERSHIP_EVENTS,
	MEMBERSHIP_STATUSES,
	MEMBERSHIP_TRANSITIONS,
	canBorrow,
	classifyTransition,
	type MembershipStatus,
} from './transition';

describe('the ratified membership FSM (spec §4; member-lifecycle.mmd)', () => {
	it('pins every event source-state set — an accidental new edge fails a test, not a review', () => {
		expect(MEMBERSHIP_TRANSITIONS.activate).toEqual({ from: ['pending_assent'], to: 'active' });
		expect(MEMBERSHIP_TRANSITIONS.pause).toEqual({ from: ['active'], to: 'paused' });
		expect(MEMBERSHIP_TRANSITIONS.resume).toEqual({ from: ['paused'], to: 'active' });
		expect(MEMBERSHIP_TRANSITIONS.leave).toEqual({ from: ['active', 'paused'], to: 'left' });
		// BOTH removal edges — the ratified diagram + TIN-3440 "forcibly
		// remove" over the spec ASCII's literal shape (slices §1.9 note).
		expect(MEMBERSHIP_TRANSITIONS.remove).toEqual({ from: ['active', 'paused'], to: 'removed' });
	});

	it('left and removed are terminal: no event leaves either state', () => {
		for (const from of ['left', 'removed'] as const) {
			for (const event of MEMBERSHIP_EVENTS) {
				expect(classifyTransition(from, event)).toBe('forbidden');
			}
		}
	});

	it('pause never auto-expires: no event maps paused anywhere except resume/leave/remove', () => {
		expect(classifyTransition('paused', 'activate')).toBe('forbidden');
		expect(classifyTransition('paused', 'pause')).toBe('forbidden');
		expect(classifyTransition('paused', 'resume')).toBe('active');
		expect(classifyTransition('paused', 'leave')).toBe('left');
		expect(classifyTransition('paused', 'remove')).toBe('removed');
	});

	it('classifies EVERY ordered (state, event) pair — completeness by construction', () => {
		// The S7 exhaustive-matrix doctrine at the unit tier: iterate the enum
		// so a new state added to MEMBERSHIP_STATUSES fails this snapshot until
		// the matrix names it. 5 states × 5 events = 25 classifications.
		const matrix: Record<string, string> = {};
		for (const from of MEMBERSHIP_STATUSES) {
			for (const event of MEMBERSHIP_EVENTS) {
				matrix[`${from}:${event}`] = classifyTransition(from, event);
			}
		}
		expect(Object.keys(matrix)).toHaveLength(MEMBERSHIP_STATUSES.length * MEMBERSHIP_EVENTS.length);
		const allowed = Object.entries(matrix).filter(([, to]) => to !== 'forbidden');
		// Exactly the 7 ratified edges: activate, pause, resume, leave×2, remove×2.
		expect(allowed.sort()).toEqual(
			[
				['active:leave', 'left'],
				['active:pause', 'paused'],
				['active:remove', 'removed'],
				['paused:leave', 'left'],
				['paused:remove', 'removed'],
				['paused:resume', 'active'],
				['pending_assent:activate', 'active'],
			].sort(),
		);
	});

	it('borrowing is DERIVED from status: Active borrows, nobody else does (TIN-3440)', () => {
		const expectations: Record<MembershipStatus, boolean> = {
			pending_assent: false,
			active: true,
			paused: false,
			left: false,
			removed: false,
		};
		for (const status of MEMBERSHIP_STATUSES) {
			expect(canBorrow({ status })).toBe(expectations[status]);
		}
	});
});
