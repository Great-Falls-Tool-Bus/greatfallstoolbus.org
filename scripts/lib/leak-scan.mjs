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
 *   call. Used by scripts/check-tracked-tree.mjs to exclude
 *   private-loopback-address from governance-decision PROSE that documents a
 *   loopback-only-binding safety property — see that script's header
 *   comment. Never used by the build-output scan, which applies every rule
 *   with no exclusions.
 * @property {boolean} [checkHosts] Default true. Set false to skip the
 *   unreviewed-outbound-host check — used by scripts/leak-scan-src.mjs, see
 *   its header for why.
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
 * @typedef {object} PermittedName
 * @property {string} file The exact `file` argument scanText was called with
 *   (a repo-relative path) — the exception applies ONLY there, not globally.
 *   A global allowlist would permit e.g. "A. See" (added for one AGENTS.md
 *   sentence) inside build/index.html or any other file that happens to
 *   contain the same shape, and "See" is a real surname.
 * @property {string} text The exact matched string.
 * @property {string} reason Why this exact match, in this exact file, is not
 *   a private-name leak — either a reviewed sentence-punctuation artefact of
 *   the shape-based regex, or a licensing-required public-domain/third-party
 *   attribution credit (the file's own purpose is to publish it).
 */

/**
 * Name forms permitted ONLY in the named file — never a blanket allowlist.
 * Two categories, both narrow and reviewed:
 *   1. Sentence-punctuation false positives the shape-based
 *      private-personal-name rule cannot avoid (an ordinary sentence like
 *      "...under mechanism A. See the next section" matches the same
 *      "Initial. Capitalized-word" shape the rule exists to catch — an
 *      inherent, documented tradeoff of a regex-shape detector applied to
 *      long-form prose; see the porting PR's limits section).
 *   2. Licensing-required public-domain/third-party attribution credits — the
 *      opposite of a private-name leak: CC/public-domain terms require
 *      naming the historical author/photographer, and the name is already
 *      public (published decades ago, cited by exactly this repo's own
 *      attribution doc). Scoping this per-file, per-string (rather than
 *      exempting docs/attribution.md's private-personal-name rule entirely,
 *      as an earlier revision of this file did) means a DIFFERENT, non-
 *      attribution name accidentally added to the same file still fires.
 * @type {PermittedName[]}
 */
export const PERMITTED_NAME_FORMS = [
	{
		file: 'AGENTS.md',
		text: 'A. See',
		reason: 'sentence punctuation: "...under mechanism A. See the \\"Per-PR..." — not a name.',
	},
	{
		file: 'docs/attribution.md',
		text: 'Louis M. Roehl',
		reason: '1922 public-domain author credit, licensing-required by the attribution doc itself.',
	},
	{
		file: 'CHANGELOG.md',
		text: 'Louis M. Roehl',
		reason: 'same public-domain author credit as docs/attribution.md, cited in the changelog entry that added it.',
	},
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
	// .ts and .svelte never appear in build/ (compiled away) or under
	// docs/static (prose/binary only) — added for scripts/leak-scan-src.mjs,
	// the only runner that walks src/**.
	'.ts',
	'.svelte',
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
 * Redacted, bounded context so a finding is actionable without echoing a
 * secret. This is a public repo; this function's output reaches a public CI
 * log, so it must be structurally incapable of printing the matched needle —
 * not just at the reported occurrence, but at any OTHER occurrence the
 * excerpt window happens to catch, and not even a truncated fragment of one.
 *
 * Three failure modes were found by review, across two rounds:
 *   1. (R1/B3, closed) A single-occurrence `String.prototype.replace(string,
 *      ...)` only replaces the FIRST occurrence in the window, so a needle
 *      repeating within ~24 characters of itself printed the real value at
 *      whichever occurrence `replace` did not pick.
 *   2. (R1/B3, closed) Redacting only WITHIN the already-sliced window can
 *      still print a TRUNCATED fragment of a second occurrence that
 *      straddles the window boundary — not the full needle, but enough of it
 *      to defeat the point.
 *   3. (R2/B3-a + B3-b, closed here) The R1 fix redacted only the ONE needle
 *      belonging to the finding being built, and only in the EXACT case that
 *      one occurrence happened to match. So (a) a differently-cased repeat
 *      of the SAME needle survived — `deniedLiterals` matching is already
 *      case-insensitive (`haystack.toLowerCase().indexOf(...)`), but the R1
 *      redaction used a case-sensitive `String.split`, so match semantics
 *      and redact semantics disagreed; measured survival was 20 of 22
 *      characters of a differently-cased repeat. And (b) a second,
 *      UNRELATED protected value that merely happened to fall within the
 *      same ±24-character window — another rule's match, or another
 *      `deniedLiterals` entry — was never redacted at all, because
 *      `excerptAt` only ever knew about its own needle.
 *
 * The fix: `excerptAt` now takes the FULL set of protected values live
 * anywhere in this text (every rule match plus every deniedLiterals
 * occurrence, collected by scanText's first pass below), expands the window
 * to swallow any occurrence — of ANY of them, case-insensitively — that
 * merely overlaps it, then redacts every one of them within the window,
 * longest value first (so a short protected value that is a substring of a
 * longer one, e.g. an initial embedded in a full name, cannot fragment an
 * already-placed `<<redacted>>` token). No single-needle, single-case blind
 * spot remains.
 *
 * @param {string} text
 * @param {number} index
 * @param {number} length
 * @param {string[]} [protectedValues] Every value elsewhere in this same
 *   text that must not survive in ANY excerpt, not just this finding's own
 *   match. This call's own needle is always included automatically; the
 *   caller does not need to add it.
 * @returns {string}
 */
function excerptAt(text, index, length, protectedValues = []) {
	const needle = text.slice(index, index + length);
	// Case-insensitive de-dup (keep one representative spelling per distinct
	// value) so the same value seen in two different cases does not run two
	// redundant redaction passes over the window.
	const byLowerCase = new Map();
	for (const value of [needle, ...protectedValues]) {
		if (!value) continue;
		const key = value.toLowerCase();
		if (!byLowerCase.has(key)) byLowerCase.set(key, value);
	}
	const values = [...byLowerCase.values()];

	// 1. Naive window, same as before.
	let start = Math.max(0, index - 24);
	let end = Math.min(text.length, index + length + 24);

	// 2. Find every occurrence of every protected value in the WHOLE text,
	// case-insensitively, and expand the window to fully swallow any
	// occurrence it merely overlaps — a window that stops in the MIDDLE of an
	// occurrence would leave a redactable fragment un-redacted at the
	// boundary. An occurrence far away in a large file will not overlap this
	// (locally bounded) window and so will not pull it open: this loop only
	// grows the window in response to something that already overlaps it.
	for (const value of values) {
		const pattern = new RegExp(escapeRegExp(value), 'giu');
		for (const match of text.matchAll(pattern)) {
			const occStart = match.index;
			const occEnd = occStart + match[0].length;
			if (occStart < end && occEnd > start) {
				start = Math.min(start, occStart);
				end = Math.max(end, occEnd);
			}
		}
	}

	let window = text.slice(start, end);
	// Longest value first: redacting a short protected value (e.g. an
	// initial) before a longer one that contains it as a substring could
	// chew a hole out of the longer value's own placeholder before that
	// value's own pass runs; longest-first never has that problem.
	for (const value of [...values].sort((left, right) => right.length - left.length)) {
		const pattern = new RegExp(escapeRegExp(value), 'giu');
		window = window.replace(pattern, '<<redacted>>');
	}
	return window.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
	const excludeRuleIds = new Set(options.excludeRuleIds ?? []);

	// PASS 1 (R2/B3-b fix): collect every raw match — index, length, and
	// description — from every source (rule matches, deniedLiterals, the host
	// check, the mailbox check) BEFORE building any excerpt. A finding's
	// excerpt must be able to redact every OTHER protected value that shares
	// its ±24-character window, not just its own match, and that is only
	// possible once every match in the whole text is known.
	/** @type {{ file: string, ruleId: string, description: string, index: number, length: number }[]} */
	const raw = [];

	for (const rule of LEAK_RULES) {
		if (excludeRuleIds.has(rule.id)) continue;
		const pattern = compile(rule);
		for (const match of text.matchAll(pattern)) {
			if (match.index === undefined) continue;
			if (
				rule.id === 'private-personal-name' &&
				PERMITTED_NAME_FORMS.some((permitted) => permitted.file === file && permitted.text === match[0].trim())
			)
				continue;
			raw.push({ file, ruleId: rule.id, description: rule.description, index: match.index, length: match[0].length });
		}
	}

	for (const literal of options.deniedLiterals ?? []) {
		const needle = literal.trim();
		if (!needle) continue;
		const haystack = text.toLowerCase();
		let index = haystack.indexOf(needle.toLowerCase());
		while (index !== -1) {
			raw.push({
				file,
				ruleId: 'operator-denied-literal',
				description: 'operator-supplied literal that must not be published',
				index,
				length: needle.length,
			});
			index = haystack.indexOf(needle.toLowerCase(), index + needle.length);
		}
	}

	// checkHosts defaults true. scripts/leak-scan-src.mjs turns it off: src/**
	// legitimately carries a large number of unreviewed-but-benign outbound
	// URLs (API docs, upstream references, dev tooling) that would otherwise
	// dilute this narrow gate's signal-to-noise the same way the FULL rule set
	// does over that surface (see that script's header for the measured
	// numbers) — the identity/consent classes this gate targets
	// (private-personal-name, private-list-archive, unreviewed-mailbox) do not
	// need the host check to do their job.
	if (options.checkHosts ?? true) {
		const allowedHosts = new Set(options.allowedHosts ?? ALLOWED_HOSTS);
		URL_RE.lastIndex = 0;
		for (const match of text.matchAll(URL_RE)) {
			const host = match[1].toLowerCase().replace(/\.$/u, '');
			if (allowedHosts.has(host) || RESERVED_DOC_HOST_RE.test(host) || SELF_DOMAIN_RE.test(host)) continue;
			// R2/B3-c fix: description used to interpolate the raw host
			// (`outbound host ${host} is not...`), and every runner prints
			// `finding.description` verbatim — so a "redacted" excerpt sat right
			// next to the same value in cleartext, one field over, with no
			// GFTB_LEAK_SCAN_DENY or repeat needed to trigger it. Description is
			// now rule-generic, matching how every other rule's description
			// already worked; the (now correctly redacted) excerpt is the only
			// place the match's location is shown.
			raw.push({
				file,
				ruleId: 'unreviewed-outbound-host',
				description: 'outbound host is not on the reviewed public allowlist',
				index: match.index ?? 0,
				length: match[0].length,
			});
		}
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
		// R2/B3-c fix: same as unreviewed-outbound-host above — description is
		// now rule-generic, never the raw mailbox.
		raw.push({
			file,
			ruleId: 'unreviewed-mailbox',
			description: 'mailbox is not one of the reviewed public list addresses',
			index: match.index ?? 0,
			length: match[0].length,
		});
	}

	// PASS 2: now that every match in this text is known, build the shared
	// protected-value set (every raw match's own literal text) and use it to
	// build every finding's excerpt — each excerpt redacts every protected
	// value that overlaps its window, not just its own.
	const protectedValues = raw.map((entry) => text.slice(entry.index, entry.index + entry.length));
	/** @type {LeakFinding[]} */
	const findings = raw.map((entry) => ({
		file: entry.file,
		ruleId: entry.ruleId,
		description: entry.description,
		line: lineOf(text, entry.index),
		excerpt: excerptAt(text, entry.index, entry.length, protectedValues),
	}));

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
