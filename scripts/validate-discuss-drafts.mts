// `just discuss-drafts-validate` — compile every .svx in
// src/content/discuss-drafts/** with mdsvex and validate its frontmatter
// against DiscussDraftFrontmatter, then independently re-run the
// naming-consent and no-bare-email-address gates against the RAW file text
// (frontmatter and body both). This is deliberately redundant with the gates
// scripts/discuss-to-svx.mjs already runs at generation time: this file
// exists so a hand-edited draft (or a draft authored by a different tool
// entirely) still fails `just check`, not just gitleaks.
//
// Also asserts every `published: false` draft still carries the
// pending-notice HTML comment, matching scripts/discuss-to-svx.mjs's output
// shape — a draft silently missing that comment would read as staged content
// rather than a pending-operator-action placeholder.
//
// It is NOT a failure for this directory to be empty or absent: unlike
// src/content/tools/**, drafts are expected to drain to zero over time as the
// operator posts and reconciles them.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compile } from 'mdsvex';
import { Either, Schema } from 'effect';
import { DiscussDraftFrontmatter, SOURCE_LIST, TARGET_LIST } from '../src/lib/data/discuss-draft-schema.ts';
import { assertNamingConsent, assertNoBareEmailAddress, NamingConsentError } from '../src/lib/naming-consent.ts';

const CONTENT_ROOT = fileURLToPath(new URL('../src/content/discuss-drafts', import.meta.url));
const PENDING_COMMENT = 'pending discuss@ posting by operator; svx to be reconciled to the posted archive URL';
const decode = Schema.decodeUnknownEither(DiscussDraftFrontmatter);

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

	try {
		assertNamingConsent(source, rel);
		assertNoBareEmailAddress(source, [SOURCE_LIST, TARGET_LIST], rel);
	} catch (error) {
		fail(file, error instanceof NamingConsentError ? error.message : String(error));
		continue;
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
