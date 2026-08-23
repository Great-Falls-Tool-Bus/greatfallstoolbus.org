/**
 * Leak scanner for anything this repository publishes — the ONE implementation.
 *
 * PORTED from gftb-site's scripts/lib/leak-scan.mjs (see the PR that introduced
 * this file for the citation trail: the durable fix named by PR #193's R2
 * delta-verify, after PR #190/#187 established the design constraints below).
 * The acceptance row is the same one gftb-site wrote it against: "no private
 * endpoints, secrets, internal hostnames, kubeconfig fragments, or private
 * personal names appear in what this repository publishes."
 *
 * DESIGN CONSTRAINT (PR #187 lesson, preserved exactly from the source repo):
 * this module never matches on a literal protected string baked into the
 * repository. Every rule in leak-scan-rules.json matches a SHAPE (a PEM
 * header, a cloud key prefix, a kubeconfig field name, an RFC1918 CIDR block,
 * an "Initial. Surname" name shape) — never a specific real name, hostname, or
 * address. The two positive allowlists (ALLOWED_HOSTS, ALLOWED_MAILBOXES) name
 * things that are SUPPOSED to be public, which is the opposite of a denylist
 * of protected identifiers. The one mechanism that accepts a literal string at
 * all (`deniedLiterals`) is supplied at run time from an environment variable
 * (GFTB_LEAK_SCAN_DENY, see scripts/check-build-output.mjs /
 * scripts/check-tracked-tree.mjs) and is never committed to this repository —
 * so there is nothing here for a PR #187-style crack attempt to recover.
 *
 * This module is plain ESM on purpose, imported directly by its two thin
 * runners (scripts/check-build-output.mjs, scripts/check-tracked-tree.mjs) and
 * by src/lib/leak-scan.test.ts under vitest. There is no second copy of the
 * scanning logic to drift from.
 *
 * It deliberately lives outside `src/lib`: leak-scan-rules.json carries
 * credential-detection regexes that must never be reachable from the
 * SvelteKit library root and therefore never reachable from a client bundle.
 *
 * Two positive checks complement the pattern rules, because a denylist alone
 * cannot prove absence: every outbound host and every mailbox in the scanned
 * text must appear on a reviewed allowlist (or be an RFC 2606 reserved
 * documentation/test domain — example.com/.org/.net, .invalid, .test — which
 * this repo's own test suite uses constantly and which can never name a real
 * private endpoint by construction).
 *
 * PORTING NOTE: two rules present in the source repo were deliberately NOT
 * ported — see the header comment in leak-scan-rules.json for why
 * ('internal-tracker-reference' and the llms.txt/agent-map.md sub-pattern of
 * 'source-map-or-dev-artifact' both encode gftb-site-specific policy that
 * conflicts with this repo's own sanctioned public agent surfaces).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {object} LeakRule
 * @property {string} id
 * @property {string} description
 * @property {string} pattern
 * @property {string} flags
 *
 * @typedef {object} LeakFinding
 * @property {string} file
 * @property {string} ruleId
 * @property {string} description
 * @property {number} line
 * @property {string} excerpt
 *
 * @typedef {object} ScanFile
 * @property {string} path
 * @property {string} text
 *
 * @typedef {object} ScanOptions
 * @property {string[]} [deniedLiterals] Extra literal strings that must never
 *   appear — real private names, private hostnames, or member identifiers an
 *   operator does not want committed to a repository intended to become
 *   public. Supplied at run time, never checked in.
 * @property {string[]} [allowedHosts]
 * @property {string[]} [allowedMailboxes]
 * @property {string[]} [excludeRuleIds] Rule ids to skip entirely for this
 *   call. Used by scripts/check-tracked-tree.mjs to exclude the bare-keyword
 *   infra rules (kubeconfig-fragment, cache-or-executor-endpoint,
 *   internal-hostname) from governance-decision PROSE, which legitimately
 *   discusses those concepts in the abstract while asserting their absence —
 *   see that script's header comment. Never used by the build-output scan,
 *   which applies every rule with no exclusions.
 */

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this module (scripts/lib/ -> repo root). */
export const REPO_ROOT = path.resolve(moduleDirectory, '../..');

export const RULES_PATH = path.join(moduleDirectory, 'leak-scan-rules.json');

const rulesDocument = JSON.parse(readFileSync(RULES_PATH, 'utf8'));

/** @type {LeakRule[]} */
export const LEAK_RULES = rulesDocument.rules;
/** @type {string[]} */
export const ALLOWED_HOSTS = rulesDocument.allowedHosts;
/** @type {string[]} */
export const ALLOWED_MAILBOXES = rulesDocument.allowedMailboxes;

/**
 * Name forms this repo's operator has separately, publicly consented to
 * publish (e.g. a single initial), PLUS narrow, reviewed sentence-punctuation
 * false positives the shape-based private-personal-name rule cannot avoid
 * (an ordinary sentence like "...under mechanism A. See the next section"
 * matches the same "Initial. Capitalized-word" shape the rule exists to
 * catch — this is an inherent, documented tradeoff of a regex-shape
 * detector applied to long-form prose rather than to gftb-site's original
 * build-output surface; see the porting PR's limits section). Each entry
 * below is the exact matched string, not a real name.
 * @type {string[]}
 */
export const PERMITTED_NAME_FORMS = [
	'A. See', // AGENTS.md: "...under mechanism A. See the \"Per-PR..." — sentence punctuation, not a name.
];

/**
 * Extensions whose bytes are scanned as UTF-8 text. `''` covers extensionless
 * published files such as `_redirects`, `LICENSE`, `NOTICE`.
 */
export const TEXT_EXTENSIONS = new Set([
	'.html',
	'.js',
	'.mjs',
	'.css',
	'.json',
	'.svg',
	'.txt',
	'.xml',
	'.md',
	'.map',
	'',
]);

/** Extensions that are knowingly opaque to a text scanner. */
export const SKIP_EXTENSIONS = new Set([
	'.br',
	'.gz',
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.webp',
	'.avif',
	'.ico',
	'.pdf',
]);

const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+)/giu;
const MAILBOX_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu;

/** RFC 2606 reserved documentation/testing domains, plus the IPv4 loopback
 * range. Never a real endpoint by construction, so always safe to allow
 * regardless of the reviewed allowlist — this repo's own test suite uses
 * these constantly, and a build-output or tracked-source scan must not have
 * to enumerate every test fixture host. */
const RESERVED_DOC_HOST_RE = /(^|\.)(example\.(com|org|net)|example|invalid|test|localhost)$|^127(\.\d{1,3}){3}$/u;

/** This repo's own public domains. Any subdomain of either is this site's
 * own DNS namespace — publishing it is not a disclosure, it is the site
 * being reachable — so it is safe to allow generically rather than
 * enumerating every subdomain (lists./forms./www./mta-sts.…) individually. */
const SELF_DOMAIN_RE = /(^|\.)(greatfallstoolbus\.org|latoolb\.us)$/u;

/**
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function lineOf(text, index) {
	let line = 1;
	for (let cursor = 0; cursor < index; cursor += 1) {
		if (text.charCodeAt(cursor) === 10) line += 1;
	}
	return line;
}

/**
 * Redacted, bounded context so a finding is actionable without echoing a secret.
 *
 * @param {string} text
 * @param {number} index
 * @param {number} length
 * @returns {string}
 */
function excerptAt(text, index, length) {
	const start = Math.max(0, index - 24);
	const end = Math.min(text.length, index + length + 24);
	return text
		.slice(start, end)
		.replace(text.slice(index, index + length), '<<redacted>>')
		.replace(/\s+/gu, ' ')
		.trim();
}

/**
 * @param {LeakRule} rule
 * @returns {RegExp}
 */
function compile(rule) {
	const flags = rule.flags.includes('g') ? rule.flags : `${rule.flags}g`;
	return new RegExp(rule.pattern, flags);
}

/**
 * @param {string} file
 * @param {string} text
 * @param {ScanOptions} [options]
 * @returns {LeakFinding[]}
 */
export function scanText(file, text, options = {}) {
	/** @type {LeakFinding[]} */
	const findings = [];
	const excludeRuleIds = new Set(options.excludeRuleIds ?? []);

	for (const rule of LEAK_RULES) {
		if (excludeRuleIds.has(rule.id)) continue;
		const pattern = compile(rule);
		for (const match of text.matchAll(pattern)) {
			if (match.index === undefined) continue;
			if (rule.id === 'private-personal-name' && PERMITTED_NAME_FORMS.includes(match[0].trim())) continue;
			findings.push({
				file,
				ruleId: rule.id,
				description: rule.description,
				line: lineOf(text, match.index),
				excerpt: excerptAt(text, match.index, match[0].length),
			});
		}
	}

	for (const literal of options.deniedLiterals ?? []) {
		const needle = literal.trim();
		if (!needle) continue;
		const haystack = text.toLowerCase();
		let index = haystack.indexOf(needle.toLowerCase());
		while (index !== -1) {
			findings.push({
				file,
				ruleId: 'operator-denied-literal',
				description: 'operator-supplied literal that must not be published',
				line: lineOf(text, index),
				excerpt: excerptAt(text, index, needle.length),
			});
			index = haystack.indexOf(needle.toLowerCase(), index + needle.length);
		}
	}

	const allowedHosts = new Set(options.allowedHosts ?? ALLOWED_HOSTS);
	URL_RE.lastIndex = 0;
	for (const match of text.matchAll(URL_RE)) {
		const host = match[1].toLowerCase().replace(/\.$/u, '');
		if (allowedHosts.has(host) || RESERVED_DOC_HOST_RE.test(host) || SELF_DOMAIN_RE.test(host)) continue;
		findings.push({
			file,
			ruleId: 'unreviewed-outbound-host',
			description: `outbound host ${host} is not on the reviewed public allowlist`,
			line: lineOf(text, match.index ?? 0),
			excerpt: excerptAt(text, match.index ?? 0, match[0].length),
		});
	}

	const allowedMailboxes = new Set((options.allowedMailboxes ?? ALLOWED_MAILBOXES).map((box) => box.toLowerCase()));
	for (const match of text.matchAll(MAILBOX_RE)) {
		const mailbox = match[0].toLowerCase();
		// Deliberately NOT extended with SELF_DOMAIN_RE the way the host check
		// above is: a mailbox on our own domain is not automatically public the
		// way a subdomain being reachable is — an individual operator/keyholder
		// address on latoolb.us/greatfallstoolbus.org is exactly the class of
		// thing this check exists to catch. Only RESERVED_DOC_HOST_RE (test
		// fixtures) gets a pass here.
		const mailboxHost = mailbox.split('@')[1] ?? '';
		if (allowedMailboxes.has(mailbox) || RESERVED_DOC_HOST_RE.test(mailboxHost)) continue;
		findings.push({
			file,
			ruleId: 'unreviewed-mailbox',
			description: `mailbox ${mailbox} is not one of the reviewed public list addresses`,
			line: lineOf(text, match.index ?? 0),
			excerpt: excerptAt(text, match.index ?? 0, match[0].length),
		});
	}

	return findings.sort((left, right) => left.line - right.line || left.ruleId.localeCompare(right.ruleId));
}

/**
 * @param {ScanFile[]} files
 * @param {ScanOptions} [options]
 * @returns {LeakFinding[]}
 */
export function scanFiles(files, options = {}) {
	return files.flatMap((file) => scanText(file.path, file.text, options));
}

/**
 * @param {LeakFinding[]} findings
 * @returns {string}
 */
export function formatFindings(findings) {
	if (findings.length === 0) return 'leak-scan: no findings';
	return findings
		.map(
			(finding) => `${finding.file}:${finding.line}: [${finding.ruleId}] ${finding.description} — ${finding.excerpt}`,
		)
		.join('\n');
}

/** Raised by {@link collectFiles} when the scanned tree contains a file type the scanner has no verdict for. */
export class UnclassifiedOutputError extends Error {
	/** @param {string[]} files */
	constructor(files) {
		super(
			`leak-scan: ${files.length} scanned file(s) have an extension that is in neither ` +
				`TEXT_EXTENSIONS nor SKIP_EXTENSIONS, so the scan cannot claim the tree is clean:\n` +
				files.map((file) => `  ${file}`).join('\n') +
				`\nAdd each extension to TEXT_EXTENSIONS (it is UTF-8 and must be scanned) or to ` +
				`SKIP_EXTENSIONS (it is opaque binary) in scripts/lib/leak-scan.mjs, then re-run.`,
		);
		this.name = 'UnclassifiedOutputError';
		/** @type {string[]} */
		this.files = files;
	}
}

/**
 * Walks a directory and returns the absolute paths of the files to scan.
 *
 * FAILS CLOSED: a file whose extension is in neither {@link TEXT_EXTENSIONS}
 * nor {@link SKIP_EXTENSIONS} throws {@link UnclassifiedOutputError} rather
 * than being silently dropped. A scanner whose whole purpose is proving the
 * absence of secrets must not report "clean" over content it never opened.
 *
 * @param {string} root
 * @param {(absolutePath: string) => boolean} [prune] return true to skip a
 *   directory (and everything under it) entirely, e.g. node_modules.
 * @returns {string[]}
 */
export function collectFiles(root, prune = () => false) {
	/** @type {string[]} */
	const found = [];
	/** @type {string[]} */
	const unclassified = [];
	/** @param {string} directory */
	const walk = (directory) => {
		for (const entry of readdirSync(directory).sort()) {
			const absolute = path.join(directory, entry);
			if (prune(absolute)) continue;
			if (statSync(absolute).isDirectory()) {
				walk(absolute);
				continue;
			}
			const extension = path.extname(absolute).toLowerCase();
			if (SKIP_EXTENSIONS.has(extension)) continue;
			if (TEXT_EXTENSIONS.has(extension)) {
				found.push(absolute);
				continue;
			}
			unclassified.push(path.relative(root, absolute));
		}
	};
	walk(root);
	if (unclassified.length > 0) throw new UnclassifiedOutputError(unclassified.sort());
	return found.sort();
}

/**
 * Scans a built directory. Returns the report the CLI prints; throws
 * {@link UnclassifiedOutputError} on an unknown file type.
 *
 * @param {string} buildDirectory absolute path to the published tree
 * @param {ScanOptions} [options]
 * @returns {{ files: string[]; findings: LeakFinding[] }}
 */
export function scanBuildDirectory(buildDirectory, options = {}) {
	const files = collectFiles(buildDirectory);
	const findings = files.flatMap((absolute) =>
		scanText(path.relative(REPO_ROOT, absolute), readFileSync(absolute, 'utf8'), options),
	);
	return { files, findings };
}
