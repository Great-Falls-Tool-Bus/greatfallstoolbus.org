// `just naming-consent-hashes-verify` — the drift gate.
//
// Recomputes the committed hash list from ~/.gftb/naming-consent.plain +
// ~/.gftb/naming-consent.key and diffs it against the COMMITTED
// src/lib/naming-consent.hashes.json. If they differ, the operator edited
// the plaintext file (or the key) and forgot to regenerate + commit — a
// real gap this closes for the first time: nothing previously detected
// that the plaintext file had gained a token the committed list didn't
// know about.
//
// This is only possible because HMAC generation is deterministic (see
// scripts/generate-naming-consent-hashes.mjs's header) — the prior
// salted-SHA-256 design re-salted on every run, so no stable diff could
// ever exist.
//
// EDIT-2 (v2 round 3 fix): the committed file's SHAPE is checked
// unconditionally, before anything else, via naming-consent.ts's
// loadCommittedHashes() — that check needs no key at all, so there is no
// excuse for skipping it. Before this fix, an emptied/malformed/non-JSON
// committed file was invisible whenever operator files were absent: this
// script's old early-exit skipped straight past ever reading it.
//
// The DRIFT comparison itself (does the shape-valid committed file match
// what the plaintext+key currently produce) still SKIPS LOUDLY (prints a
// warning, exits 0) when either operator-local file is absent — that part
// really can't run without them, and that's the expected, permanent state
// in CI. Wired into `just check` anyway: it fails closed where it CAN run
// (locally, catching real drift or a corrupt commit) and is an inert
// no-op — past the mandatory shape-check — everywhere else.
import { promises as fs } from 'node:fs';
import process from 'node:process';
import {
	buildHashList,
	KEY_FILE,
	loadCommittedHashes,
	MIN_TOKEN_LENGTH,
	normalizeForConsent,
	PLAIN_FILE,
} from '../src/lib/naming-consent.ts';

async function readIfExists(file) {
	try {
		return await fs.readFile(file, 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		throw error;
	}
}

async function main() {
	// Mandatory, key-independent shape-check FIRST (EDIT-2). Throws with a
	// clear message on a missing/non-JSON/empty/malformed committed file.
	let committedHashes;
	try {
		committedHashes = loadCommittedHashes();
	} catch (error) {
		console.error(`naming-consent-hashes-verify: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}

	const [plainRaw, keyRaw] = await Promise.all([readIfExists(PLAIN_FILE), readIfExists(KEY_FILE)]);

	if (plainRaw === undefined || keyRaw === undefined) {
		console.log(
			'naming-consent-hashes-verify: shape-check passed. Drift check SKIPPED — operator-local ' +
				'file(s) not present in this environment (expected in CI; this is not a failure). The ' +
				'identity gate itself is similarly unavailable here — see "Naming-consent gate design" ' +
				'in docs/runbooks/discuss-to-svx-pipeline.md.',
		);
		process.exit(0);
	}

	const keyHex = keyRaw.trim();
	if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
		console.error(`${KEY_FILE} does not contain a well-formed 32-byte hex key.`);
		process.exit(1);
	}
	const key = Buffer.from(keyHex, 'hex');

	const normalized = plainRaw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'))
		.map((line) => normalizeForConsent(line));
	const usable = normalized.filter((t) => t.length >= MIN_TOKEN_LENGTH);
	const expected = buildHashList(usable, key);

	const expectedSet = new Set(expected);
	const missing = expected.filter((h) => !committedHashes.has(h)).length;
	const extra = [...committedHashes].filter((h) => !expectedSet.has(h)).length;

	if (missing === 0 && extra === 0 && expectedSet.size === committedHashes.size) {
		console.log(
			`naming-consent-hashes-verify: OK — committed hash list matches ~/.gftb/naming-consent.plain (${expected.length} token(s)).`,
		);
		process.exit(0);
	}

	console.error(
		'naming-consent-hashes-verify: DRIFT DETECTED — the committed src/lib/naming-consent.hashes.json ' +
			'does not match what ~/.gftb/naming-consent.plain (with the current key) produces.\n' +
			`  expected ${expectedSet.size} digest(s), committed file has ${committedHashes.size}; ` +
			`${missing} digest(s) present in the plaintext but not committed, ${extra} committed digest(s) ` +
			'no longer produced by the plaintext.\n' +
			'Run `just naming-consent-hashes` and commit the update.',
	);
	process.exit(1);
}

main().catch((error) => {
	console.error(`naming-consent-hashes-verify: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
