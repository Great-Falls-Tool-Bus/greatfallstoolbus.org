/**
 * Mailman REST client + one-door resolver (TIN-3964). Unit lane: injected
 * `fetchFn`, no database, no network — every request the client would make is
 * captured and answered by a fixture.
 */

import { describe, expect, it } from 'vitest';
import type { ClaimedJob } from '../outbox/schema';
import { LIST_AUTOMATION_ENV, ListConfigError, MAILMAN_API_URL_ENV } from './config';
import { DISCUSS_LIST_ID, MailmanRequestError, createMailmanClient, resolveDiscussListDeliveries } from './mailman';

const DSN = 'https://restadmin:pass@mailman.example.invalid/api';
const OPEN_GATE_ENV = { [LIST_AUTOMATION_ENV]: 'enabled', [MAILMAN_API_URL_ENV]: DSN } as NodeJS.ProcessEnv;

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
		const deliveries = resolveDiscussListDeliveries(OPEN_GATE_ENV, { fetchFn: fixtureFetch(201, captured) });
		expect(deliveries).toBeDefined();
		await deliveries?.subscribe('member@example.org');
		expect(captured).toHaveLength(1);
		const body = new URLSearchParams(String(captured[0].init.body));
		expect(body.get('list_id')).toBe(DISCUSS_LIST_ID);
		expect(typeof deliveries?.remove).toBe('function');
	});
});

/**
 * The remove delivery must sweep the person's WHOLE address history —
 * `changeEmail` supersedes addresses with no list projection, so after an
 * email change the address Mailman still holds is a historical one (PR #239
 * adversarial verify, MAJOR 1). History rides the `readRemovalAddresses`
 * test seam (the add-lists `readState` idiom): no database, no network.
 */
describe('resolveDiscussListDeliveries — the remove delivery unsubscribes the whole address history', () => {
	const MEMBERSHIP_ID = '22222222-3333-4444-8555-666666666666';
	const PERSON_ID = '33333333-4444-4555-8666-777777777777';

	function removalJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
		return {
			id: 'job-remove-1',
			tenantId: '11111111-2222-4333-8444-555555555555',
			kind: 'offboard.remove_lists',
			aggregateType: 'membership',
			aggregateId: MEMBERSHIP_ID,
			payload: { membershipId: MEMBERSHIP_ID, personId: PERSON_ID },
			idempotencyKey: `tenant:membership:${MEMBERSHIP_ID}:remove_lists`,
			status: 'leased',
			attempts: 0,
			maxAttempts: 8,
			availableAt: new Date(),
			leaseOwner: 'worker#lease-1',
			leaseExpiresAt: new Date(Date.now() + 60_000),
			lastError: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			leaseToken: 'worker#lease-1',
			...overrides,
		};
	}

	/** Answers request N with statuses[N] (last status repeats). */
	function sequencedFetch(statuses: number[], captured: Captured[]): typeof fetch {
		let call = 0;
		return (async (input: string | URL | Request, init?: RequestInit) => {
			captured.push({ input: String(input), init: init ?? {} });
			const status = statuses[Math.min(call, statuses.length - 1)];
			call += 1;
			const body = status === 204 ? null : status >= 400 ? 'fixture error body' : '{}';
			return new Response(body, { status });
		}) as typeof fetch;
	}

	it('after an email change, offboarding unsubscribes BOTH the old and the new address', async () => {
		const captured: Captured[] = [];
		const deliveries = resolveDiscussListDeliveries(OPEN_GATE_ENV, {
			fetchFn: sequencedFetch([204], captured),
			readRemovalAddresses: async () => ['old@example.org', 'new@example.org'],
		});
		await expect(deliveries?.remove(removalJob())).resolves.toBeUndefined();
		expect(captured).toHaveLength(2);
		expect(captured[0].input).toBe(
			'https://mailman.example.invalid/api/3.1/lists/discuss.latoolb.us/member/old%40example.org',
		);
		expect(captured[1].input).toBe(
			'https://mailman.example.invalid/api/3.1/lists/discuss.latoolb.us/member/new%40example.org',
		);
		expect(captured.every((request) => request.init.method === 'DELETE')).toBe(true);
	});

	it('tolerates 404 on any historical address (absent member = idempotent no-op) and still sweeps the rest', async () => {
		const captured: Captured[] = [];
		const deliveries = resolveDiscussListDeliveries(OPEN_GATE_ENV, {
			// The new (current) address 404s — the post-change offboard shape —
			// and the sweep still reaches and removes the old one.
			fetchFn: sequencedFetch([404, 204], captured),
			readRemovalAddresses: async () => ['new@example.org', 'old@example.org'],
		});
		await expect(deliveries?.remove(removalJob())).resolves.toBeUndefined();
		expect(captured).toHaveLength(2);
	});

	it('a non-idempotent failure on ANY address in the sweep still throws (retry → dead-letter visibly)', async () => {
		const captured: Captured[] = [];
		const deliveries = resolveDiscussListDeliveries(OPEN_GATE_ENV, {
			fetchFn: sequencedFetch([204, 500], captured),
			readRemovalAddresses: async () => ['old@example.org', 'new@example.org'],
		});
		await expect(deliveries?.remove(removalJob())).rejects.toThrow(MailmanRequestError);
		expect(captured).toHaveLength(2);
	});

	it('a person with NO address rows throws ids-only — dead-letters visibly, never a faked removal', async () => {
		const captured: Captured[] = [];
		const deliveries = resolveDiscussListDeliveries(OPEN_GATE_ENV, {
			fetchFn: sequencedFetch([204], captured),
			readRemovalAddresses: async () => [],
		});
		let message = '';
		try {
			await deliveries?.remove(removalJob());
		} catch (caught) {
			message = (caught as Error).message;
		}
		expect(message).toContain(PERSON_ID);
		expect(message).toContain('job-remove-1');
		expect(message).not.toContain('@');
		expect(captured).toHaveLength(0);
	});
});
