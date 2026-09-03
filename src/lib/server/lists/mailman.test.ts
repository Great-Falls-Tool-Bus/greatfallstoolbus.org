/**
 * Mailman REST client + one-door resolver (TIN-3964). Unit lane: injected
 * `fetchFn`, no database, no network — every request the client would make is
 * captured and answered by a fixture.
 */

import { describe, expect, it } from 'vitest';
import { LIST_AUTOMATION_ENV, ListConfigError, MAILMAN_API_URL_ENV } from './config';
import { DISCUSS_LIST_ID, MailmanRequestError, createMailmanClient, resolveDiscussListDeliveries } from './mailman';

const DSN = 'https://restadmin:pass@mailman.example.invalid/api';

interface Captured {
	input: string;
	init: RequestInit;
}

function fixtureFetch(status: number, captured: Captured[] = []): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		captured.push({ input: String(input), init: init ?? {} });
		// A null-body status (204) must carry no body — undici enforces it.
		const body = status === 204 ? null : status >= 400 ? 'fixture error body' : '{}';
		return new Response(body, { status });
	}) as typeof fetch;
}

describe('createMailmanClient — subscribe', () => {
	it('POSTs the §4 endpoint shape: /3.1/members, form-encoded, pre_* flags, Basic auth, no credential in the URL', async () => {
		const captured: Captured[] = [];
		const client = createMailmanClient(DSN, { fetchFn: fixtureFetch(201, captured) });
		await client.subscribe(DISCUSS_LIST_ID, 'member@example.org');

		expect(captured).toHaveLength(1);
		expect(captured[0].input).toBe('https://mailman.example.invalid/api/3.1/members');
		expect(captured[0].input).not.toContain('restadmin');
		expect(captured[0].init.method).toBe('POST');
		const headers = captured[0].init.headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Basic ${Buffer.from('restadmin:pass').toString('base64')}`);
		const body = new URLSearchParams(String(captured[0].init.body));
		expect(body.get('list_id')).toBe('discuss.latoolb.us');
		expect(body.get('subscriber')).toBe('member@example.org');
		expect(body.get('role')).toBe('member');
		expect(body.get('pre_verified')).toBe('true');
		expect(body.get('pre_confirmed')).toBe('true');
		expect(body.get('pre_approved')).toBe('true');
	});

	it('treats HTTP 409 (already a member) as idempotent success', async () => {
		const client = createMailmanClient(DSN, { fetchFn: fixtureFetch(409) });
		await expect(client.subscribe(DISCUSS_LIST_ID, 'member@example.org')).resolves.toBeUndefined();
	});

	it('throws on any other failure, naming operation/list/status ONLY — never the DSN, never the address', async () => {
		const client = createMailmanClient(DSN, { fetchFn: fixtureFetch(500) });
		let error: MailmanRequestError | undefined;
		try {
			await client.subscribe(DISCUSS_LIST_ID, 'member@example.org');
		} catch (caught) {
			error = caught as MailmanRequestError;
		}
		expect(error).toBeInstanceOf(MailmanRequestError);
		expect(error?.status).toBe(500);
		expect(error?.message).toContain('subscribe');
		expect(error?.message).toContain(DISCUSS_LIST_ID);
		expect(error?.message).not.toContain('restadmin');
		expect(error?.message).not.toContain('member@example.org');
	});
});

describe('createMailmanClient — unsubscribe', () => {
	it('DELETEs the §4 endpoint shape: /3.1/lists/{list_id}/member/{address}', async () => {
		const captured: Captured[] = [];
		const client = createMailmanClient(DSN, { fetchFn: fixtureFetch(204, captured) });
		await client.unsubscribe(DISCUSS_LIST_ID, 'member@example.org');

		expect(captured).toHaveLength(1);
		expect(captured[0].input).toBe(
			'https://mailman.example.invalid/api/3.1/lists/discuss.latoolb.us/member/member%40example.org',
		);
		expect(captured[0].init.method).toBe('DELETE');
	});

	it('treats HTTP 404 (absent member) as the idempotent no-op the remove-lists contract promises', async () => {
		const client = createMailmanClient(DSN, { fetchFn: fixtureFetch(404) });
		await expect(client.unsubscribe(DISCUSS_LIST_ID, 'member@example.org')).resolves.toBeUndefined();
	});

	it('throws on any other failure with status only, DSN and address withheld', async () => {
		const client = createMailmanClient(DSN, { fetchFn: fixtureFetch(403) });
		let message = '';
		try {
			await client.unsubscribe(DISCUSS_LIST_ID, 'member@example.org');
		} catch (caught) {
			message = (caught as Error).message;
		}
		expect(message).toContain('unsubscribe');
		expect(message).toContain('403');
		expect(message).not.toContain('restadmin');
		expect(message).not.toContain('member@example.org');
	});
});

describe('createMailmanClient — transport failures stay sanitized', () => {
	it('wraps a thrown fetch into MailmanRequestError carrying an error code, never the URL', async () => {
		const failingFetch = (async () => {
			const error = new TypeError('fetch failed');
			(error as TypeError & { cause?: unknown }).cause = Object.assign(new Error('getaddrinfo ENOTFOUND host'), {
				code: 'ENOTFOUND',
			});
			throw error;
		}) as typeof fetch;
		const client = createMailmanClient(DSN, { fetchFn: failingFetch });
		let message = '';
		try {
			await client.subscribe(DISCUSS_LIST_ID, 'member@example.org');
		} catch (caught) {
			message = (caught as Error).message;
		}
		expect(message).toContain('ENOTFOUND');
		expect(message).not.toContain('mailman.example.invalid');
		expect(message).not.toContain('restadmin');
	});
});

describe('resolveDiscussListDeliveries — the one door', () => {
	it('resolves to undefined when the gate is closed (the default in every test/CI environment)', () => {
		expect(resolveDiscussListDeliveries({} as NodeJS.ProcessEnv)).toBeUndefined();
	});

	it('throws ListConfigError on a half-configured environment (BLOCK-1: worker startup maps this to exit 78)', () => {
		expect(() => resolveDiscussListDeliveries({ [LIST_AUTOMATION_ENV]: 'enabled' } as NodeJS.ProcessEnv)).toThrow(
			ListConfigError,
		);
	});

	it('returns both deliveries behind the open gate, and subscribe targets the discuss list', async () => {
		const captured: Captured[] = [];
		const deliveries = resolveDiscussListDeliveries(
			{ [LIST_AUTOMATION_ENV]: 'enabled', [MAILMAN_API_URL_ENV]: DSN } as NodeJS.ProcessEnv,
			{ fetchFn: fixtureFetch(201, captured) },
		);
		expect(deliveries).toBeDefined();
		await deliveries?.subscribe('member@example.org');
		expect(captured).toHaveLength(1);
		const body = new URLSearchParams(String(captured[0].init.body));
		expect(body.get('list_id')).toBe(DISCUSS_LIST_ID);
		expect(typeof deliveries?.remove).toBe('function');
	});
});
