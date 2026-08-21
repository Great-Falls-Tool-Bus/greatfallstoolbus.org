/**
 * S4 unit rows for the token substrate (slices §1.6 acceptance):
 * an expired token is rejected; a replayed (already-consumed) token is
 * rejected; the plaintext never appears in any log line (log-capture) and the
 * stored representation is a hash. The database-bound halves of the same
 * properties re-run in application.integration.test.ts against real rows.
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	TOKEN_BYTES,
	TokenRejectedError,
	VERIFY_EMAIL_TOKEN_TTL_MS,
	assessTokenRow,
	generateToken,
	hashToken,
	type AssessableTokenRow,
} from './tokens';

const NOW = new Date('2026-08-20T12:00:00Z');

function row(overrides: Partial<AssessableTokenRow> = {}): AssessableTokenRow {
	return {
		purpose: 'verify_email',
		expiresAt: new Date(NOW.getTime() + VERIFY_EMAIL_TOKEN_TTL_MS),
		consumedAt: null,
		...overrides,
	};
}

describe('generateToken / hashToken — random, opaque, hashed at rest (spec §4)', () => {
	it('mints base64url tokens carrying the full entropy width', () => {
		const token = generateToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(Buffer.from(token, 'base64url')).toHaveLength(TOKEN_BYTES);
		expect(generateToken()).not.toBe(token);
	});

	it('hashes to 64 lowercase hex, deterministically, and never to the token itself', () => {
		const token = generateToken();
		const hash = hashToken(token);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
		expect(hash).toBe(hashToken(token));
		expect(hash).not.toContain(token);
	});
});

describe('assessTokenRow — the single-use/expiry decision (S4 acceptance rows 1-2)', () => {
	it('rejects an expired token', () => {
		expect(assessTokenRow(row({ expiresAt: new Date(NOW.getTime() - 1) }), 'verify_email', NOW)).toBe('expired');
	});

	it('treats exactly-now expiry as expired, not valid', () => {
		expect(assessTokenRow(row({ expiresAt: NOW }), 'verify_email', NOW)).toBe('expired');
	});

	it('rejects a replayed (already-consumed) token', () => {
		expect(assessTokenRow(row({ consumedAt: new Date(NOW.getTime() - 1000) }), 'verify_email', NOW)).toBe('consumed');
	});

	it('reads consumed-AND-expired as consumed — replay is the stronger signal', () => {
		expect(assessTokenRow(row({ consumedAt: NOW, expiresAt: new Date(NOW.getTime() - 1) }), 'verify_email', NOW)).toBe(
			'consumed',
		);
	});

	it('rejects an unknown token and a wrong-purpose token', () => {
		expect(assessTokenRow(undefined, 'verify_email', NOW)).toBe('unknown');
		expect(assessTokenRow(row({ purpose: 'withdraw' }), 'verify_email', NOW)).toBe('wrong_purpose');
	});

	it('accepts a live, unconsumed, unexpired token; a withdraw token never time-expires', () => {
		expect(assessTokenRow(row(), 'verify_email', NOW)).toBe('valid');
		expect(assessTokenRow(row({ purpose: 'withdraw', expiresAt: null }), 'withdraw', NOW)).toBe('valid');
	});
});

describe('TokenRejectedError — one public message, nothing enumerable', () => {
	it('says the same thing for every refusal reason', () => {
		const reasons = ['unknown', 'consumed', 'expired', 'wrong_purpose'] as const;
		const messages = new Set(reasons.map((r) => new TokenRejectedError(r).message));
		expect(messages.size).toBe(1);
		for (const r of reasons) {
			const err = new TokenRejectedError(r);
			expect(err.message).not.toContain(r);
			expect(err.reason).toBe(r);
		}
	});
});

describe('log capture — the plaintext token appears in no log line (S4 acceptance row 3)', () => {
	const captured: string[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		captured.length = 0;
	});

	it('emits nothing containing the token across mint-shaped and refusal-shaped paths', () => {
		const record = (...args: unknown[]) => {
			captured.push(args.map(String).join(' '));
			return true;
		};
		for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
			vi.spyOn(console, method).mockImplementation(record);
		}
		vi.spyOn(process.stdout, 'write').mockImplementation(record as never);
		vi.spyOn(process.stderr, 'write').mockImplementation(record as never);

		const token = generateToken();
		const hash = hashToken(token);
		assessTokenRow(row(), 'verify_email', NOW);
		assessTokenRow(row({ consumedAt: NOW }), 'verify_email', NOW);
		assessTokenRow(row({ expiresAt: new Date(0) }), 'verify_email', NOW);
		const rejection = new TokenRejectedError('expired');

		expect(rejection.message).not.toContain(token);
		expect(rejection.stack ?? '').not.toContain(token);
		expect(hash).not.toContain(token);
		for (const line of captured) {
			expect(line).not.toContain(token);
		}
	});
});
