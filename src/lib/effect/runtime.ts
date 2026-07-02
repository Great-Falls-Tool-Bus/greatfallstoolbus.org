import { Effect, Exit, Layer } from 'effect';

/**
 * Empty placeholder layer. Real services land in M3+ when build-time
 * data ingestion and provider-matrix loading need typed dependencies.
 */
export const AppLayer = Layer.empty;

/**
 * Drain an Effect to its success value or throw the failure cause.
 * Use only for top-level call sites that already handle their own errors.
 */
export const runOrThrow = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
	Effect.runPromise(effect as Effect.Effect<A, E, never>);

/** Re-export the canonical Exit-returning runner for callers that need to inspect failures. */
export const runExit = Effect.runPromiseExit;

export type AppExit<A, E> = Exit.Exit<A, E>;
