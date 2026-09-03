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
 *               `../outbox/handlers/remove-lists.ts` already promises.
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

import type { Db } from '../db/client';
import { withTenant } from '../db/tenant';
import { parseListJobPayload, personAddressHistory } from '../membership/provision';
import type { ClaimedJob } from '../outbox/schema';
import type { ListRemovalDelivery } from '../outbox/handlers/remove-lists';
import type { ListSubscribeDelivery } from '../outbox/handlers/add-lists';
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
	/** For `provision.add_lists` — subscribe an address to discuss. */
	subscribe: ListSubscribeDelivery;
	/** For `offboard.remove_lists` — resolve the member's whole address history and unsubscribe every address. */
	remove: ListRemovalDelivery;
}

export interface ResolveDeps extends MailmanClientDeps {
	/** Test seam: the db `withTenant` opens the removal delivery's read on. Production omits it. */
	db?: Db;
	/**
	 * Test seam: replaces the whole withTenant address-history read (the
	 * `add-lists.ts` `readState` idiom), so the every-address removal is
	 * unit-testable without a fixture database. Production omits it.
	 */
	readRemovalAddresses?: (job: ClaimedJob) => Promise<string[]>;
}

/**
 * The one door from "built" to "reachable": returns `undefined` whenever
 * `GFTB_LIST_AUTOMATION` is not exactly `"enabled"` — the default in every
 * environment this repository's own tests and CI ever run in — and throws
 * `ListConfigError` on a half-configured environment (the worker's BLOCK-1
 * startup posture maps that to exit 78).
 *
 * The removal delivery re-reads the person's WHOLE address history inside its
 * own `withTenant` transaction (payloads are ids-only by the S3 doctrine) and
 * unsubscribes EVERY address, superseded rows included: `changeEmail`
 * supersedes addresses with no list projection, so after an email change the
 * subscribed address is a historical one — unsubscribing only the current
 * address would 404 into idempotent "success" and leave the old address a
 * discuss writer forever (PR #239 adversarial verify, MAJOR 1). Each DELETE
 * is 404-tolerant, so the sweep stays idempotent with no receipt table. A
 * person with NO address rows at all throws — ids only — so it retries into
 * dead-letter VISIBLY rather than completing a removal that never happened.
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
		remove: async (job) => {
			const payload = parseListJobPayload(job.payload, job.id);
			const readAddresses =
				deps.readRemovalAddresses ??
				((j: ClaimedJob) => withTenant(j.tenantId, (tx) => personAddressHistory(tx, payload.personId), deps.db));
			const addresses = await readAddresses(job);
			if (addresses.length === 0) {
				throw new Error(
					`offboard.remove_lists: person ${payload.personId} has no address rows — ` +
						`cannot resolve the subscribers to remove (job ${job.id})`,
				);
			}
			for (const address of addresses) {
				await client.unsubscribe(DISCUSS_LIST_ID, address);
			}
		},
	};
}
