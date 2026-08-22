/**
 * Unit half of the S3 outbox rows (TIN-3817): everything provable without a
 * database. The claim/lease/retry/dead-letter semantics against real
 * PostgreSQL live in `outbox.integration.test.ts` under `just
 * test-integration`; these rows pin the backoff envelope, the registry's
 * poison contract, enqueue's fail-fast input guards, and the worker process
 * boundary's argument/exit-code contract.
 */

import { describe, expect, it } from 'vitest';
import type { DbTransaction } from '../db/client';
import { describeFailure, fullJitterBackoffMs, redactSecrets, runWorkerLoop } from './dispatch';
import { enqueue } from './enqueue';
import { EMPTY_REGISTRY, UnknownJobKindError, createHandlerRegistry } from './handlers';
import { DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_CAP_MS, MAX_LAST_ERROR_LENGTH, type ClaimedJob } from './schema';
import { WORKER_EXIT, runWorker } from '../worker';

function capture() {
	const chunks: string[] = [];
	return { write: (chunk: string) => chunks.push(chunk), text: () => chunks.join('') };
}

/**
 * enqueue validates its INPUT before it touches the transaction, so these
 * rows may hand it a poisoned handle: reaching the handle at all would throw
 * the marker error instead of the expected message, failing the row.
 */
const neverTouched = new Proxy(
	{},
	{
		get() {
			throw new Error('enqueue touched the transaction before validating its input');
		},
	},
) as unknown as DbTransaction;

describe('fullJitterBackoffMs', () => {
	it('draws uniformly from [0, min(cap, base·2^attempts))', () => {
		for (let attempts = 1; attempts <= 8; attempts += 1) {
			const ceiling = Math.min(DEFAULT_BACKOFF_CAP_MS, DEFAULT_BACKOFF_BASE_MS * 2 ** attempts);
			expect(fullJitterBackoffMs(attempts, { random: () => 0 })).toBe(0);
			// random() < 1 by contract, so the ceiling itself is exclusive; one ulp
			// below it must floor to ceiling - 1.
			expect(fullJitterBackoffMs(attempts, { random: () => 1 - Number.EPSILON })).toBe(ceiling - 1);
		}
	});

	it('caps the envelope so late attempts stop growing', () => {
		const atCap = fullJitterBackoffMs(50, { random: () => 1 - Number.EPSILON });
		expect(atCap).toBe(DEFAULT_BACKOFF_CAP_MS - 1);
	});

	it('is actually jittered — the whole point, per spec §3.1 lockstep note', () => {
		const draws = new Set(Array.from({ length: 32 }, () => fullJitterBackoffMs(4)));
		expect(draws.size).toBeGreaterThan(1);
	});

	it('treats attempts below 1 as 1 rather than shrinking the window to zero', () => {
		expect(fullJitterBackoffMs(0, { random: () => 1 - Number.EPSILON })).toBe(2 * DEFAULT_BACKOFF_BASE_MS - 1);
	});

	it('honors a per-worker base/cap override', () => {
		expect(fullJitterBackoffMs(3, { baseMs: 10, capMs: 50, random: () => 1 - Number.EPSILON })).toBe(49);
	});
});

describe('describeFailure', () => {
	it('keeps the error name and message', () => {
		expect(describeFailure(new RangeError('boom'))).toBe('RangeError: boom');
	});

	it('stringifies non-Error throws', () => {
		expect(describeFailure('just a string')).toBe('just a string');
	});

	it('bounds last_error so a looping stack trace cannot bloat the row', () => {
		const text = describeFailure(new Error('x'.repeat(MAX_LAST_ERROR_LENGTH * 2)));
		expect(text.length).toBe(MAX_LAST_ERROR_LENGTH);
	});

	// last_error carries payload's "never a secret" contract; redaction is the
	// backstop for third-party client errors (PR #173 review, LOW-3).
	it('redacts URL userinfo the way a pg/HTTP client error embeds it', () => {
		const text = describeFailure(new Error('connect failed: postgres://gftb_app:hunter2@db.example.com:5432/gftb'));
		expect(text).not.toContain('hunter2');
		expect(text).toContain('//***:***@db.example.com');
	});

	it('redacts bearer tokens', () => {
		expect(redactSecrets('401 from upstream: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig rejected')).not.toContain(
			'eyJhbGciOiJIUzI1NiJ9',
		);
	});

	it('redacts credential-shaped key=value pairs', () => {
		// The value is deliberately NOT shaped like any real vendor token —
		// this repository is public and gitleaks scans the test file too.
		const text = redactSecrets('request failed: api_key=fake0credential0value status=402');
		expect(text).not.toContain('fake0credential0value');
		expect(text).toContain('api_key=***');
		expect(text).toContain('status=402');
	});

	it('leaves ordinary error text alone', () => {
		expect(redactSecrets('ECONNREFUSED db.example.com:5432 — retrying')).toBe(
			'ECONNREFUSED db.example.com:5432 — retrying',
		);
	});
});

describe('handler registry', () => {
	const noop = async (): Promise<void> => undefined;

	it('resolves a registered kind', () => {
		const registry = createHandlerRegistry({ 'fixture.noop': noop });
		expect(registry.resolve('fixture.noop')).toBe(noop);
		expect(registry.kinds()).toEqual(['fixture.noop']);
	});

	it('throws UnknownJobKindError for an unregistered kind, naming what it knows', () => {
		const registry = createHandlerRegistry({ 'fixture.noop': noop });
		expect(() => registry.resolve('fixture.gone')).toThrowError(UnknownJobKindError);
		expect(() => registry.resolve('fixture.gone')).toThrow(/fixture\.gone/);
		expect(() => registry.resolve('fixture.gone')).toThrow(/fixture\.noop/);
	});

	it('ships EMPTY_REGISTRY fail-closed: every kind is poison until S7/S9 register real handlers', () => {
		expect(EMPTY_REGISTRY.kinds()).toEqual([]);
		expect(() => EMPTY_REGISTRY.resolve('member.offboard.revoke_lists')).toThrowError(UnknownJobKindError);
		expect(() => EMPTY_REGISTRY.resolve('member.offboard.revoke_lists')).toThrow(/no handlers registered at all/);
	});

	it('rejects a registry whose handler is not a function', () => {
		expect(() => createHandlerRegistry({ bad: 'nope' as unknown as () => Promise<void> })).toThrow(/is not a function/);
	});
});

describe('enqueue input guards (fail fast, before the transaction)', () => {
	const valid = {
		kind: 'fixture.noop',
		aggregateType: 'fixture',
		aggregateId: '00000000-0000-4000-8000-000000000000',
		payload: {},
		idempotencyKey: 'key-1',
	};

	it.each([
		[{ ...valid, kind: '' }, /"kind"/],
		[{ ...valid, idempotencyKey: ' ' }, /"idempotencyKey"/],
		[{ ...valid, aggregateType: '' }, /"aggregateType"/],
		[{ ...valid, aggregateId: 'not-a-uuid' }, /"aggregateId"/],
		[{ ...valid, maxAttempts: 0 }, /"maxAttempts"/],
		[{ ...valid, maxAttempts: 1.5 }, /"maxAttempts"/],
		[{ ...valid, payload: undefined }, /"payload"/],
	])('rejects %j', async (input, message) => {
		await expect(enqueue(neverTouched, input as typeof valid)).rejects.toThrow(message);
	});
});

describe('the worker process boundary', () => {
	const env = {
		DATABASE_URL: 'postgres://name-only.invalid/db',
		GFTB_TENANT_ID: '11111111-2222-4333-8444-555555555555',
	};

	it('answers --help with 0 and never touches the database', async () => {
		const stdout = capture();
		const code = await runWorker({
			args: ['--help'],
			env: {},
			io: { stdout, stderr: capture() },
			dispatchOnceFn: () => {
				throw new Error('--help must not dispatch');
			},
		});
		expect(code).toBe(WORKER_EXIT.OK);
		expect(stdout.text()).toContain('Usage: worker');
		expect(stdout.text()).toContain('SKIP LOCKED');
	});

	it('rejects an unknown argument with EX_USAGE and prints the usage', async () => {
		const stderr = capture();
		const code = await runWorker({ args: ['--frobnicate'], env, io: { stdout: capture(), stderr } });
		expect(code).toBe(WORKER_EXIT.USAGE);
		expect(stderr.text()).toContain('--frobnicate');
		expect(stderr.text()).toContain('Usage: worker');
	});

	it.each([
		['--batch', 'zero', ['--batch', '0']],
		['--lease', 'negative', ['--lease', '-5']],
		['--idle', 'non-numeric', ['--idle', 'soon']],
		['--tenant', 'valueless', ['--tenant']],
	])('rejects a %s flag with a %s value as EX_USAGE', async (_flag, _shape, args) => {
		const code = await runWorker({ args, env, io: { stdout: capture(), stderr: capture() } });
		expect(code).toBe(WORKER_EXIT.USAGE);
	});

	it('exits 78 when DATABASE_URL is not set, naming the apply plane', async () => {
		const stderr = capture();
		const code = await runWorker({ args: [], env: {}, io: { stdout: capture(), stderr } });
		expect(code).toBe(WORKER_EXIT.UNAVAILABLE);
		expect(stderr.text()).toContain('DATABASE_URL');
	});

	it('exits 78 when no tenant is configured, naming GFTB_TENANT_ID', async () => {
		const stderr = capture();
		const code = await runWorker({
			args: [],
			env: { DATABASE_URL: env.DATABASE_URL },
			io: { stdout: capture(), stderr },
		});
		expect(code).toBe(WORKER_EXIT.UNAVAILABLE);
		expect(stderr.text()).toContain('GFTB_TENANT_ID');
	});

	it('exits 78 when the tenant is not a UUID', async () => {
		const code = await runWorker({
			args: ['--tenant', 'not-a-uuid'],
			env,
			io: { stdout: capture(), stderr: capture() },
		});
		expect(code).toBe(WORKER_EXIT.UNAVAILABLE);
	});

	it('--once runs exactly one dispatch cycle with the parsed options and exits 0', async () => {
		const seen: Array<Record<string, unknown>> = [];
		const stdout = capture();
		const code = await runWorker({
			args: ['--once', '--batch', '7', '--lease', '15', '--worker-id', 'unit-worker'],
			env,
			io: { stdout, stderr: capture() },
			probeTenantFn: async () => true,
			dispatchOnceFn: async (options) => {
				seen.push({ ...options });
				return { claimed: 2, done: 1, retried: 1, dead: 0, lost: 0 };
			},
		});
		expect(code).toBe(WORKER_EXIT.OK);
		expect(seen).toHaveLength(1);
		expect(seen[0].tenantId).toBe(env.GFTB_TENANT_ID.toLowerCase());
		expect(seen[0].batchSize).toBe(7);
		expect(seen[0].leaseSeconds).toBe(15);
		expect(seen[0].worker).toBe('unit-worker');
		expect(stdout.text()).toContain('claimed=2 done=1 retried=1 dead=0 lost=0');
	});

	it('runs the polling loop until the shutdown signal and exits 0', async () => {
		const controller = new AbortController();
		const stdout = capture();
		const code = await runWorker({
			args: [],
			env,
			io: { stdout, stderr: capture() },
			signal: controller.signal,
			probeTenantFn: async () => true,
			runLoopFn: async (options) => {
				expect(options.signal).toBe(controller.signal);
				controller.abort();
			},
		});
		expect(code).toBe(WORKER_EXIT.OK);
		expect(stdout.text()).toContain('worker: shutdown');
	});

	it('reports an infrastructure failure from the loop as 78, not a crash', async () => {
		const stderr = capture();
		const code = await runWorker({
			args: [],
			env,
			io: { stdout: capture(), stderr },
			probeTenantFn: async () => true,
			runLoopFn: async () => {
				throw new Error('connection refused');
			},
		});
		expect(code).toBe(WORKER_EXIT.UNAVAILABLE);
		expect(stderr.text()).toContain('connection refused');
	});

	it('exits 78 when the configured tenant does not exist, naming it (review MEDIUM-3)', async () => {
		const stderr = capture();
		const code = await runWorker({
			args: ['--once'],
			env,
			io: { stdout: capture(), stderr },
			probeTenantFn: async () => false,
			dispatchOnceFn: () => {
				throw new Error('a nonexistent tenant must never dispatch');
			},
		});
		expect(code).toBe(WORKER_EXIT.UNAVAILABLE);
		expect(stderr.text()).toContain(env.GFTB_TENANT_ID.toLowerCase());
		expect(stderr.text()).toContain('does not exist');
		// The honest limit is documented where the operator will read it:
		expect(stderr.text()).toContain('wrong-but-REAL');
	});

	it('exits 78 when the tenant probe cannot reach the database', async () => {
		const stderr = capture();
		const code = await runWorker({
			args: ['--once'],
			env,
			io: { stdout: capture(), stderr },
			probeTenantFn: async () => {
				throw new Error('connection refused');
			},
		});
		expect(code).toBe(WORKER_EXIT.UNAVAILABLE);
		expect(stderr.text()).toContain('while verifying tenant');
	});

	it('defaults to the union registry: S9 stripe.project plus S7 offboarding, nothing else', async () => {
		// No registry is passed: this exercises `defaultRegistry(env)` itself,
		// the same path `main()` takes in production. `env` above carries no
		// Stripe keys, so the Stripe entry wraps the keyless disabled gateway —
		// still correctly REGISTERED (a `stripe.project` job would be
		// attempted, not dead-lettered as unknown-kind). Both S9's kind and
		// S7's three offboarding kinds have landed; any OTHER kind still
		// dead-letters visibly. The announce line is the operator's proof of
		// exactly which effects this worker can perform.
		const stdout = capture();
		await runWorker({
			args: ['--once'],
			env,
			io: { stdout, stderr: capture() },
			probeTenantFn: async () => true,
			dispatchOnceFn: async () => ({ claimed: 0, done: 0, retried: 0, dead: 0, lost: 0 }),
		});
		expect(stdout.text()).toContain(
			'kinds: stripe.project, offboard.cancel_billing, offboard.remove_lists, offboard.disable_mailbox',
		);
	});

	it('still announces "none registered" for a caller-supplied EMPTY_REGISTRY (e.g. an operator forcing fail-closed)', async () => {
		const stdout = capture();
		await runWorker({
			args: ['--once'],
			env,
			io: { stdout, stderr: capture() },
			registry: EMPTY_REGISTRY,
			probeTenantFn: async () => true,
			dispatchOnceFn: async () => ({ claimed: 0, done: 0, retried: 0, dead: 0, lost: 0 }),
		});
		expect(stdout.text()).toContain('none registered');
	});

	// BLOCK-1 regression rows (PR #185 adversarial review): defaultRegistry(env)
	// reads Stripe config and THROWS on a half-configured environment — a real,
	// non-secret trigger (STRIPE_PUBLISHABLE_KEY alone, exactly the shape of a
	// shared ConfigMap/envFrom value). Building the registry after the early
	// returns, inside a try mapped to WORKER_EXIT.UNAVAILABLE, must hold for
	// BOTH the --help fast path and the normal dispatch path — and must still
	// hold now that S7's three (Stripe-config-free) offboarding handlers are
	// folded into the same `defaultRegistry(env)` call.
	it('BLOCK-1: --help still exits 0 even with a half-configured Stripe env that would throw building the registry', async () => {
		const stdout = capture();
		const code = await runWorker({
			args: ['--help'],
			env: { STRIPE_PUBLISHABLE_KEY: 'pk_test_x' },
			io: { stdout, stderr: capture() },
			dispatchOnceFn: () => {
				throw new Error('--help must not dispatch');
			},
		});
		expect(code).toBe(WORKER_EXIT.OK);
		expect(stdout.text()).toContain('Usage: worker');
	});

	it('BLOCK-1: a half-configured Stripe env exits 78 with a worker-prefixed message, never an unhandled throw', async () => {
		const stderr = capture();
		const code = await runWorker({
			args: ['--once'],
			env: { ...env, STRIPE_PUBLISHABLE_KEY: 'pk_test_x' },
			io: { stdout: capture(), stderr },
			probeTenantFn: async () => true,
			dispatchOnceFn: () => {
				throw new Error('a registry-construction failure must never reach dispatch');
			},
		});
		expect(code).toBe(WORKER_EXIT.UNAVAILABLE);
		expect(stderr.text()).toMatch(/^worker: /);
		expect(stderr.text()).toContain('half-configured');
	});
});

describe('runWorkerLoop transient-cycle tolerance (review NIT-1)', () => {
	const base = {
		tenantId: '11111111-2222-4333-8444-555555555555',
		worker: 'loop-unit',
		registry: EMPTY_REGISTRY,
		idleDelayMs: 1,
	};

	it('rides out a transient cycle failure and keeps polling', async () => {
		const controller = new AbortController();
		let calls = 0;
		const errors: number[] = [];
		await runWorkerLoop({
			...base,
			signal: controller.signal,
			maxConsecutiveCycleFailures: 5,
			onCycleError: (_error, consecutive) => errors.push(consecutive),
			dispatchOnceFn: async () => {
				calls += 1;
				if (calls === 1) throw new Error('transient blip');
				if (calls >= 3) controller.abort();
				return { claimed: 0, done: 0, retried: 0, dead: 0, lost: 0 };
			},
		});
		expect(calls).toBeGreaterThanOrEqual(3);
		expect(errors).toEqual([1]); // the counter reset after the recovery
	});

	it('rethrows after maxConsecutiveCycleFailures so a dead database still exits 78', async () => {
		let calls = 0;
		await expect(
			runWorkerLoop({
				...base,
				maxConsecutiveCycleFailures: 2,
				dispatchOnceFn: async () => {
					calls += 1;
					throw new Error('database is gone');
				},
			}),
		).rejects.toThrow('database is gone');
		expect(calls).toBe(2);
	});
});

// Type-level pin: enqueue's first parameter is a TRANSACTION handle, not a Db —
// the whole §3.1 mechanism. If the parameter is ever widened (e.g. to
// `DbTransaction | Db`), this assignment stops compiling.
type EnqueueFirstParam = Parameters<typeof enqueue>[0];
const _txOnly: EnqueueFirstParam extends DbTransaction ? true : never = true;
void _txOnly;

// Shape pin for ClaimedJob so the dispatcher's row mapping cannot silently
// drop a §3.1 field.
const _claimedJobShape: keyof ClaimedJob extends
	| 'id'
	| 'tenantId'
	| 'kind'
	| 'aggregateType'
	| 'aggregateId'
	| 'payload'
	| 'idempotencyKey'
	| 'status'
	| 'attempts'
	| 'maxAttempts'
	| 'availableAt'
	| 'leaseOwner'
	| 'leaseExpiresAt'
	| 'lastError'
	| 'createdAt'
	| 'updatedAt'
	| 'leaseToken'
	? true
	: never = true;
void _claimedJobShape;
