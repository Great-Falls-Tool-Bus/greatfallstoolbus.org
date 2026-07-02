import { Effect, Exit, Cause, Schema } from 'effect';

/**
 * Build a `Schema.decodeUnknown(schema)` decoder. Returns an Effect that
 * yields the decoded `A` or fails with a `ParseError`.
 */
export const decode = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknown(schema);

/**
 * Decode an unknown input synchronously and throw on failure. Intended for
 * build-time content ingestion where a malformed input should halt the build.
 */
export const decodeOrThrow =
	<A, I>(schema: Schema.Schema<A, I>) =>
	(input: unknown): A =>
		Effect.runSync(Schema.decodeUnknown(schema)(input));

/** Pretty-print an `Exit` failure cause for logging / build output. */
export const formatExit = <A, E>(exit: Exit.Exit<A, E>): string =>
	Exit.isSuccess(exit) ? 'ok' : Cause.pretty(exit.cause);
