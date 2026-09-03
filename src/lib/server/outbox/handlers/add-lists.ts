/**
 * `provision.add_lists` (discuss-board lifecycle spec,
 * `docs/spec/discuss-board-lifecycle-2026-09-01.md`; TIN-3964; ADR 0024 §1.5
 * "Activation emits idempotent mailbox and discussion-list projection
 * intent"; operator ruling 2026-09-01: "membership account creation is the
 * ONLY path that adds users to the discuss board").
 *
 * THE MAIL PLANE IS NOT THIS REPOSITORY'S (packet 0001 Amendment 1 / AGENTS
 * non-negotiables): Mailman, its credentials, and every list mutation live in
 * `great-falls-tool-bus-infra`; this public repo holds zero secrets and zero
 * cluster endpoints, ever. So the handler is a SEAM, exactly
 * `remove-lists.ts`'s shape: when a delivery function is injected (the worker
 * wires one only behind `GFTB_LIST_AUTOMATION=enabled` —
 * `../../lists/mailman.ts`'s one-door resolver), it subscribes the member's
 * current address to discuss — idempotently, because Mailman answers a
 * duplicate subscribe with HTTP 409 and the client treats that as success;
 * when list automation is GATE-DISABLED — the default, and the truthful state
 * of this deployment — the job completes as a RECORDED no-op: completion is
 * the record, the job row's `done` status is durable, and nothing is ever
 * faked as "subscribed" when no subscribe happened. NOTE (corrected
 * 2026-09-03, PR #239 adversarial verify, MAJOR 2): the recorded no-op row is
 * `done` under the activation's identity key, and `enqueue()` absorbs a
 * re-enqueue of a done key silently (`enqueued: false`) — so a gate flip does
 * NOT retroactively subscribe gate-closed activations, and an operator re-run
 * keyed by the same identity keys covers only PRE-GATE activations (no row at
 * all). Covering the recorded no-ops needs the audited replay surface
 * (`../enqueue.ts` docstring: reset attempts/status — a named follow-up, not
 * yet built) or a distinct reconciliation key; the spec's shipped-status note
 * carries the same correction.
 *
 * STALENESS GUARD (payloads are ids-only, S3 doctrine): the handler re-reads
 * CURRENT membership status and CURRENT address in its own `withTenant`
 * transaction (the `stripe-project.ts` handler shape). If offboarding raced
 * ahead (`left`/`removed`), it completes as a recorded no-op — the standing
 * `offboard.remove_lists` job owns the removal, and re-subscribing a departed
 * member would violate the ruling. `active` AND `paused` both subscribe:
 * pause preserves discussion access by ratified design
 * (`../../membership/transition.ts`).
 *
 * A configured-but-failing delivery throws: retry → dead-letter VISIBLY,
 * membership stays active (the dispatcher owns attempts/backoff/dead-letter;
 * this handler does no retry logic of its own). Logs and thrown messages
 * carry ids only — never an address.
 */

import type { Db } from '../../db/client';
import { withTenant } from '../../db/tenant';
import { listProjectionState, parseListJobPayload, type ListProjectionState } from '../../membership/provision';
import type { ClaimedJob, OutboxHandler } from '../schema';

export const ADD_LISTS_JOB_KIND = 'provision.add_lists';

/** The injectable delivery seam — the worker wires the real Mailman subscribe behind the gate. */
export type ListSubscribeDelivery = (address: string) => Promise<void>;

export interface AddListsSeams {
	delivery?: ListSubscribeDelivery;
	log?: (line: string) => void;
	/** Test seam: the db `withTenant` opens the staleness re-read on. Production omits it (pool fence). */
	db?: Db;
	/** Test seam: replaces the whole withTenant re-read, so the staleness guard is unit-testable without a fixture database. */
	readState?: (job: ClaimedJob) => Promise<ListProjectionState>;
}

export function createAddListsHandler(seams: AddListsSeams = {}): OutboxHandler {
	const log = seams.log ?? ((line: string) => console.log(line));
	return async function addListsHandler(job: ClaimedJob): Promise<void> {
		// Validate BEFORE any gate check or database work: a malformed payload
		// is deterministic poison and must dead-letter visibly even while the
		// gate is closed, never be silently completed by the no-op path.
		const payload = parseListJobPayload(job.payload, job.id);

		if (!seams.delivery) {
			// Gate-disabled list automation: complete as a recorded no-op. The
			// line carries ids only — never an address (S3 payload doctrine
			// applies to logs the same way).
			log(`[provision.add_lists] list automation gate-disabled; recorded no-op for membership ${job.aggregateId}`);
			return;
		}

		const readState =
			seams.readState ??
			((j: ClaimedJob) => withTenant(j.tenantId, (tx) => listProjectionState(tx, payload), seams.db));
		const state = await readState(job);

		if (state.membershipStatus === null) {
			throw new Error(`provision.add_lists: membership ${payload.membershipId} not found (job ${job.id})`);
		}
		if (state.membershipStatus === 'left' || state.membershipStatus === 'removed') {
			// Offboarding raced ahead: the standing offboard.remove_lists job
			// owns the removal; re-subscribing would violate the ruling.
			log(
				`[provision.add_lists] membership ${payload.membershipId} is ${state.membershipStatus}; ` +
					'recorded no-op — offboard.remove_lists owns the list state now',
			);
			return;
		}
		if (!state.address) {
			throw new Error(
				`provision.add_lists: person ${payload.personId} has no current address row — ` +
					`cannot resolve the subscriber (job ${job.id})`,
			);
		}

		// The network call runs OUTSIDE the read transaction (at-least-once by
		// contract; the subscribe is naturally idempotent via 409-tolerance).
		// KNOWN LIMITATION (PR #239 adversarial verify, LOW): the staleness
		// read above and this subscribe are not atomic — an offboard whose
		// remove_lists job enqueues, claims, AND completes inside that window
		// is outrun by this late subscribe, and nothing removes it. The window
		// is one attempt wide (retries re-read), accepted for the minimal
		// slice; the gate-opening reconciliation is the backstop.
		await seams.delivery(state.address);
	};
}
