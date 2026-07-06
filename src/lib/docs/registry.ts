// Curated registry for the on-site operator-docs surface (/docs).
//
// SSOT: the doc bodies are the REAL files under `docs/**`, imported as raw
// strings and rendered by $lib/docs/markdown.ts. There is no second copy of any
// doc, so the live page can never drift from the tracked file. This module only
// adds presentation metadata (human title, one-line summary, group, order) and a
// stable URL slug per doc.
//
// PUBLIC-REPO-SAFE curation: this list is deliberately a SUBSET. It surfaces the
// operator-facing runbooks, deploy/launch readiness, and CI/development
// contracts. It intentionally omits the `docs/decisions/**` ADRs: they are the
// internal decision archive, and `0008-oncluster-production-hosting.md` embeds
// on-prem node private IPs (192.168.x) that must not be republished on a public
// site. Every doc listed here was scanned clean of private endpoints.
import sourceMap from '$lib/generated/source-map.json';

// Raw markdown for exactly the surfaced docs. Single-file glob patterns keep the
// bundle to only these files (no adjacent docs are pulled in).
const rawModules = {
	...import.meta.glob('/docs/runbooks/*.md', { query: '?raw', import: 'default', eager: true }),
	...import.meta.glob('/docs/deploy/*.md', { query: '?raw', import: 'default', eager: true }),
	...import.meta.glob('/docs/launch/*.md', { query: '?raw', import: 'default', eager: true }),
	...import.meta.glob('/docs/CI-SCHEMA.md', { query: '?raw', import: 'default', eager: true }),
	...import.meta.glob('/docs/DEVELOPMENT.md', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

export interface OperatorDoc {
	/** URL slug under /docs. */
	slug: string;
	/** Repo-relative source path, e.g. `docs/runbooks/dns-apply.md`. */
	path: string;
	title: string;
	summary: string;
	group: string;
	order: number;
	/** Raw markdown source (SSOT: the tracked file). */
	raw: string;
}

interface RegistryEntry {
	file: string;
	slug: string;
	title: string;
	summary: string;
	group: string;
	order: number;
}

/** Group headings in display order. */
export const DOC_GROUPS = ['Runbooks', 'Deploy and launch', 'Contracts and development'] as const;

const ENTRIES: RegistryEntry[] = [
	{
		file: '/docs/runbooks/dns-mail-checklist.md',
		slug: 'dns-mail-checklist',
		title: 'DNS and mail cutover checklist',
		summary:
			'The manual, operator-verified checklist for the latoolb.us name-server, MX, SPF, DKIM, and DMARC cutover, with a verification command after every step.',
		group: 'Runbooks',
		order: 1,
	},
	{
		file: '/docs/runbooks/dns-apply.md',
		slug: 'dns-apply',
		title: 'DNS apply (pointer)',
		summary:
			'Where the DNS apply steps actually live: the org edge overlay, never this repo. Nothing here applies DNS.',
		group: 'Runbooks',
		order: 2,
	},
	{
		file: '/docs/runbooks/cf-pages-rollback.md',
		slug: 'cf-pages-rollback',
		title: 'Cloudflare Pages rollback',
		summary: 'How to roll the live site back to a previous Cloudflare Pages deployment.',
		group: 'Runbooks',
		order: 3,
	},
	{
		file: '/docs/deploy/cloudflare-pages.md',
		slug: 'cloudflare-pages',
		title: 'Cloudflare Pages deploy',
		summary: 'The opt-in workflow that builds the static site and deploys it to Cloudflare Pages.',
		group: 'Deploy and launch',
		order: 1,
	},
	{
		file: '/docs/deploy/oncluster-container-readiness.md',
		slug: 'oncluster-container-readiness',
		title: 'On-cluster container readiness',
		summary:
			'The accepted on-cluster serving target (ADR 0008): the same source served in-cluster as an adapter-node server. Image build is active; the production cutover is operator-gated and not yet done, so Cloudflare Pages is still the live host.',
		group: 'Deploy and launch',
		order: 2,
	},
	{
		file: '/docs/CI-SCHEMA.md',
		slug: 'ci-schema',
		title: 'CI and lane contract',
		summary: 'The normative CI, lane, and dispatch wire-format contract every spoke site ships.',
		group: 'Contracts and development',
		order: 1,
	},
	{
		file: '/docs/DEVELOPMENT.md',
		slug: 'development',
		title: 'Development',
		summary: 'How to build, test, and deploy the site through the just recipes inside the Nix devshell.',
		group: 'Contracts and development',
		order: 2,
	},
];

export const operatorDocs: OperatorDoc[] = ENTRIES.map((entry) => {
	const raw = rawModules[entry.file];
	if (raw === undefined) {
		throw new Error(`operator-docs registry: no raw source globbed for ${entry.file}`);
	}
	return {
		slug: entry.slug,
		path: entry.file.replace(/^\//, ''),
		title: entry.title,
		summary: entry.summary,
		group: entry.group,
		order: entry.order,
		raw,
	};
});

const bySlug = new Map(operatorDocs.map((doc) => [doc.slug, doc]));

export function getDoc(slug: string): OperatorDoc | undefined {
	return bySlug.get(slug);
}

export function docSlugs(): string[] {
	return operatorDocs.map((doc) => doc.slug);
}

/** Docs grouped in DOC_GROUPS order, each group's docs sorted by `order`. */
export function docsByGroup(): Array<{ heading: string; docs: OperatorDoc[] }> {
	return DOC_GROUPS.map((heading) => ({
		heading,
		docs: operatorDocs.filter((doc) => doc.group === heading).sort((a, b) => a.order - b.order),
	}));
}

function normalizeJoin(dirSegments: string[], relative: string): string {
	const segments = relative.startsWith('/') ? [] : [...dirSegments];
	for (const part of relative.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') segments.pop();
		else segments.push(part);
	}
	return segments.join('/');
}

/**
 * Build a link resolver for one doc: turns its relative markdown links into
 * canonical GitHub blob URLs (anchors and absolute URLs are handled upstream in
 * markdown.ts and never reach here). Repo URL and branch come from the generated
 * source map, so no org/repo string is hardcoded.
 */
export function makeLinkResolver(docPath: string): (href: string) => string {
	const repoUrl = sourceMap.repoUrl;
	const branch = sourceMap.branch;
	const dirSegments = docPath.split('/').slice(0, -1);
	return (href: string) => {
		const hashIndex = href.indexOf('#');
		const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
		const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
		const resolved = normalizeJoin(dirSegments, pathPart);
		return `${repoUrl}/blob/${branch}/${resolved}${hash}`;
	};
}
