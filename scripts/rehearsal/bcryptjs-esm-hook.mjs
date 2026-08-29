/**
 * A Node module-customization hook (Node's `node:module` `register()` API)
 * that fixes ONE specific interop gap for running this repo's server code
 * under plain `tsx`/`node`, outside Vite's SSR pipeline.
 *
 * THE GAP: `@tummycrypt/tinyland-auth@0.3.3` (the pinned auth package this
 * repo's door re-exports, `src/lib/server/auth/index.ts`) does
 * `import * as bcrypt from 'bcryptjs'` and then calls `bcrypt.hash(...)`.
 * `bcryptjs` is a UMD/CommonJS package; Node's default CJS->ESM interop for
 * `import * as ns from 'a-cjs-package'` uses static analysis
 * (`cjs-module-lexer`) to detect named exports, and that analysis does not
 * recognize bcryptjs's export shape — `ns.hash` comes back `undefined`
 * (`ns.default.hash` is the real function). `vitest.integration.config.ts`
 * already documents and fixes this exact gap for the test runner via Vite's
 * `ssr.noExternal: ['@tummycrypt/tinyland-auth']`, which routes the import
 * through Vite's own CJS-interop transform instead of Node's. A plain `tsx`
 * script has no such pipeline, so the same gap reappears here.
 *
 * THE FIX, NARROWLY SCOPED: intercept ONLY `bcryptjs`'s own module URL and
 * hand back a synthetic ES module that `require()`s it (true CommonJS load,
 * which sees `module.exports` correctly with `.hash`/`.compare`/etc. as
 * direct properties) and re-exports those properties by name. Every other
 * module — including every other CJS dependency in this dependency graph —
 * passes straight through to `nextLoad` untouched.
 *
 * Registered from `first-membership.mts` via `module.register()` BEFORE that
 * file's own dynamic import of the actual harness implementation, so it is
 * live for the whole import graph the harness pulls in (including the auth
 * package, transitively, through `$lib/server/auth`).
 */

import { fileURLToPath } from 'node:url';

const BCRYPTJS_RE = /[\\/]node_modules[\\/]bcryptjs[\\/]/;

export async function load(url, context, nextLoad) {
	if (BCRYPTJS_RE.test(url)) {
		const path = fileURLToPath(url);
		return {
			format: 'module',
			shortCircuit: true,
			source: `
				import { createRequire } from 'node:module';
				const require = createRequire(${JSON.stringify(url)});
				const bcryptjsCjs = require(${JSON.stringify(path)});
				export default bcryptjsCjs;
				export const hash = bcryptjsCjs.hash;
				export const hashSync = bcryptjsCjs.hashSync;
				export const compare = bcryptjsCjs.compare;
				export const compareSync = bcryptjsCjs.compareSync;
				export const genSalt = bcryptjsCjs.genSalt;
				export const genSaltSync = bcryptjsCjs.genSaltSync;
				export const getRounds = bcryptjsCjs.getRounds;
				export const getSalt = bcryptjsCjs.getSalt;
				export const setRandomFallback = bcryptjsCjs.setRandomFallback;
				export const truncates = bcryptjsCjs.truncates;
			`,
		};
	}
	return nextLoad(url, context);
}
