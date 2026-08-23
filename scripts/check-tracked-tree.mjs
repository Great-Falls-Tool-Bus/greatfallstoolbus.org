#!/usr/bin/env node
/**
 * `just leak-scan-tree` — run the shared leak rules over this repo's
 * PUBLISHED-PROSE surface: docs/, static/ (non-binary), and the top-level
 * README/AGENTS/CLAUDE/NOTICE/LICENSE files.
 *
 * NOT a straight port: gftb-site's leak-scan only ever scans a materialized
 * build/ directory (scripts/lib/leak-scan.mjs's own header explains why —
 * that repo is pure static content, so "what gets built" and "what gets
 * published to the public GitHub repo" are close enough to the same thing).
 * This repo is different: it is an `app-stateful-spoke` (AGENTS.md), most of
 * `src/**` never reaches a client bundle or the static build output (the
 * SvelteKit `$lib/server` boundary), yet every tracked file is still visible
 * on the public GitHub repo regardless of whether it is ever built or
 * rendered — which is exactly the surface PR #193's B1 finding lived on
 * (pre-consent identity content in tracked prose, not in build output).
 *
 * DELIBERATELY NOT SCANNED: `src/**` application code and its test fixtures.
 * Test files in this repo routinely carry synthetic hostile-shaped input on
 * purpose — fake secrets, fake private IPs, adversarial name shapes — to
 * exercise the app's OWN privacy/security logic (see e.g.
 * src/lib/server/discuss-archive.test.ts on other branches). Running this
 * same blunt pattern set over that surface would either drown real findings
 * in fixture noise or demand an ever-growing per-file suppression list, which
 * is its own anti-pattern this repo's `scan-internal-endpoints.sh` already
 * had to work around with a `self_exclude` regex. Source-level secret shapes
 * are gitleaks' job (`just secrets-scan-dir`, already wired into `just
 * check`); source-level private-endpoint shapes are `scan-endpoints`'s job
 * (already wired into `just check`). This gate's added value over both is the
 * PROSE-shaped categories neither of those touches: personal names, the
 * private keyholders list archive, kubeconfig fragments, PEM/JWT/forge-token
 * shapes, and unreviewed outbound hosts/mailboxes — read scanned against
 * exactly the surface a public GitHub visitor can already read today: docs
 * and static assets, whether or not SvelteKit ever routes them.
 *
 * Same fail-closed contract as check-build-output.mjs: exit 2 on zero files
 * scanned or an unclassified extension, exit 1 on any finding.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { LEAK_RULES, REPO_ROOT, SKIP_EXTENSIONS, TEXT_EXTENSIONS, scanText } from './lib/leak-scan.mjs';

/** Tracked paths this gate is scoped to. Everything else (notably src/**) is
 * out of scope by design — see the header comment above. */
const SCAN_ROOTS = ['docs', 'static', 'README.md', 'AGENTS.md', 'CLAUDE.md', 'NOTICE', 'LICENSE', 'LICENSE-content'];

/** This scanner's own rules file legitimately contains rule-pattern source
 * text that would otherwise look like the very things it detects; nothing
 * under scripts/ is in SCAN_ROOTS anyway, but keep the guard explicit in case
 * SCAN_ROOTS ever widens. */
const SELF_EXCLUDE = /^scripts\/lib\/leak-scan-rules\.json$/u;

let tracked;
try {
	tracked = execFileSync('git', ['ls-files', '--', ...SCAN_ROOTS], { cwd: REPO_ROOT, encoding: 'utf8' })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
} catch (error) {
	console.error(`leak-scan-tree: \`git ls-files\` failed — cannot enumerate the tracked tree: ${error.message}`);
	process.exit(2);
}

const unclassified = [];
const files = [];
for (const relative of tracked.sort()) {
	if (SELF_EXCLUDE.test(relative)) continue;
	const absolute = path.join(REPO_ROOT, relative);
	// git ls-files can list a path that no longer exists on disk mid-rebase;
	// treat that as fail-closed rather than a silent skip.
	statSync(absolute);
	const extension = path.extname(relative).toLowerCase();
	if (SKIP_EXTENSIONS.has(extension)) continue;
	if (TEXT_EXTENSIONS.has(extension)) {
		files.push(relative);
		continue;
	}
	unclassified.push(relative);
}

if (unclassified.length > 0) {
	console.error(
		`leak-scan-tree: ${unclassified.length} tracked file(s) under SCAN_ROOTS have an extension this ` +
			`scanner has no verdict for, so the scan cannot claim the tree is clean:\n` +
			unclassified.map((file) => `  ${file}`).join('\n') +
			`\nAdd each extension to TEXT_EXTENSIONS or SKIP_EXTENSIONS in scripts/lib/leak-scan.mjs, then re-run.`,
	);
	process.exit(2);
}

// FAIL CLOSED on an empty scan — see check-build-output.mjs's own comment;
// same infra PR #127 lesson.
if (files.length === 0) {
	console.error(
		`leak-scan-tree: zero scannable files found under ${SCAN_ROOTS.join(', ')} — that is not a clean ` +
			`tree, it is an empty walk. Refusing to report a pass.`,
	);
	process.exit(2);
}

const deniedLiterals = (process.env.GFTB_LEAK_SCAN_DENY ?? '')
	.split(',')
	.map((literal) => literal.trim())
	.filter(Boolean);

// Bare-keyword infra rules a governance/decision document legitimately
// discusses in the abstract while asserting the ABSENCE of the thing (e.g.
// "this repo never holds kubeconfig material") — a real leak of any of these
// is a VALUE (an actual endpoint, an actual credential blob), and that class
// is still caught in full by the build-output scan (leak-scan-build applies
// every rule with no exclusions) plus this repo's own scan-endpoints gate,
// already wired into `just check` for tracked source.
const TREE_EXCLUDE_RULE_IDS = ['kubeconfig-fragment', 'cache-or-executor-endpoint', 'internal-hostname'];

// Files whose entire purpose is to name real third-party/historical people as
// a licensing-required public attribution credit (a CC/public-domain photo or
// text source citation) — the opposite of a private-name leak. Excluded from
// private-personal-name only; every other rule (including secrets/endpoints)
// still applies to these files.
const ATTRIBUTION_FILES = new Set(['docs/attribution.md', 'NOTICE', 'LICENSE-content']);

const findings = files.flatMap((relative) => {
	const excludeRuleIds = ATTRIBUTION_FILES.has(relative)
		? [...TREE_EXCLUDE_RULE_IDS, 'private-personal-name']
		: TREE_EXCLUDE_RULE_IDS;
	return scanText(relative, readFileSync(path.join(REPO_ROOT, relative), 'utf8'), {
		deniedLiterals,
		excludeRuleIds,
	});
});

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
