// `just discuss-drafts-validate` — compile every .svx in
// src/content/discuss-drafts/** with mdsvex and validate its frontmatter
// against DiscussDraftFrontmatter, then independently re-run the
// naming-consent, no-bare-email-address, and no-bare-phone-number gates
// against both the RAW file text (frontmatter and body) AND the filename
// itself (the slug is never written into a draft's own text, only used as
// the filename — see discuss-draft-schema.ts — so it needs its own check).
// This is deliberately redundant with the gates scripts/discuss-to-svx.mjs
// already runs at generation time: this file exists so a hand-edited draft
// (or a draft authored by a different tool entirely, or a draft simply
// renamed after generation) still fails `just check`, not just gitleaks.
//
// Also asserts every `published: false` draft still carries the
// pending-notice HTML comment, matching scripts/discuss-to-svx.mjs's output
// shape — a draft silently missing that comment would read as staged content
// rather than a pending-operator-action placeholder.
//
// It is NOT a failure for this directory to be empty or absent: unlike
// src/content/tools/**, drafts are expected to drain to zero over time as the
// operator posts and reconciles them.
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compile } from 'mdsvex';
import { Either, Schema } from 'effect';
import { decideIdentityGateScope } from '../src/lib/discuss-drafts-ci-scope.ts';
import { DiscussDraftFrontmatter, SOURCE_LIST, TARGET_LIST } from '../src/lib/data/discuss-draft-schema.ts';
import {
	assertNamingConsent,
	assertNoBareEmailAddress,
	assertNoBarePhoneNumber,
	isIdentityGateAvailable,
	KEY_FILE,
	loadCommittedHashes,
	NamingConsentError,
} from '../src/lib/naming-consent.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_ROOT = fileURLToPath(new URL('../src/content/discuss-drafts', import.meta.url));
const CONTENT_ROOT_REL = path.relative(ROOT, CONTENT_ROOT);
const PENDING_COMMENT = 'pending discuss@ posting by operator; svx to be reconciled to the posted archive URL';
const decode = Schema.decodeUnknownEither(DiscussDraftFrontmatter);

// EDIT-2 (v2 round 3 fix): shape-check the committed hash list
// UNCONDITIONALLY, even when the identity gate can't run at all (key
// absent). This needs no key — it's a pure structural check
// (loadCommittedHashes -> validateHashList) — so there is no excuse for
// skipping it. Before this fix, an emptied/malformed/non-JSON
// naming-consent.hashes.json was invisible to CI: the identity call that
// would have loaded it was itself skipped whenever the key was absent.
try {
	loadCommittedHashes();
} catch (error) {
	console.error(
		`FAIL naming-consent.hashes.json shape-check\n     ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
}

function git(args: string[]): string | undefined {
	try {
		return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return undefined;
	}
}

/**
 * Resolves a base ref to diff against. Tries an explicit override (mainly
 * for tests/local overrides), then any local ref for main, then attempts a
 * shallow fetch of origin/main — covers CI checkouts that only fetched the
 * PR ref and never had main locally at all. Returns undefined only if none
 * of that works, which the caller must treat as "could not determine",
 * never as "nothing changed".
 */
function resolveBaseRef(): string | undefined {
	const override = process.env.GFTB_CHECK_BASE_REF;
	if (override) return override;
	for (const candidate of ['origin/main', 'main']) {
		if (git(['rev-parse', '--verify', '--quiet', candidate]) !== undefined) return candidate;
	}
	if (git(['fetch', '--quiet', '--depth=1', 'origin', 'main']) !== undefined) {
		if (git(['rev-parse', '--verify', '--quiet', 'origin/main']) !== undefined) return 'origin/main';
	}
	return undefined;
}

/**
 * Every path under src/content/discuss-drafts/** that differs from
 * `baseRef` (committed changes, tree-to-tree so it works under a shallow
 * clone — no merge-base/history walk required) UNIONed with any
 * uncommitted local changes there (git status), so a not-yet-committed
 * local edit is caught too, not just what's already in history.
 */
function changedDraftPaths(baseRef: string): string[] {
	const changed = new Set<string>();
	const committed = git(['diff', '--name-only', baseRef, 'HEAD', '--', CONTENT_ROOT_REL]);
	for (const line of (committed ?? '').split('\n')) {
		if (line.trim()) changed.add(line.trim());
	}
	const status = git(['status', '--porcelain', '--', CONTENT_ROOT_REL]);
	for (const line of (status ?? '').split('\n')) {
		const p = line.slice(3).trim();
		if (p) changed.add(p);
	}
	return [...changed].sort();
}

const identityGateAvailable = isIdentityGateAvailable();
const baseRef = identityGateAvailable ? undefined : resolveBaseRef();
const scope = decideIdentityGateScope({
	identityGateAvailable,
	baseRefResolved: baseRef !== undefined,
	changedDraftPaths: baseRef ? changedDraftPaths(baseRef) : [],
});

if (scope.action === 'fail') {
	console.error(`FAIL naming-consent identity gate (CI scope)\n     ${scope.reason}`);
	console.error(`     (${KEY_FILE} is not present in this environment.)`);
	process.exit(1);
}
if (scope.action === 'skip-loud') {
	console.warn(
		`WARN naming-consent identity gate SKIPPED: ${KEY_FILE} is not present in this environment.\n` +
			`     ${scope.reason}\n` +
			'     Schema, pending-comment, and generic email/phone checks below still ran.',
	);
}

async function* walk(dir: string): AsyncGenerator<string> {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
		throw error;
	}
	for (const entry of entries) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(p);
		else if (p.endsWith('.svx')) yield p;
	}
}

let failures = 0;
let checked = 0;
const fail = (file: string, message: string): void => {
	failures++;
	console.error(`FAIL ${path.relative(process.cwd(), file)}\n     ${message}`);
};

const bySlug = new Map<string, string>();

for await (const file of walk(CONTENT_ROOT)) {
	checked++;
	const rel = path.relative(process.cwd(), file);
	const source = await fs.readFile(file, 'utf8');

	// Gate the raw file TEXT (frontmatter + body) — this catches anything a
	// hand-edited draft slipped into sourceMessageId, subject, or body. It
	// does NOT cover the filename itself: `slug` is never written into the
	// file's own text (see discuss-draft-schema.ts), only used as the
	// filename, so a violation hiding only in a renamed file would be
	// invisible to a raw-text scan — gated separately below.
	try {
		if (scope.action === 'run-full') {
			assertNamingConsent(source, rel);
		}
		assertNoBareEmailAddress(source, [SOURCE_LIST, TARGET_LIST], rel);
		assertNoBarePhoneNumber(source, rel);
	} catch (error) {
		fail(file, error instanceof NamingConsentError ? error.message : String(error));
		continue;
	}

	if (scope.action === 'run-full') {
		const slugFromFilename = path.basename(file, '.svx');
		try {
			assertNamingConsent(slugFromFilename, `${rel} (filename)`);
		} catch (error) {
			fail(file, error instanceof NamingConsentError ? error.message : String(error));
			continue;
		}
	}

	let fm: unknown;
	try {
		const compiled = await compile(source, { extensions: ['.svx'] });
		fm = compiled?.data?.fm;
	} catch (error) {
		fail(file, `mdsvex failed to compile: ${String(error)}`);
		continue;
	}
	const result = decode(fm);
	if (Either.isLeft(result)) {
		fail(file, String(result.left));
		continue;
	}
	const draft = result.right;

	const slug = path.basename(file, '.svx');
	const priorSlug = bySlug.get(slug);
	if (priorSlug) {
		fail(file, `duplicate slug '${slug}' (also ${path.relative(process.cwd(), priorSlug)})`);
		continue;
	}
	bySlug.set(slug, file);

	if (!draft.published && !source.includes(PENDING_COMMENT)) {
		fail(file, `published:false draft is missing the pending-notice HTML comment ("${PENDING_COMMENT}")`);
		continue;
	}

	console.log(`OK   ${rel} -> ${draft.subject} [published:${draft.published}]`);
}

if (checked === 0) {
	console.log(`no .svx files under ${CONTENT_ROOT} — nothing to validate.`);
}

console.log(
	failures ? `\n${failures} failure(s) across ${checked} file(s).` : `\nAll ${checked} discuss-draft file(s) valid.`,
);
process.exit(failures ? 1 : 0);
