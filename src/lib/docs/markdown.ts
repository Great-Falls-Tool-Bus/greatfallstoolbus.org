// Dependency-free CommonMark-subset renderer for the operator-docs surface.
//
// WHY THIS EXISTS (and is NOT a new dependency):
//   The house markdown pipeline is mdsvex (.svx, see svelte.config.js plus
//   $lib/data/cells.ts). mdsvex is reused verbatim for the tool-inventory tree.
//   It is the WRONG tool for rendering the operator docs under docs/**/*.md, for
//   two hard reasons:
//     1. mdsvex compiles markdown AS a Svelte component, so every brace and every
//        <tag> in prose is interpreted as Svelte syntax. The operator docs are
//        full of angle-placeholders and brace tokens (CI-SCHEMA, apex-flip, ...).
//     2. mdsvex 0.12 ships NO GFM table support (that needs remark-gfm, a
//        forbidden new dependency per house-stack-contract.test.ts), and the
//        operator docs are heavily table-driven.
//   So we render the REAL docs/**/*.md files (SSOT, zero drift) as raw strings
//   through this tiny, self-contained renderer. It adds ZERO packages. Output is
//   plain semantic HTML dropped into the existing .prose block in src/app.css
//   (which already styles headings, lists, blockquotes, code, and TABLES with a
//   contained horizontal scroll), so it inherits the full house treatment,
//   dark/light plus print plus AA, for free.
//
// SAFETY: every text run is HTML-escaped before emission and only a fixed, known
// tag set is produced, so angle-placeholders and brace tokens render literally
// and the output is safe for {@html}. Link hrefs are scheme-checked (http/https/
// mailto/anchor/relative only) so no javascript:/data: URL can ride through.

export interface MarkdownOptions {
	/**
	 * Resolve a relative (non-http, non-anchor, non-mailto) link href, e.g. a
	 * `../decisions/0002.md` cross-reference, to an absolute URL (typically the
	 * canonical GitHub blob). Anchors, absolute URLs, and mailto are left as-is.
	 */
	resolveLink?: (href: string) => string;
}

const ESCAPE_MAP: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

function escapeHtml(input: string): string {
	return input.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

function escapeAttr(input: string): string {
	return input.replace(/[&<>"]/g, (ch) => ESCAPE_MAP[ch]);
}

/** GitHub-style heading slug: lowercase, drop punctuation, collapse spaces to dashes. */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/`/g, '')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');
}

const SAFE_SCHEME = /^(https?:|mailto:)/i;
const BLOCKED_SCHEME = /^\s*(javascript|data|vbscript):/i;

function resolveHref(raw: string, options: MarkdownOptions): string | null {
	const href = raw.trim();
	if (!href || BLOCKED_SCHEME.test(href)) return null;
	if (href.startsWith('#')) return href;
	if (SAFE_SCHEME.test(href)) return href;
	if (href.startsWith('//')) return `https:${href}`;
	// Relative or root-absolute repo link: hand to the resolver (GitHub blob).
	return options.resolveLink ? options.resolveLink(href) : href;
}

interface InlineStores {
	code: string[];
	links: string[];
}

const CODE_SENTINEL = (i: number) => ` C${i} `;
const LINK_SENTINEL = (i: number) => ` L${i} `;

// Protect-and-format one text run against a SHARED store, leaving code and link
// sentinels unresolved so a link label's own code span resolves against the same
// store at the single top-level restore (never a fresh, empty one).
function formatInto(text: string, options: MarkdownOptions, stores: InlineStores): string {
	// 1. Protect inline code first (content escaped, never re-parsed).
	let out = text.replace(/`([^`]+)`/g, (_m, code: string) => CODE_SENTINEL(stores.code.push(escapeHtml(code)) - 1));

	// 2. Protect links, building the anchor now (label recursively formatted with
	//    the SAME store so a bolded or code-span label works).
	out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, target: string) => {
		const url = resolveHref(target.trim().split(/\s+/)[0], options);
		const labelHtml = formatInto(label, options, stores);
		if (url === null) return LINK_SENTINEL(stores.links.push(labelHtml) - 1);
		const rel = /^https?:/i.test(url) ? ' rel="noopener external"' : '';
		return LINK_SENTINEL(stores.links.push(`<a href="${escapeAttr(url)}"${rel}>${labelHtml}</a>`) - 1);
	});

	// 3. Escape whatever prose is left (sentinels survive: they hold no metachars).
	out = escapeHtml(out);

	// 4. Emphasis on the escaped prose. Bold before italic.
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	out = out.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	out = out.replace(/(^|[^\w_])_([^_\n]+)_/g, '$1<em>$2</em>');
	return out;
}

// Inline pass: code spans, links, bold, italic, HTML-escaping every text run.
function renderInline(text: string, options: MarkdownOptions): string {
	const stores: InlineStores = { code: [], links: [] };
	let out = formatInto(text, options, stores);
	// Restore links (labels may still carry code sentinels) THEN code, so every
	// sentinel resolves against the one shared store.
	out = out.replace(/ L(\d+) /g, (_m, i: string) => stores.links[Number(i)]);
	out = out.replace(/ C(\d+) /g, (_m, i: string) => `<code>${stores.code[Number(i)]}</code>`);
	return out;
}

const FENCE_RE = /^(```|~~~)\s*([\w-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;

/** A table needs a header row with a pipe and a dash-separator row underneath. */
function isTableSeparator(line: string): boolean {
	return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

function splitTableRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith('|')) s = s.slice(1);
	if (s.endsWith('|')) s = s.slice(0, -1);
	// Split on unescaped pipes.
	return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

function renderTable(headerLine: string, sepLine: string, bodyLines: string[], options: MarkdownOptions): string {
	const headers = splitTableRow(headerLine);
	const aligns = splitTableRow(sepLine).map((spec) => {
		const left = spec.startsWith(':');
		const right = spec.endsWith(':');
		if (left && right) return 'center';
		if (right) return 'right';
		if (left) return 'left';
		return '';
	});
	const alignAttr = (i: number) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : '');
	const head = headers.map((h, i) => `<th${alignAttr(i)}>${renderInline(h, options)}</th>`).join('');
	const body = bodyLines
		.map((row) => {
			const cells = splitTableRow(row);
			const tds = headers.map((_h, i) => `<td${alignAttr(i)}>${renderInline(cells[i] ?? '', options)}</td>`).join('');
			return `<tr>${tds}</tr>`;
		})
		.join('');
	return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

interface ListItem {
	indent: number;
	ordered: boolean;
	content: string[];
}

function renderListItemContent(lines: string[], options: MarkdownOptions): string {
	// Task-list checkbox on the first line.
	const first = lines[0] ?? '';
	const task = first.match(/^\[([ xX])\]\s+(.*)$/);
	let checkbox = '';
	if (task) {
		const checked = task[1].toLowerCase() === 'x';
		checkbox = `<input type="checkbox" disabled${checked ? ' checked' : ''} class="doc-task"> `;
		lines = [task[2], ...lines.slice(1)];
	}
	// Render the item body as blocks (so a nested list, code block, or extra
	// paragraph works), then unwrap the common single-paragraph case so simple
	// items stay li-text instead of li-p-text.
	const inner = renderBlocks(lines, options).trim();
	const single = inner.match(/^<p>([\s\S]*?)<\/p>$/);
	const body = single && !single[1].includes('<p>') ? single[1] : inner;
	return checkbox + body;
}

/** Build a possibly-nested list from a run of list lines. */
function renderList(items: ListItem[], options: MarkdownOptions): string {
	let html = '';
	let i = 0;
	while (i < items.length) {
		const item = items[i];
		// Gather children (deeper indent) that immediately follow this item.
		let j = i + 1;
		const children: ListItem[] = [];
		while (j < items.length && items[j].indent > item.indent) {
			children.push(items[j]);
			j++;
		}
		let li = renderListItemContent(item.content, options);
		if (children.length) li += renderList(children, options);
		html += `<li>${li}</li>`;
		i = j;
	}
	const tag = items[0]?.ordered ? 'ol' : 'ul';
	return `<${tag}>${html}</${tag}>`;
}

/** Top-level block renderer. */
function renderBlocks(lines: string[], options: MarkdownOptions): string {
	const out: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Blank line.
		if (/^\s*$/.test(line)) {
			i++;
			continue;
		}

		// Fenced code block.
		const fence = line.match(FENCE_RE);
		if (fence) {
			const marker = fence[1];
			const lang = fence[2];
			const buf: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith(marker)) {
				buf.push(lines[i]);
				i++;
			}
			i++; // skip closing fence
			const cls = lang ? ` class="language-${escapeAttr(lang)}"` : '';
			out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}\n</code></pre>`);
			continue;
		}

		// Heading.
		const heading = line.match(HEADING_RE);
		if (heading) {
			const level = heading[1].length;
			const text = heading[2];
			out.push(`<h${level} id="${slugify(text)}">${renderInline(text, options)}</h${level}>`);
			i++;
			continue;
		}

		// Table (header plus separator plus rows).
		if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
			const header = line;
			const sep = lines[i + 1];
			const body: string[] = [];
			i += 2;
			while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
				body.push(lines[i]);
				i++;
			}
			out.push(renderTable(header, sep, body, options));
			continue;
		}

		// Horizontal rule.
		if (HR_RE.test(line)) {
			out.push('<hr>');
			i++;
			continue;
		}

		// Blockquote (consecutive marker lines).
		if (BLOCKQUOTE_RE.test(line)) {
			const buf: string[] = [];
			while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
				buf.push((lines[i].match(BLOCKQUOTE_RE) as RegExpMatchArray)[1]);
				i++;
			}
			out.push(`<blockquote>${renderBlocks(buf, options)}</blockquote>`);
			continue;
		}

		// List (unordered or ordered, indentation-nested).
		if (LIST_RE.test(line)) {
			const items: ListItem[] = [];
			while (i < lines.length) {
				const m = lines[i].match(LIST_RE);
				if (m) {
					const indent = m[1].replace(/\t/g, '  ').length;
					const ordered = /\d/.test(m[2]);
					items.push({ indent, ordered, content: [m[3]] });
					i++;
				} else if (/^\s+\S/.test(lines[i]) && items.length) {
					// Continuation / lazy line belonging to the last item.
					items[items.length - 1].content.push(lines[i].replace(/^\s{1,4}/, ''));
					i++;
				} else if (/^\s*$/.test(lines[i])) {
					// A single blank line may separate loose items; peek ahead.
					if (i + 1 < lines.length && (LIST_RE.test(lines[i + 1]) || /^\s+\S/.test(lines[i + 1]))) {
						i++;
					} else {
						break;
					}
				} else {
					break;
				}
			}
			out.push(renderList(items, options));
			continue;
		}

		// Paragraph: gather until a blank line or a block starter.
		const para: string[] = [];
		while (i < lines.length && !/^\s*$/.test(lines[i])) {
			const l = lines[i];
			if (
				FENCE_RE.test(l) ||
				HEADING_RE.test(l) ||
				HR_RE.test(l) ||
				BLOCKQUOTE_RE.test(l) ||
				LIST_RE.test(l) ||
				(l.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
			) {
				break;
			}
			para.push(l);
			i++;
		}
		if (para.length) {
			out.push(`<p>${renderInline(para.join(' '), options)}</p>`);
		}
	}

	return out.join('\n');
}

/** Render a markdown source string to safe HTML for the .prose container. */
export function renderMarkdown(src: string, options: MarkdownOptions = {}): string {
	// Normalize newlines; strip a leading YAML frontmatter block if present.
	let text = src.replace(/\r\n?/g, '\n');
	text = text.replace(/^---\n[\s\S]*?\n---\n/, '');
	return renderBlocks(text.split('\n'), options);
}
