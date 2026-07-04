// `just skills-build` — derive the mail lace-up agent skills from the single
// source of truth in src/lib/data/mail-clients.ts.
//
// Outputs (all committed, always derived, never hand-edited):
//   - .agents/skills/gftb-mail-laceup-<id>/SKILL.md  (Anthropic-spec frontmatter,
//     provider-neutral prose: "your agent", never Claude-specific)
//   - .claude/skills/gftb-mail-laceup-<id>            (symlink to the canonical
//     .agents copy, matching the repo's existing skill mirroring)
//   - the mail section of static/llms.txt, between the generated markers, so any
//     agent pointed at greatfallstoolbus.org/llms.txt discovers each skill.
//
// Output is deterministic. `just skills-check` runs this then
// `git diff --exit-code`, so drift fails CI. Run with `pnpm exec tsx`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIL_CLIENTS, LIST, ARCHIVE } from '../src/lib/data/mail-clients.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AGENTS_SKILLS = path.join(ROOT, '.agents', 'skills');
const CLAUDE_SKILLS = path.join(ROOT, '.claude', 'skills');
const LLMS_TXT = path.join(ROOT, 'static', 'llms.txt');
const REPO_BLOB = 'https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org/blob/main';
const PREFIX = 'gftb-mail-laceup-';
const BEGIN = '<!-- BEGIN generated: mail-laceup skills (just skills-build) -->';
const END = '<!-- END generated: mail-laceup skills -->';

const skillDir = (id) => `${PREFIX}${id}`;
const skillPath = (id) => `.agents/skills/${skillDir(id)}/SKILL.md`;
const shortDesc = (name) => `Lace up ${name} for the Great Falls Tool Bus keyholders mailing list (${LIST.post}).`;

function skillMarkdown(client) {
	const name = skillDir(client.id);
	const description = `${shortDesc(client.name)} Use when a keyholder asks their agent to subscribe to, file, and reply to the keyholders list in ${client.name}.`;
	const steps = client.agentHints.map((h, i) => `${i + 1}. ${h}`).join('\n');
	return `---
name: ${name}
description: ${description}
---

# ${client.name} mail lace-up

Point your agent at this skill to lace up ${client.name} for the Great Falls
Tool Bus keyholders list. Your agent applies the steps below to the keyholder's
own ${client.name} configuration. No credentials live in this file; the
keyholder authorizes each change.

Platforms: ${client.platforms}

## Subscribe

${client.subscribe}

## File list mail

${client.filing}

## Reply to the list

${client.replyToList}

## Mailbox (optional)

${client.mailbox}

## Archive

HyperKitty web archive: ${ARCHIVE.url} (${ARCHIVE.status}).

## Agent steps

${steps}
`;
}

function llmsBlock() {
	const lines = [
		'Point any agent at these to lace up a mail client for the keyholders list',
		`(${LIST.post}). One skill per client, derived from`,
		'src/lib/data/mail-clients.ts.',
		'',
		...MAIL_CLIENTS.map((c) => `- [${skillDir(c.id)}](${REPO_BLOB}/${skillPath(c.id)}): ${shortDesc(c.name)}`),
	];
	return lines.join('\n');
}

async function pruneStale(baseDir, keep) {
	let entries;
	try {
		entries = await fs.readdir(baseDir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (e.name.startsWith(PREFIX) && !keep.has(e.name)) {
			await fs.rm(path.join(baseDir, e.name), { recursive: true, force: true });
		}
	}
}

async function writeIfChanged(file, content) {
	let prev = null;
	try {
		prev = await fs.readFile(file, 'utf8');
	} catch {
		/* new file */
	}
	if (prev !== content) {
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, content);
	}
}

async function ensureSymlink(id) {
	const linkPath = path.join(CLAUDE_SKILLS, skillDir(id));
	const target = path.join('..', '..', '.agents', 'skills', skillDir(id));
	try {
		if ((await fs.readlink(linkPath)) === target) return;
		await fs.rm(linkPath, { recursive: true, force: true });
	} catch {
		await fs.rm(linkPath, { recursive: true, force: true }).catch(() => {});
	}
	await fs.mkdir(CLAUDE_SKILLS, { recursive: true });
	await fs.symlink(target, linkPath);
}

async function main() {
	for (const client of MAIL_CLIENTS) {
		await writeIfChanged(path.join(AGENTS_SKILLS, skillDir(client.id), 'SKILL.md'), skillMarkdown(client));
		await ensureSymlink(client.id);
	}

	// Remove generated skills for clients no longer in the source of truth.
	const keep = new Set(MAIL_CLIENTS.map((c) => skillDir(c.id)));
	await pruneStale(AGENTS_SKILLS, keep);
	await pruneStale(CLAUDE_SKILLS, keep);

	// Rewrite the generated block in llms.txt between the markers.
	const raw = await fs.readFile(LLMS_TXT, 'utf8');
	const begin = raw.indexOf(BEGIN);
	const end = raw.indexOf(END);
	if (begin === -1 || end === -1 || end < begin) {
		throw new Error(`llms.txt is missing the mail-laceup markers (${BEGIN} / ${END})`);
	}
	const next = `${raw.slice(0, begin)}${BEGIN}\n${llmsBlock()}\n${END}${raw.slice(end + END.length)}`;
	await writeIfChanged(LLMS_TXT, next);

	const count = MAIL_CLIENTS.length;
	console.log(`skills-build: generated ${count} mail lace-up skill(s) and refreshed static/llms.txt`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
