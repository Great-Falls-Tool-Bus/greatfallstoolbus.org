/**
 * `adapter.ts`'s naive-timestamp parser, DB-free unit lane (TIN-4217).
 *
 * The property under test: `parseDbInstant`/`tryParseDbInstant` must NEVER
 * heuristically reparse a shape they do not recognise through bare
 * `new Date(text)` — that heuristic is exactly what let a PostgreSQL
 * `datestyle` of `'SQL, DMY'` turn a naive timestamp into a silently
 * valid-but-wrong instant instead of a detectable rejection (measured against
 * real PostgreSQL in `auth.integration.test.ts`'s calendar-independent rows).
 * This file proves the parser's OWN contract without a database: given the
 * exact TEXT PostgreSQL would render under a hostile `datestyle`, the parser
 * must reject it, not guess.
 */

import { describe, expect, it } from 'vitest';
import { parseDbInstant, toUtcIso, tryParseDbInstant } from './adapter';

describe('tryParseDbInstant — strict, no heuristic fallback (TIN-4217 acceptance (a))', () => {
	it('accepts the auth.* naive-column shape (space-separated), treating it as UTC', () => {
		const result = tryParseDbInstant('2026-09-05 12:00:00');
		expect(result).toEqual({ ok: true, instant: new Date('2026-09-05T12:00:00.000Z') });
	});

	it('accepts the naive shape with a T separator and fractional seconds', () => {
		const result = tryParseDbInstant('2026-09-05T12:00:00.123456');
		expect(result.ok).toBe(true);
		expect((result as { ok: true; instant: Date }).instant.toISOString()).toBe('2026-09-05T12:00:00.123Z');
	});

	it('accepts a fully zone-qualified ISO instant (its own normalized output, re-parsed)', () => {
		const result = tryParseDbInstant('2026-09-05T12:00:00.000Z');
		expect(result).toEqual({ ok: true, instant: new Date('2026-09-05T12:00:00.000Z') });
	});

	it('accepts an ISO instant with a numeric offset designator', () => {
		const result = tryParseDbInstant('2026-09-05T12:00:00.000+05:00');
		expect(result.ok).toBe(true);
	});

	it('an already-Invalid Date is reported as ok:false, not silently returned', () => {
		expect(tryParseDbInstant(new Date(NaN))).toEqual({ ok: false, raw: String(new Date(NaN)) });
	});

	it('a valid Date instance passes through unchanged', () => {
		const d = new Date('2026-01-01T00:00:00.000Z');
		expect(tryParseDbInstant(d)).toEqual({ ok: true, instant: d });
	});

	// The actual TIN-4217 defect, at the parser level: exactly the TEXT a
	// naive `auth.*` timestamp column renders as under `datestyle = 'SQL,
	// DMY'`. Every row here is a date whose day-of-month is <= 12 — the
	// heuristic-`new Date()` case that used to misparse `DD/MM/YYYY` as
	// `MM/DD/YYYY` into a VALID, WRONG instant instead of failing.
	const DMY_RENDERED_AMBIGUOUS = [
		'05/09/2026 12:00:00', // 5 Sep 2026 — heuristic reads it as 9 May 2026
		'01/12/2026 00:00:00.500', // 1 Dec 2026 — heuristic reads it as 12 Jan 2026
		'29/02/2028 12:00:00', // leap day, rendered DMY
		'31/12/2026 23:30:00', // year boundary, rendered DMY
	];
	it.each(DMY_RENDERED_AMBIGUOUS)('rejects DMY-rendered %s as ok:false — NEVER a heuristic MM/DD reparse', (text) => {
		const result = tryParseDbInstant(text);
		expect(result).toEqual({ ok: false, raw: text });
	});

	it.each(DMY_RENDERED_AMBIGUOUS)(
		'parseDbInstant(%s) is Invalid Date (back-compat view) — never a plausible-looking wrong date',
		(text) => {
			expect(Number.isNaN(parseDbInstant(text).getTime())).toBe(true);
		},
	);

	it('rejects genuinely garbled text the same way — no partial-credit parsing', () => {
		expect(tryParseDbInstant('not a timestamp at all')).toEqual({ ok: false, raw: 'not a timestamp at all' });
	});

	it('rejects a bare date with no time component (ambiguous separator handling)', () => {
		expect(tryParseDbInstant('2026-09-05').ok).toBe(false);
	});
});

describe('toUtcIso — unchanged contract, now backed by the strict parser', () => {
	it('normalizes a naive column value to a zone-qualified ISO string', () => {
		expect(toUtcIso('2026-09-05 12:00:00')).toBe('2026-09-05T12:00:00.000Z');
	});

	it('leaves DMY-rendered (now-unparseable) text untouched rather than guessing', () => {
		expect(toUtcIso('05/09/2026 12:00:00')).toBe('05/09/2026 12:00:00');
	});
});
