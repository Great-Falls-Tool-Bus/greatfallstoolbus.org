// `just tools-validate` — compile every .svx in src/content/tools/** with
// mdsvex (the same preprocessor the site build uses) and validate its
// frontmatter against the shared schema in src/lib/data/tool-schema.ts.
// Fails loudly on: missing/invalid required fields, unknown status or cell,
// non-https docUrl, docUrl without docLabel, duplicate slugs, or duplicate
// `order` values within a cell. Run via `pnpm exec tsx` (Justfile idiom).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { compile } from 'mdsvex';
import { Either, Schema } from 'effect';
import { ToolFrontmatter } from '../src/lib/data/tool-schema.ts';

const CONTENT_ROOT = fileURLToPath(new URL('../src/content/tools', import.meta.url));
const decode = Schema.decodeUnknownEither(ToolFrontmatter);

async function* walk(dir: string): AsyncGenerator<string> {
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
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
const byCellOrder = new Map<string, string>();

for await (const file of walk(CONTENT_ROOT)) {
	checked++;
	const source = await fs.readFile(file, 'utf8');
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
	const tool = result.right;

	const slug = path.basename(file, '.svx');
	const priorSlug = bySlug.get(slug);
	if (priorSlug) {
		fail(file, `duplicate slug '${slug}' (also ${path.relative(process.cwd(), priorSlug)})`);
		continue;
	}
	bySlug.set(slug, file);

	const orderKey = `${tool.cell}#${tool.order}`;
	const priorOrder = byCellOrder.get(orderKey);
	if (priorOrder) {
		fail(
			file,
			`duplicate order ${tool.order} in cell '${tool.cell}' (also ${path.relative(process.cwd(), priorOrder)})`,
		);
		continue;
	}
	byCellOrder.set(orderKey, file);

	console.log(`OK   ${path.relative(process.cwd(), file)} -> ${tool.name} [${tool.status}]`);
}

if (checked === 0) {
	console.error(`FAIL no .svx files found under ${CONTENT_ROOT}`);
	failures++;
}

console.log(failures ? `\n${failures} failure(s) across ${checked} file(s).` : `\nAll ${checked} tool file(s) valid.`);
process.exit(failures ? 1 : 0);
