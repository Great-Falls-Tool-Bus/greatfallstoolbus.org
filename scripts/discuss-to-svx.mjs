// `just discuss-to-svx -- --input <file.json>` (or
// `pnpm exec tsx scripts/discuss-to-svx.mjs --input <file.json>`) — the Lane
// B mechanism: converts ONE already-redacted HyperKitty message export into
// a `published: false` svx draft under src/content/discuss-drafts/, staged
// for an operator to post to discuss@latoolb.us by hand and reconcile
// afterwards. See docs/runbooks/discuss-to-svx-pipeline.md for the full
// pipeline (including the on-cluster HyperKitty read path this script does
// NOT itself perform).
//
// THIS SCRIPT NEVER SENDS MAIL. It has no network access and no mail
// transport dependency of any kind; it reads one local JSON file and writes
// one local .svx file. Posting to discuss@ is always a human, manual,
// operator action through their own mail client.
//
// This script does not redact anything either — redaction is an editorial
// decision a human makes before content ever reaches this script (see the
// operator's redaction-proposal packets). This script's job is narrower:
// gate the already-redacted text one more time in code, then stage it.
//
// INPUT CONTRACT — one JSON file:
//   {
//     "slug":            "2026-08-06-drafts-for-filings"   // lowercase kebab-case; becomes the filename
//     "subject":         "Reposting from the keyholders archive: ..."
//     "sourceList":      "keyholders@latoolb.us"            // must be exactly this
//     "sourceMessageId": "HK id 24"                          // opaque id, never a sender address
//     "sourceDate":      "2026-08-06T04:22:00Z"              // ISO-8601, UTC
//     "body":            "full markdown body, redactions already applied"
//   }
// `body` may instead be `"bodyFile": "./relative-sibling.txt"` — a path
// relative to the input JSON — when it is easier to hand-author or diff the
// message body as its own plain-text file than as a JSON-escaped string.
//
// GATES (fail closed — any violation exits non-zero and writes nothing):
//   - required fields present and well-shaped
//   - naming-consent (src/lib/naming-consent.ts, salted-hash gate — see
//     docs/runbooks/discuss-to-svx-pipeline.md for the design): checked on
//     EVERY free-text field that can reach output in any form, including
//     `slug` (becomes the filename, never appears in the file's own text)
//     and `sourceMessageId` (reaches frontmatter + the provenance comment),
//     not just subject/body
//   - no bare email address or NANP-shaped phone number in subject, body,
//     or sourceMessageId (the two list addresses, which are not personal,
//     are the only allowed address exceptions)
//   - the assembled frontmatter validates against DiscussDraftFrontmatter
//     (src/lib/data/discuss-draft-schema.ts)
// Refuses to overwrite an existing draft unless --force is passed.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Either, Schema } from 'effect';
import {
	assertNamingConsent,
	assertNoBareEmailAddress,
	assertNoBarePhoneNumber,
	NamingConsentError,
} from '../src/lib/naming-consent.ts';
import { DiscussDraftFrontmatter, SOURCE_LIST, TARGET_LIST } from '../src/lib/data/discuss-draft-schema.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT_DIR = path.join(ROOT, 'src', 'content', 'discuss-drafts');
export const PENDING_COMMENT =
	'<!-- pending discuss@ posting by operator; svx to be reconciled to the posted archive URL -->';

export function parseArgs(argv) {
	const args = { force: false, preparedAt: new Date().toISOString() };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--input') args.input = argv[++i];
		else if (a === '--out-dir') args.outDir = argv[++i];
		else if (a === '--force') args.force = true;
		else if (a === '--prepared-at') args.preparedAt = argv[++i];
		else throw new Error(`unknown argument: ${a}`);
	}
	if (!args.input) throw new Error('--input <file.json> is required');
	return args;
}

function yamlString(value) {
	return `'${String(value).replace(/'/g, "''")}'`;
}

export function frontmatterBlock(fm) {
	const lines = [
		`subject: ${yamlString(fm.subject)}`,
		`sourceList: ${yamlString(fm.sourceList)}`,
		`sourceMessageId: ${yamlString(fm.sourceMessageId)}`,
		`sourceDate: ${yamlString(fm.sourceDate)}`,
		`targetList: ${yamlString(fm.targetList)}`,
		`published: ${fm.published}`,
		`preparedAt: ${yamlString(fm.preparedAt)}`,
	];
	return `---\n${lines.join('\n')}\n---\n`;
}

/** Pure assembly step (no I/O) — kept separate so it can be exercised directly. */
export function buildDraft(raw, preparedAt) {
	for (const key of ['slug', 'subject', 'sourceList', 'sourceMessageId', 'sourceDate', 'body']) {
		if (typeof raw[key] !== 'string' || raw[key].trim() === '') {
			throw new Error(`input is missing required string field "${key}"`);
		}
	}
	if (raw.sourceList !== SOURCE_LIST) {
		throw new Error(`input sourceList must be "${SOURCE_LIST}", got "${raw.sourceList}"`);
	}
	if (!/^[a-z0-9-]+$/.test(raw.slug)) {
		throw new Error(`slug "${raw.slug}" must be lowercase kebab-case`);
	}

	// Naming-consent + address gates run on every free-text field that
	// reaches output in ANY form — including `slug` (becomes the filename,
	// never appears in the file's own text, so a filename-only violation
	// would otherwise be invisible to a raw-text scan) and
	// `sourceMessageId` (reaches frontmatter + the provenance comment). The
	// two list literals themselves are fixed, schema-enforced constants,
	// not personal data, so they are not scanned.
	assertNamingConsent(raw.slug, 'input slug');
	assertNamingConsent(raw.subject, 'input subject');
	assertNamingConsent(raw.sourceMessageId, 'input sourceMessageId');
	assertNamingConsent(raw.body, 'input body');
	assertNoBareEmailAddress(raw.subject, [SOURCE_LIST, TARGET_LIST], 'input subject');
	assertNoBareEmailAddress(raw.sourceMessageId, [SOURCE_LIST, TARGET_LIST], 'input sourceMessageId');
	assertNoBareEmailAddress(raw.body, [SOURCE_LIST, TARGET_LIST], 'input body');
	assertNoBarePhoneNumber(raw.subject, 'input subject');
	assertNoBarePhoneNumber(raw.sourceMessageId, 'input sourceMessageId');
	assertNoBarePhoneNumber(raw.body, 'input body');

	// NOTE: frontmatter deliberately carries no redactionsApplied /
	// consentVerified flag. A prior version hardcoded both to `true`
	// unconditionally, regardless of what the input actually contained — an
	// unconditional true verifies nothing and reads as a machine-checked
	// guarantee it isn't. This function's real, mechanical guarantee is
	// narrower: the naming-consent hash gate and the bare-email/bare-phone
	// checks above ran and passed (they throw otherwise, so control never
	// reaches this line if they didn't) — it is NOT a guarantee that the
	// body is fully redacted. Editorial redaction happens entirely upstream,
	// by a human, before content ever reaches this script (see the header
	// comment above and docs/runbooks/discuss-to-svx-pipeline.md step 2);
	// verification of that step is manual, operator review before flipping
	// `published: true`, not a frontmatter field this script can honestly
	// assert.
	const frontmatter = {
		subject: raw.subject,
		sourceList: raw.sourceList,
		sourceMessageId: raw.sourceMessageId,
		sourceDate: raw.sourceDate,
		targetList: TARGET_LIST,
		published: false,
		preparedAt,
	};
	const decoded = Schema.decodeUnknownEither(DiscussDraftFrontmatter)(frontmatter);
	if (Either.isLeft(decoded)) {
		throw new Error(`generated frontmatter failed schema validation: ${String(decoded.left)}`);
	}

	const provenanceLine = `<!-- provenance: ${frontmatter.sourceList} archive, ${frontmatter.sourceMessageId} (private list; no email addresses recorded) -->`;
	const content = `${frontmatterBlock(frontmatter)}\n${provenanceLine}\n${PENDING_COMMENT}\n\n${raw.body.trimEnd()}\n`;
	return { slug: raw.slug, frontmatter, content };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const raw = JSON.parse(await fs.readFile(args.input, 'utf8'));

	// A "bodyFile" (path relative to the input JSON) is accepted as an
	// alternative to an inline "body" string — real exports are plain-text
	// message bodies and are far less error-prone to hand-author or diff as a
	// sibling .txt file than as one long JSON-escaped string.
	if (raw.body === undefined && typeof raw.bodyFile === 'string') {
		const bodyPath = path.resolve(path.dirname(path.resolve(args.input)), raw.bodyFile);
		raw.body = await fs.readFile(bodyPath, 'utf8');
	}

	let draft;
	try {
		draft = buildDraft(raw, args.preparedAt);
	} catch (error) {
		if (error instanceof NamingConsentError) throw new Error(`${args.input}: ${error.message}`);
		throw error;
	}

	const outDir = args.outDir ? path.resolve(args.outDir) : DEFAULT_OUT_DIR;
	await fs.mkdir(outDir, { recursive: true });
	const outFile = path.join(outDir, `${draft.slug}.svx`);

	const exists = await fs
		.access(outFile)
		.then(() => true)
		.catch(() => false);
	if (exists && !args.force) {
		throw new Error(`refusing to overwrite existing draft ${outFile} (pass --force)`);
	}

	await fs.writeFile(outFile, draft.content, 'utf8');
	console.log(`wrote ${path.relative(ROOT, outFile)}`);
}

// Only run as a CLI when invoked directly (not when imported by a test/generator).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('discuss-to-svx.mjs')) {
	main().catch((error) => {
		console.error(`discuss-to-svx: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
