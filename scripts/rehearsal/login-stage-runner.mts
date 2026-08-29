#!/usr/bin/env -S pnpm exec tsx
/**
 * S12 login-stage runner for the S1 membership rehearsal harness
 * (scripts/rehearsal/first-membership.mts).
 *
 * WHY THIS IS A SEPARATE FILE, RUN AS A SEPARATE PROCESS: `/login` (TIN-3440
 * slice S12) does not exist on `main` as of this rehearsal — it ships on the
 * still-open PR #198 (`feat/tin-3440-s12-login`). The parent harness checks
 * this out into its own throwaway `git worktree` for this stage only (never
 * touching the caller's actual working tree) and spawns this script with its
 * CWD set to that worktree, so its relative import below resolves against
 * PR #198's tree — including its own `$lib` alias config and its own changes
 * to `src/lib/server/application/ratelimit.ts` / `auth/session.ts` that the
 * route depends on. It talks to the SAME Postgres database as the parent
 * process purely through inherited env (`DATABASE_URL`, `GFTB_TENANT_ID`) —
 * no in-memory state crosses the process boundary.
 *
 * When PR #198 has merged, the parent harness imports `_createLoginAction`
 * directly (no worktree, no subprocess) and this file is unused for that run
 * — kept for whenever a future slice repeats this same "route only exists on
 * an open PR" situation.
 *
 * Also registers the same `bcryptjs-esm-hook.mjs` the parent process
 * registers (see that file's header) — `authenticate()` calls
 * `verifyPassword()`, which needs the same bcryptjs ESM-interop fix, and this
 * is a separate `node`/`tsx` process so the parent's registration does not
 * carry over.
 *
 * argv: [identifier, password]
 * stdout: one line of JSON — { outcome, sessionId }
 */
import { register } from 'node:module';

register('./bcryptjs-esm-hook.mjs', import.meta.url);

const { _createLoginAction } = await import('./src/routes/login/+page.server.ts');

const [, , identifier, password] = process.argv;
if (!identifier || !password) {
	console.error('usage: login-stage-runner.mts <identifier> <password>');
	process.exit(2);
}

function cookieJar() {
	const jar = new Map<string, string>();
	return {
		set: (name: string, value: string) => jar.set(name, value),
		get: (name: string) => jar.get(name),
	};
}

async function main() {
	const jar = cookieJar();
	const body = new URLSearchParams({ identifier, password });
	const event = {
		request: new Request('http://localhost/login', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
		}),
		getClientAddress: () => '203.0.113.9',
		cookies: { set: (n: string, v: string) => jar.set(n, v) },
		locals: { authSession: null },
	} as never;

	const action = _createLoginAction();
	let outcome: unknown;
	try {
		outcome = await action(event);
	} catch (error) {
		const redirectLike = error as { status?: number; location?: string };
		outcome =
			redirectLike && typeof redirectLike.status === 'number' && redirectLike.location
				? { redirected: redirectLike.location, status: redirectLike.status }
				: { threw: String(error) };
	}
	console.log(JSON.stringify({ outcome, sessionId: jar.get('gftb_session') ?? null }));
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
