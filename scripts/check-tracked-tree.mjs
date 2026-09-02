#!/usr/bin/env node
/**
 * `just leak-scan-tree` — run the shared leak rules over this repo's
 * PUBLISHED-PROSE surface: docs/, static/ (non-binary), and the top-level
 * README/AGENTS/CLAUDE/NOTICE/LICENSE/CHANGELOG/SECURITY/RELEASING files.
 *
 * NOT a straight port: gftb-site's leak-scan only ever scans a materialized
 * build/ directory (scripts/lib/leak-scan.mjs's own header explains why —
 * that repo is pure static content, so "what gets built" and "what gets
 * published to the public GitHub repo" are close enough to the same thing).
 * This repo is different: it is an `app-stateful-spoke` (AGENTS.md), most of
 * `src/**` never reaches a client bundle or the adapter-node server output (the
 * SvelteKit `$lib/server` boundary), yet every tracked file is still visible
 * on the public GitHub repo regardless of whether it is ever built or
 * rendered.
 *
 * MEASURED COVERAGE, NOT A CLAIM OF COMPLETENESS. Two separate measurements,
 * re-run against this file's own tip after the review-5384138539 fix round —
 * neither is a projection:
 *
 *   1. `leak-scan-tree` ALONE (this gate, docs/static/top-level-prose only,
 *      the surface that existed at review time): re-running its CURRENT
 *      (fixed, value-shaped) rule set over the pre/post diff of all five
 *      historical redaction commits still catches only the 2 that were ever
 *      in its scope — `dfdb8cd`, `e5903ed` (both `docs/**`-scoped) — because
 *      the other 3 lived entirely in `src/**`, which this gate does not walk.
 *      That is a scope limit, not a rule-strength limit.
 *   2. `leak-scan-tree` + `leak-scan-src` TOGETHER (this repo's actual
 *      current `just check` coverage): re-measured at 3 of 5 caught —
 *      `dfdb8cd`, `e5903ed` (`leak-scan-tree`, private-personal-name /
 *      unreviewed-mailbox / unreviewed-outbound-host on the removed lines)
 *      plus `c6da604` (`leak-scan-src`, unreviewed-mailbox — closed by this
 *      fix round; a #205 R1-era measurement without `leak-scan-src` reported
 *      this one missed because no gate scanned `src/**` at all yet). Still
 *      MISSED: `46b16fe` (a plain first+last personal name with no embedded
 *      initial — `private-personal-name`'s shape cannot see it regardless of
 *      scan root) and `900f778` (prose referencing a private precedent by
 *      description, not by a name/mailbox/archive-URL shape — no rule in
 *      this set targets that class). Both are disclosed, open limits, not
 *      silently papered over — see `just leak-scan-src`'s header for the
 *      first, and the porting PR's limits section for both.
 *
 * DELIBERATELY NOT SCANNED IN FULL: most of `src/**` application code and its
 * test fixtures. Test files in this repo routinely carry synthetic hostile-
 * shaped input on purpose — fake secrets, fake private IPs, adversarial name
 * shapes — to exercise the app's OWN privacy/security logic. Running this
 * gate's FULL rule set over that surface produces ~70 findings, nearly all
 * fixture noise (measured on the porting PR). `just leak-scan-src` (below)
 * runs a NARROW, high-value-density subset of the same rules over `src/**`
 * instead of the full set — see that recipe for the rationale and the
 * measured cost.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { LEAK_RULES, REPO_ROOT, SKIP_EXTENSIONS, TEXT_EXTENSIONS, scanText } from './lib/leak-scan.mjs';

/** Tracked paths this gate is scoped to. Everything else (notably most of
 * src/**, see just leak-scan-src) is out of scope by design — see the header
 * comment above. */
const SCAN_ROOTS = [
	'docs',
	'static',
	'README.md',
	'AGENTS.md',
	'CLAUDE.md',
	'NOTICE',
	'LICENSE',
	'LICENSE-content',
	'CHANGELOG.md',
	'SECURITY.md',
	'RELEASING.md',
];

/** This scanner's own rules file legitimately contains rule-pattern source
 * text that would otherwise look like the very things it detects; nothing
 * under scripts/ is in SCAN_ROOTS anyway, but keep the guard explicit in case
 * SCAN_ROOTS ever widens. */
const SELF_EXCLUDE = /^scripts\/lib\/leak-scan-rules\.json$/u;

// Bare loopback (127.0.0.0/8) is excluded from the TREE surface only — see
// private-loopback-address's own description in leak-scan-rules.json for why
// it is a separate rule from the rest of private-network-address: this
// repo's own docs/preview-tailnet.md cites 127.0.0.1 repeatedly to document a
// loopback-only-binding SAFETY property, never an infra endpoint. Every other
// rule, including kubeconfig-fragment and cache-or-executor-endpoint, now
// runs on BOTH surfaces with NO exclusion: both were tightened from a
// bare-keyword match to a value-shaped one specifically so a governance
// document can discuss the CONCEPT ("this repo holds zero kubeconfig
// material") without tripping a rule meant to catch the actual FRAGMENT
// ("client-certificate-data: <base64...>"). An earlier revision of this file
// excluded all three rules blanket-wide across every file in SCAN_ROOTS; an
// adversarial review (porting PR, finding B5) measured that the compensating-
// control claim for that exclusion was false for docs/** specifically (which
// never reaches build/, so leak-scan-build could not backstop it) and planted
// 10 of 12 synthetic leak shapes that passed every gate in `just check` as a
// result. Tightening the rules removed the need for the exclusion instead of
// papering over the gap.
const TREE_EXCLUDE_RULE_IDS = ['private-loopback-address'];

function fail(message) {
	console.error(`leak-scan-tree: ${message}`);
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

// FAIL CLOSED on PARTIAL surface loss, not just total loss — a #127-family
// lesson found by adversarial review (finding B4): `git ls-files -- <roots>`
// with no per-root accounting silently drops a root that stops matching
// (e.g. `git mv docs documentation`), reporting a smaller GREEN instead of a
// RED. Assert every configured root still resolves to at least one tracked
// path, naming any that do not, before scanning anything.
const rootHits = new Map(SCAN_ROOTS.map((root) => [root, 0]));
for (const relative of tracked) {
	for (const root of SCAN_ROOTS) {
		if (relative === root || relative.startsWith(`${root}/`)) {
			rootHits.set(root, rootHits.get(root) + 1);
		}
	}
}
const emptyRoots = SCAN_ROOTS.filter((root) => rootHits.get(root) === 0);
if (emptyRoots.length > 0) {
	fail(
		`${emptyRoots.length} configured SCAN_ROOTS entr(y/ies) matched ZERO tracked paths — ` +
			`this looks like a surface that moved or was deleted, not a clean tree: ${emptyRoots.join(', ')}\n` +
			`Update SCAN_ROOTS in scripts/check-tracked-tree.mjs to the new location, or confirm the removal ` +
			`is intentional and delete the stale entry deliberately.`,
	);
}

const unclassified = [];
const files = [];
for (const relative of tracked.sort()) {
	if (SELF_EXCLUDE.test(relative)) continue;
	const absolute = path.join(REPO_ROOT, relative);
	// git ls-files can list a path that no longer exists on disk mid-rebase;
	// treat that as fail-closed rather than a silent skip or an uncaught
	// stack trace with the wrong exit code (this script's own contract is
	// "1 = findings, 2 = structural failure" — a CI wrapper that trusts that
	// contract must not see a structural failure reported as exit 1).
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
		`${unclassified.length} tracked file(s) under SCAN_ROOTS have an extension this scanner has no ` +
			`verdict for, so the scan cannot claim the tree is clean:\n` +
			unclassified.map((file) => `  ${file}`).join('\n') +
			`\nAdd each extension to TEXT_EXTENSIONS or SKIP_EXTENSIONS in scripts/lib/leak-scan.mjs, then re-run.`,
	);
}

// FAIL CLOSED on a totally empty scan too — see the partial-loss guard above;
// same infra PR #127 lesson, the other half of it.
if (files.length === 0) {
	fail(
		`zero scannable files found under ${SCAN_ROOTS.join(', ')} — that is not a clean tree, it is an ` +
			`empty walk. Refusing to report a pass.`,
	);
}

const deniedLiterals = (process.env.GFTB_LEAK_SCAN_DENY ?? '')
	.split(',')
	.map((literal) => literal.trim())
	.filter(Boolean);

let findings;
try {
	findings = files.flatMap((relative) =>
		scanText(relative, readFileSync(path.join(REPO_ROOT, relative), 'utf8'), {
			deniedLiterals,
			excludeRuleIds: TREE_EXCLUDE_RULE_IDS,
		}),
	);
} catch (error) {
	fail(`scan failed structurally rather than producing a verdict: ${error.message}`);
}

if (findings.length > 0) {
	for (const finding of findings) {
		console.error(`${finding.file}:${finding.line}: [${finding.ruleId}] ${finding.description} — ${finding.excerpt}`);
	}
	console.error(`leak-scan-tree: ${findings.length} finding(s) in ${files.length} tracked file(s)`);
	process.exit(1);
}

const denyNote =
	deniedLiterals.length > 0
		? `${deniedLiterals.length} operator-supplied literal(s)`
		: 'no operator-supplied literals (set GFTB_LEAK_SCAN_DENY to add real private names)';
console.log(
	`leak-scan-tree: clean across ${files.length} tracked file(s) under ${SCAN_ROOTS.join(', ')} using ` +
		`${LEAK_RULES.length} rules, host and mailbox allowlists, and ${denyNote}`,
);
