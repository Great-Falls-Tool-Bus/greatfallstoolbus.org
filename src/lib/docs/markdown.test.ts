import { describe, expect, it } from 'vitest';
import { renderMarkdown, slugify } from './markdown';

// Contract for the dependency-free operator-docs markdown renderer (see the
// header of markdown.ts for why mdsvex is deliberately NOT reused here). These
// assertions lock the exact features the real docs/**/*.md tree relies on:
// tables (mdsvex ships none), fenced code, nested lists, blockquotes, and the
// public-safe HTML-escaping that lets `<placeholder>` / `{expr}` render as
// literal text on a public site.

describe('renderMarkdown', () => {
	it('renders ATX headings with GitHub-style slug ids', () => {
		expect(renderMarkdown('## Purpose & non-goals')).toBe('<h2 id="purpose-non-goals">Purpose &amp; non-goals</h2>');
	});

	it('escapes angle-bracket placeholders and braces as literal text (public-safe)', () => {
		const html = renderMarkdown('Use `ci/lane/<name>` and set {expr} inline.');
		expect(html).toContain('<code>ci/lane/&lt;name&gt;</code>');
		expect(html).toContain('{expr}');
		expect(html).not.toContain('<name>');
	});

	it('never lets a javascript: URL through', () => {
		const html = renderMarkdown('[x](javascript:alert(1))');
		expect(html).not.toContain('javascript:');
		expect(html).toContain('x');
	});

	it('renders a GFM table with header, body, and alignment', () => {
		const src = ['| Surface | Authority |', '|---|---:|', '| lanes | This doc |'].join('\n');
		const html = renderMarkdown(src);
		expect(html).toContain('<table>');
		expect(html).toContain('<th>Surface</th>');
		expect(html).toContain('<th style="text-align:right">Authority</th>');
		expect(html).toContain('<td>lanes</td>');
	});

	it('renders fenced code blocks with escaped content and a language class', () => {
		const src = ['```bash', 'cd <new-repo>', '```'].join('\n');
		const html = renderMarkdown(src);
		expect(html).toContain('<pre><code class="language-bash">');
		expect(html).toContain('cd &lt;new-repo&gt;');
	});

	it('renders nested unordered lists by indentation', () => {
		const src = ['- parent', '  - child', '- sibling'].join('\n');
		const html = renderMarkdown(src);
		expect(html).toContain('<li>parent<ul><li>child</li></ul></li>');
		expect(html).toContain('<li>sibling</li>');
	});

	it('renders ordered lists', () => {
		const html = renderMarkdown(['1. first', '2. second'].join('\n'));
		expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
	});

	it('renders task-list checkboxes disabled', () => {
		const html = renderMarkdown('- [ ] todo\n- [x] done');
		expect(html).toContain('<input type="checkbox" disabled class="doc-task">');
		expect(html).toContain('<input type="checkbox" disabled checked class="doc-task">');
	});

	it('renders blockquotes with inner blocks', () => {
		const html = renderMarkdown('> **Status**: Normative.');
		expect(html).toContain('<blockquote>');
		expect(html).toContain('<strong>Status</strong>');
	});

	it('renders inline emphasis and links (external gets rel)', () => {
		const html = renderMarkdown('See **bold** and [the site](https://greatfallstoolbus.org).');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<a href="https://greatfallstoolbus.org" rel="noopener external">the site</a>');
	});

	it('resolves relative links via the provided resolver', () => {
		const html = renderMarkdown('[adr](../decisions/0002.md)', {
			resolveLink: (href) => `https://github.com/o/r/blob/main/docs/${href.replace('../', '')}`,
		});
		expect(html).toContain('href="https://github.com/o/r/blob/main/docs/decisions/0002.md"');
	});

	it('renders horizontal rules', () => {
		expect(renderMarkdown('a\n\n---\n\nb')).toContain('<hr>');
	});

	it('strips a leading YAML frontmatter block', () => {
		expect(renderMarkdown('---\ntitle: x\n---\n# Body')).toBe('<h1 id="body">Body</h1>');
	});
});

describe('slugify', () => {
	it('lowercases, drops punctuation, and dashes spaces', () => {
		expect(slugify('1. Purpose & non-goals')).toBe('1-purpose-non-goals');
	});
});
