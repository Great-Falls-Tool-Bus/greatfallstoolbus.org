/**
 * The handler registry — the job-execution interface S3 stops at
 * (TIN-3817 slice S3, spec §3.1).
 *
 * S3 ships the QUEUE, not the effects. No handler in Member v0 exists yet:
 * S7 registers the offboarding projections (revoke-lists, disable-mailbox,
 * cancel-billing) and S9 registers the Stripe rows. Nothing here sends mail,
 * calls a payment processor, or reaches any live delivery target — and the
 * production worker starts with `EMPTY_REGISTRY` below, which is fail-closed
 * on purpose.
 *
 * UNKNOWN KIND IS POISON, NOT A CRASH. A job whose `kind` has no handler —
 * a removed handler, a typo, a payload from a future deploy — is spec §3.1's
 * deterministic-failure case: it burns its attempts and dead-letters VISIBLY.
 * `UnknownJobKindError` is an ordinary handler failure to the dispatcher, so
 * the row keeps its retry/backoff/dead-letter path and is never dropped and
 * never rolls back the committed state change that created it.
 */

import type { HandlerRegistry, OutboxHandler } from './schema';

/** A job named a kind this worker has no handler for. Deterministic poison. */
export class UnknownJobKindError extends Error {
	readonly kind: string;

	constructor(kind: string, known: string[]) {
		super(
			`outbox: no handler registered for kind "${kind}" ` +
				(known.length > 0 ? `(known: ${known.join(', ')})` : '(this worker has no handlers registered at all)'),
		);
		this.name = 'UnknownJobKindError';
		this.kind = kind;
	}
}

/**
 * Build an immutable registry from a kind → handler map. Immutable on
 * purpose: the set of effects a worker can perform is deployment
 * configuration, not runtime state, so there is no `register` method to call
 * from inside a handler.
 */
export function createHandlerRegistry(handlers: Record<string, OutboxHandler>): HandlerRegistry {
	const map = new Map(Object.entries(handlers));
	for (const [kind, handler] of map) {
		if (!kind.trim()) throw new Error('outbox: a handler kind must be a non-empty string');
		if (typeof handler !== 'function') {
			throw new Error(`outbox: the handler for kind "${kind}" is not a function`);
		}
	}
	return {
		resolve(kind: string): OutboxHandler {
			const handler = map.get(kind);
			if (!handler) throw new UnknownJobKindError(kind, [...map.keys()]);
			return handler;
		},
		kinds(): string[] {
			return [...map.keys()];
		},
	};
}

/**
 * What the production worker runs until S7/S9 register real handlers: every
 * claimed job dead-letters visibly through `UnknownJobKindError` instead of
 * being silently "completed" by a placeholder. A worker that exited 0 while
 * discarding jobs would be the queue-shaped version of the S0 placeholder bug
 * (a Deployment reporting healthy while doing nothing).
 */
export const EMPTY_REGISTRY: HandlerRegistry = createHandlerRegistry({});
