#!/usr/bin/env node
/**
 * `just leak-scan-src` — a NARROW subset of the shared leak rules, scoped to
 * `src/**`: this repo's application source.
 *
 * WHY THIS EXISTS. Adversarial review of the porting PR (finding B2) found
 * that this repo's `leak-scan-tree` gate — scoped to docs/static/top-level
 * prose — would have caught only 2 of this repo's 5 historical consent
 * redaction commits; the other 3 lived in `src/**` (test fixtures and
 * routes), including a plain "Firstname Surname" with no embedded initial
 * and a personal mailbox on this repo's own domain. Neither gitleaks
 * (`just secrets-scan-dir`) nor `scan-endpoints` catches that class either —
 * gitleaks has no rule for a personal name or a postal address, and
 * `scan-endpoints` allowlists this repo's own domains outright, so it never
 * even looks at a mailbox on them. A personal name, a postal address, and a
 * keyholder mailbox in a `src/**` fixture were invisible to every gate in
 * `just check`, before this script existed.
 *
 * WHY NARROW, NOT THE FULL RULE SET. The lane's original fixture-noise
 * argument for excluding `src/**` entirely was correct, and measured: the
 * FULL rule set over `src/**` (177 scannable files) produces ~70 findings —
 * secret-assignment and localhost-reference alone account for most of them,
 * because application source legitimately contains dev-server URLs and
 * credential-SHAPED (never real) fixture assignments by the dozen. But
 * restricted to the two rules that carry this gate's actual identity/consent
 * value-add (private-personal-name, private-list-archive) PLUS the
 * always-on mailbox allowlist check, the same 177 files produce 11 findings
 * in 3 files — 9 of them inside this PR's own src/lib/leak-scan.test.ts
 * fixtures (self-excluded below, same rationale scan-endpoints.sh's own
 * `self_exclude` uses: a detector's synthetic test fixtures are reviewed by
 * construction). The unreviewed-outbound-host check is switched off entirely
 * (see checkHosts in scripts/lib/leak-scan.mjs) — `src/**` legitimately cites
 * a large number of benign external URLs (API docs, upstream references)
 * that have nothing to do with the identity/consent class this gate targets
 * and would otherwise reintroduce the noise problem the narrowing exists to
 * avoid.
 *
 * WHAT THIS DOES NOT COVER, even combined with leak-scan-tree. Shape-based
 * detection cannot see a private name with no embedded initial
 * ("Jane Doe" with no "J." form anywhere) — that class is a disclosed,
 * open limit, not something this recipe closes. See the porting PR's limits
 * section.
 *
 * Same fail-closed contract as the other two leak-scan runners: exit 2 on a
 * structural failure (missing/empty scan, unclassified extension, a
 * SCAN_ROOTS entry matching zero tracked paths), exit 1 on any finding.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { LEAK_RULES, REPO_ROOT, SKIP_EXTENSIONS, TEXT_EXTENSIONS, scanText } from './lib/leak-scan.mjs';

const SCAN_ROOTS = ['src'];

/** The two rules this narrow gate actually runs (plus the always-on mailbox
 * allowlist check inside scanText, which excludeRuleIds cannot turn off —
 * that is intentional, it is one of this gate's two value-add checks). */
const INCLUDED_RULE_IDS = new Set(['private-personal-name', 'private-list-archive']);
const EXCLUDE_RULE_IDS = LEAK_RULES.map((rule) => rule.id).filter((id) => !INCLUDED_RULE_IDS.has(id));

/** This gate's own synthetic detection fixtures (J. Doe, Jane Q. Doe, a
 * hyperkitty keyholders archive URL, ...) are reviewed by construction — the
 * whole point of src/lib/leak-scan.test.ts is to contain exactly the shapes
 * this rule set detects. Same rationale as scan-internal-endpoints.sh's own
 * `self_exclude`. Every OTHER src/** file still gets scanned in full. */
const SELF_EXCLUDE = /^src\/lib\/leak-scan\.test\.ts$/u;

/**
 * Per-file, per-rule exceptions on turning `leak-scan-src` on for the first
 * time. NOT a blanket allowlist — file + rule scoped, each with a citation.
 * Flagged prominently in the porting PR body as findings a human should be
 * able to see and reverse, not a silent pass.
 *
 *   - src/lib/data/mail-clients.ts: `ARCHIVE.url` is the keyholders
 *     HyperKitty archive's LIST-level URL (not a thread/message URL, so no
 *     member conversation content is embedded in the string itself) and its
 *     own adjacent `status: 'private or off'` field already documents that
 *     the archive CONTENT is access-gated. This is deliberate, reviewed
 *     operator behavior, not an accidental disclosure this PR is grandfathering
 *     blind: commit 941735d "docs(mail): make keyholders a private role list"
 *     (#52) edited these exact generated SKILL.md files WHILE making the list
 *     private, and chose to KEEP the archive URL line rather than remove it —
 *     i.e. the operator already made and recorded this exact call. The
 *     generated `.agents/skills/gftb-mail-laceup-<client>/SKILL.md` files are this
 *     repo's own agent-lace-up surface for its OWN keyholders (who already
 *     have standing to know where their list's archive lives), not gftb-site's
 *     general-public surface, which is the context private-list-archive's
 *     rule description was originally written against.
 *   - src/lib/server/membership/agreement-publish.integration.test.ts: the
 *     matched string is a synthetic test fixture display name
 *     ("M. Ember" — a pun on "member"), not a real person; same class as this
 *     gate's own J. Doe / Jane Q. Doe fixtures, just in a different test file.
 * @type {{ file: string, ruleId: string, reason: string }[]}
 */
const PER_FILE_EXCEPTIONS = [
	{
		file: 'src/lib/data/mail-clients.ts',
		ruleId: 'private-list-archive',
		reason: 'deliberate, reviewed operator behavior — see commit 941735d, cited above.',
	},
	{
		file: 'src/lib/server/membership/agreement-publish.integration.test.ts',
		ruleId: 'private-personal-name',
		reason: 'synthetic test fixture display name ("M. Ember"), not a real person.',
	},
	{
		file: 'src/lib/naming-consent.ts',
		ruleId: 'unreviewed-mailbox',
		reason:
			'schematic address-SHAPE example in the assertNoBareEmailAddress docstring ' +
			'(the placeholder local-part/domain form the guard itself documents) — not a ' +
			'mailbox. The docstring describing the mailbox guard necessarily names the shape.',
	},
];

function fail(message) {
	console.error(`leak-scan-src: ${message}`);
	process.exit(2);
}

let tracked;
try {
	tracked = execFileSync('git', ['ls-files', '--', ...SCAN_ROOTS], { cwd: REPO_ROOT, encoding: 'utf8' })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
} catch (error) {
	fail(`\`git ls-files\` failed — cannot enumerate the tracked tree: ${error.message}`);
}

// FAIL CLOSED on partial surface loss, same guard as leak-scan-tree (B4):
// `src` disappearing or being renamed should be a structural failure, not a
// silently smaller green.
const rootHits = new Map(SCAN_ROOTS.map((root) => [root, 0]));
for (const relative of tracked) {
	for (const root of SCAN_ROOTS) {
		if (relative === root || relative.startsWith(`${root}/`)) rootHits.set(root, rootHits.get(root) + 1);
	}
}
const emptyRoots = SCAN_ROOTS.filter((root) => rootHits.get(root) === 0);
if (emptyRoots.length > 0) {
	fail(`${emptyRoots.length} configured SCAN_ROOTS entr(y/ies) matched ZERO tracked paths: ${emptyRoots.join(', ')}`);
}

const unclassified = [];
const files = [];
for (const relative of tracked.sort()) {
	if (SELF_EXCLUDE.test(relative)) continue;
	const absolute = path.join(REPO_ROOT, relative);
	try {
		statSync(absolute);
	} catch (error) {
		fail(`${relative} is tracked by git but missing on disk: ${error.message}`);
	}
	const extension = path.extname(relative).toLowerCase();
	if (SKIP_EXTENSIONS.has(extension)) continue;
	if (TEXT_EXTENSIONS.has(extension)) {
		files.push(relative);
		continue;
	}
	unclassified.push(relative);
}

if (unclassified.length > 0) {
	fail(
		`${unclassified.length} tracked file(s) under ${SCAN_ROOTS.join(', ')} have an extension this scanner ` +
			`has no verdict for:\n` +
			unclassified.map((file) => `  ${file}`).join('\n') +
			`\nAdd each extension to TEXT_EXTENSIONS or SKIP_EXTENSIONS in scripts/lib/leak-scan.mjs, then re-run.`,
	);
}

if (files.length === 0) {
	fail(`zero scannable files found under ${SCAN_ROOTS.join(', ')} — refusing to report a pass on an empty walk.`);
}

const deniedLiterals = (process.env.GFTB_LEAK_SCAN_DENY ?? '')
	.split(',')
	.map((literal) => literal.trim())
	.filter(Boolean);

let rawFindings;
try {
	rawFindings = files.flatMap((relative) =>
		scanText(relative, readFileSync(path.join(REPO_ROOT, relative), 'utf8'), {
			deniedLiterals,
			excludeRuleIds: EXCLUDE_RULE_IDS,
			checkHosts: false,
		}),
	);
} catch (error) {
	fail(`scan failed structurally rather than producing a verdict: ${error.message}`);
}

// Reviewed, NOT silent: every exception is printed even when it does not
// fail the gate, so a CI log always shows exactly what was grandfathered and
// why — a reader does not have to open source to discover a pass happened.
const exceptioned = rawFindings.filter((finding) =>
	PER_FILE_EXCEPTIONS.some((exc) => exc.file === finding.file && exc.ruleId === finding.ruleId),
);
const findings = rawFindings.filter((finding) => !exceptioned.includes(finding));

if (exceptioned.length > 0) {
	console.log(`leak-scan-src: ${exceptioned.length} reviewed exception(s), not counted as failures:`);
	for (const finding of exceptioned) {
		const exc = PER_FILE_EXCEPTIONS.find((e) => e.file === finding.file && e.ruleId === finding.ruleId);
		console.log(`  ${finding.file}:${finding.line}: [${finding.ruleId}] ${exc.reason}`);
	}
}

if (findings.length > 0) {
	for (const finding of findings) {
		console.error(`${finding.file}:${finding.line}: [${finding.ruleId}] ${finding.description} — ${finding.excerpt}`);
	}
	console.error(`leak-scan-src: ${findings.length} finding(s) in ${files.length} tracked file(s)`);
	process.exit(1);
}

const denyNote =
	deniedLiterals.length > 0
		? `${deniedLiterals.length} operator-supplied literal(s)`
		: 'no operator-supplied literals (set GFTB_LEAK_SCAN_DENY to add real private names)';
console.log(
	`leak-scan-src: clean across ${files.length} tracked file(s) under ${SCAN_ROOTS.join(', ')} using ` +
		`${[...INCLUDED_RULE_IDS].join(' + ')} + the mailbox allowlist check, and ${denyNote}`,
);
