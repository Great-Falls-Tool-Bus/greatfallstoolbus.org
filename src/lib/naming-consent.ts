// Naming-consent enforcement shared by the discuss@ draft-staging pipeline
// (scripts/discuss-to-svx.mjs, scripts/validate-discuss-drafts.mts) and any
// future public-log surface that stages operator-authored prose sourced from
// a private list.
//
// REBUILD NOTICE (see docs/runbooks/discuss-to-svx-pipeline.md, "Naming-
// consent gate design", for the full incident writeup): an earlier version
// of this module enforced consent with a literal denylist — the protected
// names appeared, in plaintext, inside this file, its test file, and
// .gitleaks.toml rule descriptions, all tracked in this PUBLIC repo. That
// is itself a disclosure and was blocked before merge.
//
// v2 fix round (review on PR #190): the first hash-gate design used
// per-token SALTED SHA-256 with the salt committed next to the digest. Salt
// defeats precomputed rainbow tables, not guessing — both protected tokens
// were recovered in single-digit milliseconds from a stock OS wordlist, with
// zero prior knowledge. That is a RECOVERY oracle, not a confirmation
// oracle, and it was permanent the moment it was pushed. This version
// replaces salted SHA-256 with KEYED HMAC-SHA256: the committed file holds
// HMAC outputs only, and is cryptographically inert without the key, which
// never enters any git tree (~/.gftb/naming-consent.key, generated locally,
// mode 0600). No per-token length is committed either — the scanner sweeps
// a fixed window range instead, so the file no longer even reveals the
// shape of the protected-token set.
//
// THE CORE RULE THIS REBUILD FOLLOWS, unchanged from v1:
//   No protected string, initial-mapping, association, or roster fact may
//   appear in ANY tracked file — ever. Enforcement must work without
//   containing what it protects.
//
// This module never sees, and never needs to see, the plaintext of a
// protected token. It only ever HMACs candidate substrings drawn from the
// text it is checking and compares digests.
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class NamingConsentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NamingConsentError';
	}
}

// A small, explicit set of lowercase Latin-lookalike characters from other
// scripts, applied AFTER lowercasing (so only lowercase source glyphs need
// entries). This is NOT a full UTS #39 confusable-skeleton implementation —
// it is the cheap subset that closes the homoglyph forms actually tested
// against this gate (Cyrillic а/о/е for Latin a/o/e) plus the handful of
// other Cyrillic and Greek lowercase letters with the same near-identical
// glyph in common UI fonts. Residual risk for other scripts/rarer
// confusables is real and documented in the runbook, not silently claimed
// away.
const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
	// Cyrillic -> Latin
	а: 'a',
	е: 'e',
	о: 'o',
	р: 'p',
	с: 'c',
	х: 'x',
	у: 'y',
	і: 'i',
	ј: 'j',
	ѕ: 's',
	к: 'k',
	м: 'm',
	// Greek -> Latin
	ο: 'o',
	ρ: 'p',
});

function foldConfusables(text: string): string {
	let out = '';
	for (const ch of text) out += CONFUSABLES[ch] ?? ch;
	return out;
}

/**
 * Normalize text into a single lowercase, separator-free, accent-free,
 * confusable-folded stream of letters and digits:
 *
 *   1. NFKC  — fold compatibility / fullwidth forms.
 *   2. NFD   — decompose accented letters into base letter + combining mark.
 *   3. strip \p{M} — drop the combining marks, leaving the bare base letter.
 *      Diacritics are not only an evasion vector: a legitimately-accented
 *      spelling, or an autocorrected one, would otherwise silently miss the
 *      gate too. Both sides (generation and matching) go through this same
 *      function, so the committed hash list and a runtime candidate always
 *      normalize the same way.
 *   4. lowercase.
 *   5. fold a small set of Cyrillic/Greek homoglyphs to their Latin
 *      lookalike (see CONFUSABLES above — deliberately narrow, documented
 *      residual in the runbook).
 *   6. strip everything that is not a Unicode letter or digit.
 *
 * Stripping (not collapsing-to-space) every separator in the last step is
 * deliberate: it is what lets a hashed n-gram scan see through a name split
 * across a mail line-wrap ("Wal-\nter" / "Wal\nter") or hidden in a slug or
 * filename ("ask-<token>-about-key") — all collapse to the same stream a
 * deliberate no-separators evasion attempt would produce. It also means
 * matching is substring-based, not word-boundary-based: a protected token
 * flags even inside a longer word. That's intentional — over-flagging (a
 * false positive a human has to clear) is the safe failure mode for a gate
 * that must fail closed; under-flagging is the actual harm this rebuild
 * exists to prevent. (Below a length floor this over-flags so badly it stops
 * being usable at all — see MIN_TOKEN_LENGTH and the runbook.)
 */
export function normalizeForConsent(text: string): string {
	const folded = text.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
	return foldConfusables(folded).replace(/[^\p{L}\p{N}]+/gu, '');
}

const GFTB_DIR = path.join(os.homedir(), '.gftb');
export const KEY_FILE = path.join(GFTB_DIR, 'naming-consent.key');
export const PLAIN_FILE = path.join(GFTB_DIR, 'naming-consent.plain');
export const HASHES_FILE = fileURLToPath(new URL('./naming-consent.hashes.json', import.meta.url));

// The committed hash list no longer carries a per-token length (a v1
// finding: it leaked the shape of the protected-token set for negligible
// benefit). Instead the scanner sweeps every window length in this fixed
// range at every stream position. The floor is not arbitrary: measured
// against the 384 files tracked in this repo, a 1-character enrolled token
// flags 375 of them and a 3-character token flags 50 — structurally
// unusable. A 4-character token flags 1. See "Naming-consent gate design"
// in the runbook for the full table and the editorial-review routing this
// implies for bare initials.
export const MIN_TOKEN_LENGTH = 4;
export const MAX_TOKEN_LENGTH = 16;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX_KEY = /^[0-9a-f]{64}$/i;

/**
 * Reads the local, never-committed HMAC key. Returns `undefined` if it does
 * not exist in this environment (expected in CI — see
 * isIdentityGateAvailable and the runbook's CI-scope note) rather than
 * throwing, so callers can choose to skip loudly instead of crashing.
 */
export function loadKey(): Buffer | undefined {
	if (!existsSync(KEY_FILE)) return undefined;
	const raw = readFileSync(KEY_FILE, 'utf8').trim();
	if (!HEX_KEY.test(raw)) {
		throw new Error(
			`${KEY_FILE} does not contain a well-formed 32-byte hex key. Regenerate via \`just naming-consent-hashes\`.`,
		);
	}
	return Buffer.from(raw, 'hex');
}

/** True if this environment can run the identity gate at all (has the key). */
export function isIdentityGateAvailable(): boolean {
	return existsSync(KEY_FILE);
}

function hmacHex(key: Buffer, candidate: string): string {
	return createHmac('sha256', key).update(candidate, 'utf8').digest('hex');
}

/**
 * Pure helper shared by the generator and the drift-check script: given
 * already-normalized, deduplicated tokens and the key, produce the
 * committed-file shape — a sorted array of hex HMAC digests. Sorted +
 * deduplicated so regeneration is byte-for-byte deterministic given the
 * same (plaintext, key) pair — this determinism is what makes the drift
 * gate constructible at all (the prior salted-SHA-256 design re-salted on
 * every run and could never produce a stable diff).
 */
export function buildHashList(normalizedTokens: readonly string[], key: Buffer): string[] {
	const digests = new Set(normalizedTokens.filter((t) => t.length > 0).map((t) => hmacHex(key, t)));
	return [...digests].sort();
}

/**
 * Loads and strictly validates the committed hash list. FAILS CLOSED: a
 * missing file, invalid JSON, an empty array, or any entry that isn't a
 * 64-hex-char digest is a hard error, not a silent empty set. A prior
 * version returned `[]` on garbage input, which made
 * `containsProtectedIdentity` silently pass everything while `just check`
 * stayed green — precisely the failure mode a fail-closed gate must not
 * have.
 *
 * EXPORTED (v2 round 3 fix): this needs no key at all — it's a pure
 * shape-check of the committed artifact. `validate-discuss-drafts.mts` and
 * `verify-naming-consent-hashes.mjs` both call it UNCONDITIONALLY now, even
 * when the identity gate itself can't run (key absent), so an emptied or
 * malformed list can never pass green in CI just because CI also lacks the
 * key. Before this fix that state was invisible: the key-absent code paths
 * never touched this loader at all.
 */
export function loadCommittedHashes(): Set<string> {
	let raw: string;
	try {
		raw = readFileSync(HASHES_FILE, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
			throw new Error(
				`${HASHES_FILE} is missing. Run \`just naming-consent-hashes\` (requires the ` +
					'operator-local ~/.gftb/naming-consent.plain) before staging any discuss-drafts content.',
			);
		}
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(
			`${HASHES_FILE} is not valid JSON — it may be corrupt or a bad merge. Regenerate with ` +
				'`just naming-consent-hashes` and verify with `just naming-consent-hashes-verify`.',
		);
	}
	return validateHashList(parsed, HASHES_FILE);
}

/**
 * Pure validation, factored out of loadCommittedHashes so it's unit-testable
 * without touching the filesystem or the real committed list: rejects
 * anything that isn't a non-empty array of well-formed 64-hex-char digests.
 * FAILS CLOSED — this is the fix for a v1 finding: `loadHashEntries()`
 * previously asserted nothing about the parsed array, so a truncated file, a
 * bad merge, or a stray `[]` silently disabled the identity gate while
 * `containsProtectedIdentity(text, [])` returned `false` for everything and
 * `just check` stayed green. `source` is just a label for the error message.
 */
export function validateHashList(parsed: unknown, source = 'the committed hash list'): Set<string> {
	if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((h) => typeof h === 'string' && HEX64.test(h))) {
		throw new Error(
			`${source} is empty or malformed (expected a non-empty JSON array of 64-char hex HMAC ` +
				'digests). An empty/corrupt list would otherwise silently disable the identity gate — this is ' +
				'a hard error on purpose. Regenerate with `just naming-consent-hashes`.',
		);
	}
	return new Set(parsed as string[]);
}

interface IdentityCheckContext {
	key?: Buffer;
	hashes?: Set<string>;
}

/**
 * True if `text` contains, anywhere as a contiguous substring after
 * normalization, any token from the committed protected-token hash list —
 * swept over every window length in [MIN_TOKEN_LENGTH, MAX_TOKEN_LENGTH],
 * since the committed file no longer states per-token length. Never reveals
 * which token, or any characters of it — only whether a match occurred.
 *
 * `key`/`hashes` are injectable for tests, so the real committed key and
 * hash list are never a dependency of test behavior. Outside tests this
 * throws if the local key is unavailable — callers that can legitimately
 * run without it (e.g. `just check` in CI) must check
 * `isIdentityGateAvailable()` themselves first and skip calling this rather
 * than let it throw.
 */
export function containsProtectedIdentity(text: string, ctx: IdentityCheckContext = {}): boolean {
	const key = ctx.key ?? loadKey();
	if (!key) {
		throw new Error(
			`${KEY_FILE} is not present — the naming-consent identity gate cannot run without it. This ` +
				'is expected in CI; see "Naming-consent gate design" in docs/runbooks/discuss-to-svx-pipeline.md.',
		);
	}
	const hashes = ctx.hashes ?? loadCommittedHashes();
	const stream = normalizeForConsent(text);
	for (let i = 0; i < stream.length; i++) {
		const maxLen = Math.min(MAX_TOKEN_LENGTH, stream.length - i);
		for (let len = MIN_TOKEN_LENGTH; len <= maxLen; len++) {
			if (hashes.has(hmacHex(key, stream.slice(i, i + len)))) return true;
		}
	}
	return false;
}

/**
 * Throws NamingConsentError if `text` contains any protected identity
 * token (HMAC match). `context` is a human-readable label (e.g. a field or
 * file path) prefixed onto the error so a CI failure points at the
 * offending source — the error message never echoes the matched text.
 */
export function assertNamingConsent(text: string, context = 'text', ctx: IdentityCheckContext = {}): void {
	if (containsProtectedIdentity(text, ctx)) {
		throw new NamingConsentError(
			`${context}: contains a protected identity token (naming-consent HMAC match). ` +
				'This field must not name, or otherwise identify, a private individual. See ' +
				'docs/runbooks/discuss-to-svx-pipeline.md for the consent-gate design.',
		);
	}
}

const RAW_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Local-part-preserving mask so a failure message never re-leaks the address it names. */
function maskAddress(address: string): string {
	const [local, domain] = address.split('@');
	const maskedLocal = local.length <= 1 ? '•' : `${local[0]}${'•'.repeat(Math.min(local.length - 1, 6))}`;
	return `${maskedLocal}@${domain}`;
}

/**
 * Throws NamingConsentError if `text` contains any bare, address-shaped
 * substring (`local@domain.tld`) that is not in `allow` (case-insensitive
 * exact match — meant for the two list addresses themselves, which are
 * public/private LIST identifiers, not a person's contact address). Every
 * other address — including the operator's own — is a leak in staged public
 * copy and fails closed.
 */
export function assertNoBareEmailAddress(text: string, allow: readonly string[] = [], context = 'text'): void {
	const allowLower = new Set(allow.map((a) => a.toLowerCase()));
	for (const match of text.match(RAW_ADDRESS) ?? []) {
		if (allowLower.has(match.toLowerCase())) continue;
		throw new NamingConsentError(
			`${context}: an email address is present (${maskAddress(match)}). Remove it before staging.`,
		);
	}
}

// NANP-shaped phone number: optional +1, optional parens/separators around a
// 3-3-4 digit grouping. Deliberately format-based (not identity-based) — no
// person's actual number is encoded here, this just catches the SHAPE.
const PHONE_SHAPE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

/** Masks all but the area code so a failure message never re-leaks the number it names. */
function maskPhone(match: string): string {
	const digits = match.replace(/\D/g, '');
	const area = digits.slice(-10, -7) || '•••';
	return `${area}-•••-••••`;
}

/**
 * Throws NamingConsentError if `text` contains a bare NANP-shaped phone
 * number. Purely format-based (no phone number is hard-coded anywhere in
 * this repo to match against) — a generic class gitleaks can also carry
 * independently, unlike identity matching.
 */
export function assertNoBarePhoneNumber(text: string, context = 'text'): void {
	const match = text.match(PHONE_SHAPE);
	if (match && match.length > 0) {
		throw new NamingConsentError(
			`${context}: a phone number is present (${maskPhone(match[0])}). Remove it before staging.`,
		);
	}
}
