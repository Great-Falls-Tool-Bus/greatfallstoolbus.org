// `just discuss-reconcile -- --slug <slug> --archive-url <url>` — the
// reconciliation half of the keyholders@ -> discuss@ repost pipeline
// (docs/runbooks/discuss-to-svx-pipeline.md step 7). After the OPERATOR has
// manually sent a staged draft's body to discuss@latoolb.us from their own
// mail client (step 6 — a human action, forever) and the post has landed in
// the public HyperKitty archive, this tool closes the loop on the one draft
// named by `--slug`:
//
//   1. verifies `--archive-url` is TEXTUALLY a public discuss@ thread deep
//      link — https scheme, the exact PUBLIC_THREAD_URL_PREFIX host+path from
//      the shared schema, one non-empty alphanumeric thread id, no query,
//      fragment, port, or userinfo. This is the same anonymous-200 read-path
//      family the lifecycle spec's public-nav gate probed
//      (docs/spec/discuss-board-lifecycle-2026-09-01.md; Anubis-exempt per
//      TIN-2559). Deliberately NO live probe: CI is keyless and offline, and
//      the operator just loaded this URL in their own browser to copy it —
//      re-fetching it here would add a network dependency, not a guarantee.
//   2. flips `published: false` -> `published: true` and injects
//      `archiveUrl: '<url>'` into the frontmatter — a minimal textual edit,
//      never a YAML re-serialization, so the reconcile diff reviews as
//      exactly three hunks (flip, inject, comment removal) and hand-edited
//      drafts keep their formatting.
//   3. removes the generator's pending-notice HTML comment (imported from
//      scripts/discuss-to-svx.mjs, never re-declared).
//   4. re-runs the draft validation IN-PROCESS on the new text before
//      anything touches disk: naming-consent identity gate (key REQUIRED —
//      see below), bare-email/bare-phone gates, filename gate, mdsvex
//      compile, and a DiscussDraftFrontmatter decode (which enforces the
//      published/archiveUrl pairing). Any violation exits non-zero and
//      writes NOTHING.
//
// THIS SCRIPT NEVER SENDS MAIL and NEVER TOUCHES THE NETWORK. Like the
// generator, it reads one local file and writes one local file.
//
// KEY REQUIRED, like generation: reconciliation CHANGES staged content, so
// it only ever runs as a manual, keyed, local operator action. It hard-fails
// (never loud-skips) when ~/.gftb/naming-consent.key is absent — the CI-scope
// rule (src/lib/discuss-drafts-ci-scope.ts) fails closed on keyless changed
// drafts anyway, so a keyless reconcile could never land.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compile } from 'mdsvex';
import { Either, Schema } from 'effect';
import {
	DiscussDraftFrontmatter,
	PUBLIC_THREAD_URL_PREFIX,
	SOURCE_LIST,
	TARGET_LIST,
} from '../src/lib/data/discuss-draft-schema.ts';
import {
	assertNamingConsent,
	assertNoBareEmailAddress,
	assertNoBarePhoneNumber,
	isIdentityGateAvailable,
	KEY_FILE,
	loadCommittedHashes,
} from '../src/lib/naming-consent.ts';
// The generator's exported pending-notice constant — imported, not
// re-declared, so the emitted comment and its removal can never drift.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain .mjs generator, deliberately not typed
import { PENDING_COMMENT } from './discuss-to-svx.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_CONTENT_DIR = path.join(ROOT, 'src', 'content', 'discuss-drafts');
const FM_OPEN = '---\n';
const FM_CLOSE = '\n---\n';
/** The comment's inner text, used for a residue check after removal. */
const PENDING_NOTICE_TEXT = (PENDING_COMMENT as string).replace(/^<!--\s*/, '').replace(/\s*-->$/, '');
const decode = Schema.decodeUnknownEither(DiscussDraftFrontmatter);

export interface ReconcileArgs {
	slug: string;
	archiveUrl: string;
	/** Test/override hook, like the generator's --out-dir. */
	contentDir?: string;
}

export function parseArgs(argv: readonly string[]): ReconcileArgs {
	let slug: string | undefined;
	let archiveUrl: string | undefined;
	let contentDir: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--slug') slug = argv[++i];
		else if (a === '--archive-url') archiveUrl = argv[++i];
		else if (a === '--content-dir') contentDir = argv[++i];
		else throw new Error(`unknown argument: ${a}`);
	}
	if (!slug) throw new Error('--slug <slug> is required');
	if (!archiveUrl) throw new Error('--archive-url <url> is required');
	if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`slug "${slug}" must be lowercase kebab-case`);
	return { slug, archiveUrl, contentDir };
}

/**
 * Textual shape check: the URL must sit in the public discuss@ thread
 * deep-link family — the anonymous-200 read path — and nothing else. Throws
 * with a reason otherwise. NO network access, by design (see file header).
 */
export function assertPublicThreadUrl(archiveUrl: string): void {
	let parsed: URL;
	try {
		parsed = new URL(archiveUrl);
	} catch {
		throw new Error(`archive URL is not a parseable absolute URL: "${archiveUrl}"`);
	}
	if (parsed.protocol !== 'https:') {
		throw new Error('archive URL must use https — the public archive is never served over anything else');
	}
	if (parsed.username || parsed.password || parsed.port) {
		throw new Error('archive URL must not carry userinfo or an explicit port');
	}
	if (parsed.search || parsed.hash) {
		throw new Error('archive URL must be a bare thread permalink — no query string or fragment');
	}
	if (!archiveUrl.startsWith(PUBLIC_THREAD_URL_PREFIX)) {
		throw new Error(
			`archive URL must be a public ${TARGET_LIST} thread deep link ` +
				`(${PUBLIC_THREAD_URL_PREFIX}<thread-id>/) — the list overview, another list, ` +
				'or any other archive page is not a reconciliation target',
		);
	}
	const rest = archiveUrl.slice(PUBLIC_THREAD_URL_PREFIX.length);
	const threadId = rest.endsWith('/') ? rest.slice(0, -1) : rest;
	if (threadId === '') {
		throw new Error('archive URL is the thread index, not one thread — append the thread id HyperKitty shows');
	}
	if (!/^[A-Za-z0-9]+$/.test(threadId)) {
		throw new Error(`archive URL thread id "${threadId}" must be a single alphanumeric path segment`);
	}
}

function yamlSingleQuoted(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Pure text transform (no I/O, no key): flip `published`, inject
 * `archiveUrl`, drop the pending-notice comment. Refuses anything that does
 * not look like an unreconciled generator-shaped draft — running it twice on
 * the same draft is an error, not a no-op.
 */
export function reconcileDraftText(source: string, archiveUrl: string): string {
	assertPublicThreadUrl(archiveUrl);

	if (!source.startsWith(FM_OPEN)) throw new Error('draft does not begin with a frontmatter block');
	const fmEnd = source.indexOf(FM_CLOSE, FM_OPEN.length);
	if (fmEnd === -1) throw new Error('draft frontmatter block is unterminated');
	const fmLines = source.slice(FM_OPEN.length, fmEnd).split('\n');
	const body = source.slice(fmEnd + FM_CLOSE.length);

	if (fmLines.some((line) => line.startsWith('archiveUrl:'))) {
		throw new Error('draft already carries an archiveUrl — it appears to be reconciled already');
	}
	if (fmLines.includes('published: true')) {
		throw new Error('draft is already published: true — nothing to reconcile');
	}
	const publishedIdx = fmLines.indexOf('published: false');
	if (publishedIdx === -1) {
		throw new Error('draft has no `published: false` frontmatter line — not a generator-shaped draft');
	}
	if (!body.includes(PENDING_COMMENT)) {
		throw new Error('draft is missing the pending-notice comment — it does not look like a pending draft');
	}

	fmLines[publishedIdx] = 'published: true';
	fmLines.push(`archiveUrl: ${yamlSingleQuoted(archiveUrl)}`);

	const newBody = body
		.split('\n')
		.filter((line) => line.trim() !== PENDING_COMMENT)
		.join('\n');
	if (newBody.includes(PENDING_NOTICE_TEXT)) {
		throw new Error(
			'the pending-notice text survives outside the notice comment itself — refusing to reconcile a ' +
				'draft that quotes it',
		);
	}

	return `${FM_OPEN}${fmLines.join('\n')}${FM_CLOSE}${newBody}`;
}

/**
 * The full reconcile action: read, transform, re-validate in-process, write.
 * Fail closed — any violation throws before the file is touched. Returns the
 * repo-relative path it rewrote.
 */
export async function reconcileDraft(args: ReconcileArgs): Promise<string> {
	if (!isIdentityGateAvailable()) {
		throw new Error(
			`${KEY_FILE} is not present — reconciliation changes staged content, so it only runs on a ` +
				'keyed operator machine (same rule as `just discuss-to-svx`; see the runbook\'s "CI scope" section).',
		);
	}
	// Unconditional shape-check of the committed hash list, mirroring
	// scripts/validate-discuss-drafts.mts.
	loadCommittedHashes();

	const contentDir = args.contentDir ? path.resolve(args.contentDir) : DEFAULT_CONTENT_DIR;
	const file = path.join(contentDir, `${args.slug}.svx`);
	const rel = path.relative(ROOT, file);
	let source: string;
	try {
		source = await fs.readFile(file, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
			throw new Error(`no staged draft at ${rel} — check the slug against src/content/discuss-drafts/`);
		}
		throw error;
	}

	const next = reconcileDraftText(source, args.archiveUrl);

	// In-process re-run of the validator's per-file gates against the NEW
	// text, before anything touches disk.
	assertNamingConsent(next, rel);
	assertNamingConsent(args.slug, `${rel} (filename)`);
	assertNoBareEmailAddress(next, [SOURCE_LIST, TARGET_LIST], rel);
	assertNoBarePhoneNumber(next, rel);

	let fm: unknown;
	try {
		const compiled = await compile(next, { extensions: ['.svx'] });
		fm = compiled?.data?.fm;
	} catch (error) {
		throw new Error(`reconciled draft failed to compile under mdsvex: ${String(error)}`);
	}
	const result = decode(fm);
	if (Either.isLeft(result)) {
		throw new Error(`reconciled frontmatter failed schema validation: ${String(result.left)}`);
	}
	if (result.right.published !== true || result.right.archiveUrl !== args.archiveUrl) {
		throw new Error('reconciled frontmatter did not round-trip published/archiveUrl — refusing to write');
	}

	await fs.writeFile(file, next, 'utf8');
	return rel;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const rel = await reconcileDraft(args);
	console.log(`reconciled ${rel} -> ${args.archiveUrl}`);
	console.log(
		'review the diff, then commit from this keyed machine — keyless CI fails closed on changed drafts ' +
			'(docs/runbooks/discuss-to-svx-pipeline.md, "CI scope").',
	);
}

// Only run as a CLI when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith('discuss-reconcile.mts')) {
	main().catch((error) => {
		console.error(`discuss-reconcile: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
