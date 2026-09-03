/**
 * Mailman 3 core REST client + the one-door delivery resolver for the discuss
 * list projections (discuss-board lifecycle spec,
 * `docs/spec/discuss-board-lifecycle-2026-09-01.md`; TIN-3964; ADR 0024 §1.5).
 *
 * List engine: Mailman 3 core REST (pinned trio Mailman 3.3.10 / Postorius
 * 1.3.13 / HyperKitty 1.3.12 — `secrets.contract.yaml`). Two calls, both
 * NATURALLY IDEMPOTENT, which is what lets the outbox's at-least-once
 * delivery run them with no consumer-side receipt table (S3 contract):
 *
 *   subscribe   POST {base}/3.1/members with list_id/subscriber/role=member
 *               and pre_verified/pre_confirmed/pre_approved=true.
 *               HTTP 409 (already a member) = idempotent success.
 *   unsubscribe DELETE {base}/3.1/lists/{list_id}/member/{address}.
 *               HTTP 404 (absent member) = idempotent success — the
 *               "unsubscribe of an absent member is a no-op" contract
 *               the desired-state list reconciler depends on.
 *
 * Auth is HTTP Basic with the Mailman REST credential embedded in the
 * GFTB_MAILMAN_API_URL DSN (`./config.ts`; the credential is the one
 * `secrets.contract.yaml` names `gftb-mailman-admin-password`, plane
 * gftb-infra-sops — a NAME here, never a value).
 *
 * NOTHING THROWN FROM THIS MODULE EVER CARRIES THE DSN OR A MEMBER ADDRESS:
 * error messages land in `outbox_job.last_error`, a durable operator surface
 * (`dispatch.ts`'s redaction is a backstop, never the plan), so they name the
 * operation, the list, and the HTTP status — ids and public names only.
 *
 * `resolveDiscussListDeliveries` is the ONE DOOR from "built" to "reachable"
 * (the `mail/delivery.ts` `resolveDelivery` pattern): a client is constructed
 * only behind `GFTB_LIST_AUTOMATION=enabled`; every other environment gets
 * `undefined`; the worker then defers both list kinds so their rows remain
 * pending with attempts=0 and no network I/O.
 */

import type { ListSubscribeDelivery, ListUnsubscribeDelivery } from '../outbox/handlers/add-lists';
import { readListAutomationConfig } from './config';

/** The discuss list's Mailman list id (list_id form, dots not @). */
export const DISCUSS_LIST_ID = 'discuss.latoolb.us';

/** Default per-request bound so a hung Mailman cannot pin a worker past its lease. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * A Mailman call that failed non-idempotently. Message carries operation,
 * list id, and HTTP status ONLY — never the DSN, never a member address.
 */
export class MailmanRequestError extends Error {
	readonly status: number | null;
	constructor(operation: string, listId: string, status: number | null, detail?: string) {
		super(
			status === null
				? `mailman ${operation} for ${listId} failed before a response${detail ? ` (${detail})` : ''}`
				: `mailman ${operation} for ${listId} returned HTTP ${status}`,
		);
		this.name = 'MailmanRequestError';
		this.status = status;
	}
}

export interface MailmanClient {
	/** Idempotent: HTTP 409 (already a member) completes successfully. */
	subscribe(listId: string, address: string): Promise<void>;
	/** Idempotent: HTTP 404 (absent member) completes successfully. */
	unsubscribe(listId: string, address: string): Promise<void>;
}

export interface MailmanClientDeps {
	/** Test seam: replaces global fetch. */
	fetchFn?: typeof fetch;
	timeoutMs?: number;
}

interface ParsedDsn {
	base: string;
	authorization: string;
}

/** Split the DSN into a credential-free base URL and a Basic Authorization header. */
function parseDsn(apiUrl: string): ParsedDsn {
	let url: URL;
	try {
		url = new URL(apiUrl);
	} catch {
		// Never echo the value — it carries the embedded credential.
		throw new Error('mailman: GFTB_MAILMAN_API_URL did not parse as a URL. Refusing to build a client.');
	}
	const user = decodeURIComponent(url.username);
	const pass = decodeURIComponent(url.password);
	url.username = '';
	url.password = '';
	const base = url.toString().replace(/\/+$/, '');
	return {
		base,
		authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
	};
}

/** Sanitize a transport-level failure: keep an error code/name, drop any message text. */
function transportDetail(error: unknown): string {
	if (error && typeof error === 'object') {
		const cause = (error as { cause?: unknown }).cause;
		if (cause && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string') {
			return (cause as { code: string }).code;
		}
		if (typeof (error as { code?: unknown }).code === 'string') return (error as { code: string }).code;
		if (error instanceof Error) return error.name;
	}
	return 'unknown transport failure';
}

/** Build the thin REST client. Constructed only behind the config gate — see `resolveDiscussListDeliveries`. */
export function createMailmanClient(apiUrl: string, deps: MailmanClientDeps = {}): MailmanClient {
	const { base, authorization } = parseDsn(apiUrl);
	const fetchFn = deps.fetchFn ?? fetch;
	const timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

	async function request(operation: string, listId: string, input: string, init: RequestInit): Promise<Response> {
		try {
			return await fetchFn(input, {
				...init,
				headers: { ...init.headers, Authorization: authorization },
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new MailmanRequestError(operation, listId, null, transportDetail(error));
		}
	}

	return {
		async subscribe(listId: string, address: string): Promise<void> {
			const body = new URLSearchParams({
				list_id: listId,
				subscriber: address,
				role: 'member',
				pre_verified: 'true',
				pre_confirmed: 'true',
				pre_approved: 'true',
			});
			const response = await request('subscribe', listId, `${base}/3.1/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
			});
			// 409: already a member — the idempotent success the at-least-once
			// contract depends on.
			if (response.ok || response.status === 409) return;
			throw new MailmanRequestError('subscribe', listId, response.status);
		},

		async unsubscribe(listId: string, address: string): Promise<void> {
			const response = await request(
				'unsubscribe',
				listId,
				`${base}/3.1/lists/${listId}/member/${encodeURIComponent(address)}`,
				{ method: 'DELETE' },
			);
			// 404: absent member — unsubscribing an absent member is a no-op.
			if (response.ok || response.status === 404) return;
			throw new MailmanRequestError('unsubscribe', listId, response.status);
		},
	};
}

/** The two gate-resolved deliveries the worker wires into the list handlers. */
export interface DiscussListDeliveries {
	/** Idempotently ensure one address is subscribed to discuss. */
	subscribe: ListSubscribeDelivery;
	/** Idempotently ensure one address is absent from discuss. */
	unsubscribe: ListUnsubscribeDelivery;
}

export type ResolveDeps = MailmanClientDeps;

/**
 * The one door from "built" to "reachable": returns `undefined` whenever
 * `GFTB_LIST_AUTOMATION` is not exactly `"enabled"` — the default in every
 * environment this repository's own tests and CI ever run in — and throws
 * `ListConfigError` on a half-configured environment (the worker's BLOCK-1
 * startup posture maps that to exit 78).
 *
 * This resolver exposes single-address idempotent operations only. The
 * application-owned handler resolves membership and complete address history,
 * applies desired state, and re-reads for concurrent offboard/email changes;
 * keeping state reads out of this transport module leaves one convergence
 * algorithm for both activation and removal jobs.
 */
export function resolveDiscussListDeliveries(
	env: NodeJS.ProcessEnv = process.env,
	deps: ResolveDeps = {},
): DiscussListDeliveries | undefined {
	const config = readListAutomationConfig(env);
	if (!config.enabled) return undefined;
	const client = createMailmanClient(config.apiUrl, deps);
	return {
		subscribe: (address) => client.subscribe(DISCUSS_LIST_ID, address),
		unsubscribe: (address) => client.unsubscribe(DISCUSS_LIST_ID, address),
	};
}
