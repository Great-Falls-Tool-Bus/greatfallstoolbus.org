import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Shared `no-restricted-syntax` entries. Flat config REPLACES a rule's options
// wholesale when a later object re-configures it for the same file, so every
// scoped block that adds a syntax restriction must re-state the global
// `$derived` rule too — these constants keep the copies identical.
const derivedThunkRestriction = {
	selector: "CallExpression[callee.type='Identifier'][callee.name='$derived'] > ArrowFunctionExpression",
	message:
		'Do not pass an arrow-function thunk to $derived(...). Use $derived(expr) for an expression, or $derived.by(() => …) for a multi-statement derivation.',
};

// `no-restricted-imports` does not see dynamic `import()` — proved by the
// PR #175 adversarial review (`await import('@tummycrypt/tinyland-auth')`
// linted clean). This selector closes that hole for string-literal
// specifiers; a computed specifier is caught at runtime by the adapter
// fence's Proxy (src/lib/server/auth/adapter.ts).
const dynamicAuthImportRestriction = {
	selector: 'ImportExpression > Literal[value=/@tummycrypt\\u002ftinyland-auth/]',
	message:
		'Dynamic import of the auth packages is banned everywhere — the door (src/lib/server/auth) uses ' +
		'static imports, and everything else imports $lib/server/auth.',
};

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				extraFileExtensions: ['.svelte'],
			},
		},
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
			},
		},
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'error',
			// House canon (TIN-2225): ban the `$derived(() => …)` thunk. Passing an
			// arrow to `$derived` stores the *function* as the rune's value instead
			// of evaluating it — a silent reactivity bug. Correct forms:
			//   • `$derived(expr)`        for a single expression
			//   • `$derived.by(() => …)`  for multi-statement derivations
			// `$derived.by(...)` has a MemberExpression callee, so the selector
			// (Identifier callee named `$derived` with a direct arrow argument)
			// leaves it untouched.
			'no-restricted-syntax': ['error', derivedThunkRestriction],
			// Svelte 5 / Skeleton 4 adjustments
			'svelte/no-at-html-tags': 'warn',
			'svelte/no-dom-manipulating': 'off',
			'svelte/require-each-key': 'error',
			'svelte/no-navigation-without-resolve': 'off',
		},
	},
	// ── Import fences ─────────────────────────────────────────────────────────
	// Two lint-enforced boundaries, one rule name. ESLint flat config REPLACES a
	// rule's options wholesale when a later object re-configures it for the same
	// file, so each scope below carries the COMPLETE `no-restricted-imports`
	// options it needs — do not add a new object that re-declares this rule for
	// an overlapping scope, extend the matching one.
	//
	// Fence 1 — the pool (TIN-3817 S1, spec §1.3: "Direct pool access outside
	// `withTenant` is a lint-enforced error"). `withTenant` is the only place
	// that sets the app.tenant_id GUC; a query issued on the raw pool runs with
	// the GUC unset, and under FORCE ROW LEVEL SECURITY that reads as an empty
	// database rather than as an error — the quietest possible bug.
	// `src/lib/server/db/**` is exempt: it is the module that OWNS the pool.
	//
	// Fence 2 — the auth packages (TIN-3817 S2, spec §1.4; REBUILT after the
	// PR #175 adversarial review). The pinned `@tummycrypt/tinyland-auth@0.3.3`
	// still ships TOTP and the ungated fail-open InvitationService that spec §4
	// forbids for Member v0; the pin is NOT the safety mechanism, this fence is
	// (spec §0.7). The packages have one door — `src/lib/server/auth/**`, and
	// from outside only its INDEX — and even inside the door the forbidden
	// names and subpaths stay banned. Lint is one of FOUR layers and not the
	// binding one: the manifest (`src/lib/server/auth/fence.ts`) also drives a
	// runtime Proxy over the adapter's forbidden METHODS, a compile-time
	// Omit<> of the same, and `fence.test.ts`'s tree scan + door export
	// allow-list + the committed reviewer bypass as a negative fixture —
	// deleting a line here fails a test rather than silently widening the
	// surface.
	{
		// Everything outside both fence-owning modules: no pool, no auth
		// packages, no internal adapter seam.
		files: ['src/**/*.ts', 'src/**/*.svelte', 'src/**/*.svelte.ts'],
		ignores: ['src/lib/server/db/**', 'src/lib/server/auth/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '$lib/server/db/client',
							importNames: ['getPool', 'getDb', 'createDb'],
							message:
								'Do not reach for the pool directly. Use withTenant(tenantId, fn) from $lib/server/db/tenant, ' +
								'which sets app.tenant_id inside the transaction and hands you the tx handle to pass on ' +
								'(including to createPgStorageAdapter({ db: tx })).',
						},
					],
					patterns: [
						{
							group: ['**/server/db/client', '../client', './client'],
							importNames: ['getPool', 'getDb', 'createDb'],
							message: 'Do not reach for the pool directly. Use withTenant(tenantId, fn) from $lib/server/db/tenant.',
						},
						{
							group: [
								'@tummycrypt/tinyland-auth',
								'@tummycrypt/tinyland-auth/*',
								'@tummycrypt/tinyland-auth-pg',
								'@tummycrypt/tinyland-auth-pg/*',
							],
							message:
								'The auth packages have one door: import from $lib/server/auth. It withholds the TOTP and ' +
								'invitation surfaces spec §4 forbids at the pinned 0.3.3 (see src/lib/server/auth/index.ts).',
						},
						{
							// The whole door interior is internal: outside code imports
							// $lib/server/auth (the index) and NOTHING deeper, so the
							// export allow-list in fence.ts is the door's entire surface
							// (PR #175 review — deep imports bypassed the index).
							group: ['**/server/auth/*', '$lib/server/auth/*'],
							message:
								'The door has one surface: import from $lib/server/auth (the index). Its export list is ' +
								'the committed allow-list in src/lib/server/auth/fence.ts.',
						},
					],
				},
			],
			'no-restricted-syntax': ['error', derivedThunkRestriction, dynamicAuthImportRestriction],
		},
	},
	{
		// The pool-owning module may touch its own client, but the auth
		// packages stay behind their door even here.
		files: ['src/lib/server/db/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: [
								'@tummycrypt/tinyland-auth',
								'@tummycrypt/tinyland-auth/*',
								'@tummycrypt/tinyland-auth-pg',
								'@tummycrypt/tinyland-auth-pg/*',
							],
							message: 'The auth packages have one door: import from $lib/server/auth.',
						},
						{
							group: ['**/server/auth/*', '$lib/server/auth/*'],
							message: 'The door has one surface: import from $lib/server/auth (the index).',
						},
					],
				},
			],
			'no-restricted-syntax': ['error', derivedThunkRestriction, dynamicAuthImportRestriction],
		},
	},
	{
		// Inside the door: the pool fence still binds (auth code goes through
		// the withTenant tx handle like everything else), and the surfaces spec
		// §4 forbids stay unreachable even for the module that wraps the rest.
		files: ['src/lib/server/auth/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '$lib/server/db/client',
							importNames: ['getPool', 'getDb', 'createDb'],
							message:
								'Do not reach for the pool directly. Use withTenant(tenantId, fn) from $lib/server/db/tenant, ' +
								'which sets app.tenant_id inside the transaction and hands you the tx handle to pass on ' +
								'(including to createPgStorageAdapter({ db: tx })).',
						},
						{
							name: '@tummycrypt/tinyland-auth',
							importNames: [
								'TOTPService',
								'createTOTPService',
								'InvitationService',
								'createInvitationService',
								'BootstrapService',
								'createBootstrapService',
								'generateTOTPSecret',
								'generateTOTPUri',
								'generateTOTPQRCode',
								'generateTOTPToken',
								'getTOTPTimeRemaining',
								'generateTempPassword',
								'generateBackupCodes',
								'createBackupCodeSet',
								'verifyBackupCode',
							],
							message:
								'Forbidden for Member v0 (spec §4): TOTP, invitations, backup codes, and bootstrap are not ' +
								'part of the auth spine, and 0.3.3 ships them ungated — the fence is here, not in the version pin.',
						},
						{
							// PR #175 review: the -pg package was unfenced inside the door.
							// The pool-owning constructors are the exact §1.3 B3 hazard (an
							// adapter with its OWN pool never sees the GUC — silent auth
							// outage under FORCE RLS), and bootstrapUsers writes users
							// outside the spine — and resolves the EXTERNAL, bcrypt-broken
							// copy of tinyland-auth besides.
							name: '@tummycrypt/tinyland-auth-pg',
							importNames: ['createNodePgStorageAdapter', 'NodePgStorageAdapter', 'bootstrapUsers'],
							message:
								'Forbidden for Member v0: pool-owning adapter constructors bypass the withTenant GUC ' +
								'(§1.3 B3), and bootstrapUsers is outside the auth spine. Construct via adapterFor(tx) only.',
						},
					],
					patterns: [
						{
							group: ['**/server/db/client', '../db/client'],
							importNames: ['getPool', 'getDb', 'createDb'],
							message: 'Do not reach for the pool directly. Use withTenant(tenantId, fn) from $lib/server/db/tenant.',
						},
						{
							group: [
								'@tummycrypt/tinyland-auth/totp',
								'@tummycrypt/tinyland-auth/cred-gen',
								'@tummycrypt/tinyland-auth-pg/bootstrap-users',
							],
							message: 'Forbidden subpath for Member v0 (spec §4): no TOTP, no credential generation, no bootstrap.',
						},
					],
				},
			],
			'no-restricted-syntax': ['error', derivedThunkRestriction, dynamicAuthImportRestriction],
		},
	},
	{
		// Tenant isolation is lint-enforced, not conventional (TIN-3817 S1,
		// spec §1.3: "Direct pool access outside `withTenant` is a lint-enforced
		// error"). `withTenant` is the only place that sets the app.tenant_id GUC;
		// a query issued on the raw pool runs with the GUC unset, and under FORCE
		// ROW LEVEL SECURITY that reads as an empty database rather than as an
		// error — the quietest possible bug.
		//
		// `src/lib/server/db/**` is exempt: it is the module that OWNS the pool.
		files: ['src/**/*.ts', 'src/**/*.svelte', 'src/**/*.svelte.ts'],
		ignores: ['src/lib/server/db/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '$lib/server/db/client',
							importNames: ['getPool', 'getDb', 'createDb'],
							message:
								'Do not reach for the pool directly. Use withTenant(tenantId, fn) from $lib/server/db/tenant, ' +
								'which sets app.tenant_id inside the transaction and hands you the tx handle to pass on ' +
								'(including to createPgStorageAdapter({ db: tx })).',
						},
					],
					patterns: [
						{
							group: ['**/server/db/client', '../client', './client'],
							importNames: ['getPool', 'getDb', 'createDb'],
							message: 'Do not reach for the pool directly. Use withTenant(tenantId, fn) from $lib/server/db/tenant.',
						},
					],
				},
			],
		},
	},
	{
		ignores: [
			'build/',
			'drizzle/',
			'**/build/**',
			'.svelte-kit/',
			'**/.svelte-kit/**',
			'dist/',
			'**/dist/**',
			'node_modules/',
			'**/node_modules/**',
			'scripts/',
			'static/',
			'coverage/',
			'**/coverage/**',
			'test-results/',
			'playwright-report/',
			'.claude/',
			'.claude/**',
			'.serena/',
			'.serena/**',
			'.aider*',
			'bazel-*',
			'bazel-*/**',
			'*.config.*',
		],
	},
);
