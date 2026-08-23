import { describe, expect, it } from 'vitest';
import {
	ALLOWED_HOSTS,
	ALLOWED_MAILBOXES,
	LEAK_RULES,
	PERMITTED_NAME_FORMS,
	REPO_ROOT,
	SKIP_EXTENSIONS,
	TEXT_EXTENSIONS,
	UnclassifiedOutputError,
	collectFiles,
	formatFindings,
	scanFiles,
	scanText,
} from '../../scripts/lib/leak-scan.mjs';

// Acceptance row: nothing private reaches what this repository publishes. The
// rules are proven here against synthetic material; `just leak-scan-build`
// runs the same rules over a materialized build/ (scripts/check-build-output.mjs)
// and `just leak-scan-tree` runs a curated subset over docs/static/top-level
// prose (scripts/check-tracked-tree.mjs) — the variants that need real files
// on disk and therefore cannot live in this in-memory unit suite.
//
// PORTED from gftb-site's src/lib/leak-scan.test.ts (see
// scripts/lib/leak-scan.mjs's header comment for the citation trail). Every
// fixture below is synthetic: no real credential, hostname, or private name
// appears anywhere in this file, including in the "must detect" assertions —
// see #187's lesson in scripts/lib/leak-scan.mjs's header for why that
// matters even for a detector's own test data.

const ruleIds = LEAK_RULES.map((rule) => rule.id);
const idsFiring = (text: string) => new Set(scanText('fixture.html', text).map((finding) => finding.ruleId));

describe('leak-scan rule set', () => {
	it('declares unique, compilable rules', () => {
		expect(ruleIds.length).toBeGreaterThan(10);
		expect(new Set(ruleIds).size).toBe(ruleIds.length);
		for (const rule of LEAK_RULES) {
			expect(rule.description, `${rule.id} description`).toBeTruthy();
			expect(() => new RegExp(rule.pattern, `${rule.flags}g`)).not.toThrow();
		}
	});

	it('covers every category this repo actually ported (see leak-scan-rules.json header for the two dropped)', () => {
		for (const required of [
			'secret-pem-block',
			'secret-cloud-access-key',
			'secret-json-web-token',
			'kubeconfig-fragment',
			'internal-hostname',
			'private-network-address',
			'cache-or-executor-endpoint',
			'private-personal-name',
			'private-list-archive',
		]) {
			expect(ruleIds).toContain(required);
		}
		// Deliberately NOT ported — see leak-scan-rules.json's header comment.
		expect(ruleIds).not.toContain('internal-tracker-reference');
	});

	it('never matches on a literal protected string — every rule is shape-based', () => {
		// The #187 lesson, preserved: grep the rule source text itself for
		// anything that looks like a real committed identifier rather than a
		// regex primitive. A shape-based rule's pattern is built from character
		// classes, anchors, and quantifiers, not literal names.
		//
		// Strengthened per review (F7): the previous version of this assertion
		// only rejected a pattern consisting ENTIRELY of
		// [A-Za-z0-9 .@_-] characters, so a literal name merely wrapped in
		// trivial regex escapes (`\bJaneDoe\b`) would sail through undetected —
		// the backslashes alone make `.not.toMatch(/^[A-Za-z0-9 .@_-]{6,}$/)`
		// pass even though the pattern is still just a hardcoded identifier.
		// Every rule must use REAL regex structure (a character class,
		// quantifier, or alternation), not just escape characters around a
		// literal run.
		for (const rule of LEAK_RULES) {
			expect(rule.pattern, `${rule.id} pattern should be a shape, not a literal`).not.toMatch(/^[A-Za-z0-9 .@_-]{6,}$/);
			const hasRealStructure = /[[\]{}|+*?]|\\p\{[A-Za-z]+\}|\\[dsSwW]/u.test(rule.pattern);
			expect(hasRealStructure, `${rule.id} pattern should contain a character class, quantifier, or alternation`).toBe(
				true,
			);
		}
	});

	it('the two identity-sensitive rules carry no bare name-shaped literal in their own pattern source', () => {
		// Targets the exact gap the previous test's heuristic missed: a rule
		// like `\bJaneDoe\b` reads as "shape-based" to a naive escape-character
		// check, but "JaneDoe" is still a real committed identifier once the
		// regex syntax around it is stripped away. private-personal-name and
		// private-list-archive are the two rules whose whole subject is
		// identity/consent, so they are the ones a #187-style mistake would
		// actually land in.
		const identityRuleIds = ['private-personal-name', 'private-list-archive'];
		const identityRules = LEAK_RULES.filter((rule) => identityRuleIds.includes(rule.id));
		expect(identityRules.map((rule) => rule.id).sort()).toEqual([...identityRuleIds].sort());
		for (const rule of identityRules) {
			const stripped = rule.pattern
				.replace(/\\p\{[A-Za-z]+\}/gu, '')
				.replace(/\\[bBdsSwW]/gu, '')
				.replace(/\(\?[:<=!][^)]*\)|[()[\]{}|+*?^$.]/gu, '')
				.trim();
			// A real name would survive stripping as an unbroken mixed-case run
			// (e.g. "JaneDoe"); this rule's own structural fragments do not —
			// they are lowercase, punctuation-joined literals like
			// "hyperkitty/list/keyholders@".
			expect(
				stripped,
				`${rule.id} residual literal text after stripping regex syntax: ${JSON.stringify(stripped)}`,
			).not.toMatch(/[A-Z][a-z]{3,}[A-Z][a-z]{3,}/u);
		}
	});
});

// A sequential, never-issued forge token shaped like a real one, assembled at
// run time so no gitleaks pass sees a contiguous token literal in this file.
const FAKE_FORGE_TOKEN = ['ghp_', '0123456789abcdefghijklmnopqrstuvwxyz'].join('');

describe('leak-scan detections', () => {
	it('catches secret material', () => {
		expect(idsFiring('-----BEGIN RSA PRIVATE KEY-----')).toContain('secret-pem-block');
		expect(idsFiring('AKIAIOSFODNN7EXAMPLE')).toContain('secret-cloud-access-key');
		expect(idsFiring(FAKE_FORGE_TOKEN)).toContain('secret-forge-token');
		const jwtFixture = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r'].join(
			'.',
		);
		expect(idsFiring(jwtFixture)).toContain('secret-json-web-token');
		expect(idsFiring('api_key = "s3cret-value-abcdefghij"')).toContain('secret-assignment');
	});

	// Assembled at run time, same technique as FAKE_FORGE_TOKEN above: this
	// repo's OWN scan-endpoints (`scripts/scan-internal-endpoints.sh`) greps
	// tracked source for contiguous cluster-hostname/RFC1918 shapes, and a
	// contiguous fixture in THIS file previously red-lined that gate (a real
	// incident: `just check` recipe 4 failed on this file at the PR head, see
	// the porting PR's review history). No contiguous copy of either shape may
	// appear in this file's source text.
	const FAKE_CLUSTER_HOST = ['mailman-web.some-namespace', 'svc.cluster.local'].join('.');
	const FAKE_RFC1918_HOST = ['10', '20', '30', '40'].join('.');

	it('catches cluster and kubeconfig fragments', () => {
		expect(idsFiring('client-certificate-data: LS0tLS1CRUdJTg==')).toContain('kubeconfig-fragment');
		expect(idsFiring('current-context: production')).toContain('kubeconfig-fragment');
		expect(idsFiring(FAKE_CLUSTER_HOST)).toContain('internal-hostname');
		expect(idsFiring('runner.example.ts.net')).toContain('internal-hostname');
		expect(idsFiring(FAKE_RFC1918_HOST)).toContain('private-network-address');
		expect(idsFiring('100.101.102.103')).toContain('private-network-address');
		expect(idsFiring('grpcs://cache.example.invalid')).toContain('cache-or-executor-endpoint');
		expect(idsFiring('https://bazel-cache.example.invalid/x')).toContain('cache-or-executor-endpoint');
		expect(idsFiring('http://localhost:3000/')).toContain('localhost-reference');
	});

	it('does NOT flag bare IPv4 loopback as a private-network-address (dropped deliberately, see leak-scan-rules.json)', () => {
		expect(idsFiring('listen_addresses=127.0.0.1')).not.toContain('private-network-address');
	});

	it('catches developer artefacts, but not a bundler license-banner path (dropped deliberately)', () => {
		expect(idsFiring('//# sourceMappingURL=app.js.map')).toContain('source-map-or-dev-artifact');
		expect(idsFiring('/Users/example/git/greatfallstoolbus.org/src')).toContain('developer-filesystem-path');
		// gftb-site's ported rule also banned a bare `node_modules/` substring;
		// this repo dropped that sub-pattern because production bundles here
		// routinely emit third-party license-attribution comments that legitimately
		// cite a dependency's node_modules path (not a leaked dev artefact).
		expect(idsFiring('license banner: from .pnpm/@lucide+svelte@1.2.0/node_modules/lucide-svelte/dist')).not.toContain(
			'source-map-or-dev-artifact',
		);
	});

	it('permits only the explicitly reviewed name-shape exceptions', () => {
		expect(PERMITTED_NAME_FORMS.some((p) => p.file === 'AGENTS.md' && p.text === 'A. See')).toBe(true);
		// The review's hostile table (gftb-site E1, ported here), row by row:
		// every real-name shape fires — WITH and WITHOUT the space after the
		// initial — while a minified member access and a reviewed sentence-
		// punctuation exception stay silent.
		expect(idsFiring('Ask J. Doe when you arrive.')).toContain('private-personal-name');
		expect(idsFiring('Ask Jane Q. Doe when you arrive.')).toContain('private-personal-name');
		expect(idsFiring('Ask J.Doe when you arrive.')).toContain('private-personal-name');
		expect(idsFiring('<p>J.Doe</p>')).toContain('private-personal-name');
		expect(idsFiring('(J.Doe) signed the sheet')).toContain('private-personal-name');
		// The Zag machine false-positive class (enum member reads behind
		// = / ! / ; never fire) — ported from gftb-site's own hostile test.
		expect(idsFiring('if(S===H.Started)return;u.current=d.current')).not.toContain('private-personal-name');
		expect(idsFiring('let e=S===H.Started;S=H.Stopped')).not.toContain('private-personal-name');
	});

	it('scopes the sentence-punctuation exception to the exact file it was reviewed for (F2)', () => {
		// Fixed per review (F2): PERMITTED_NAME_FORMS used to be a flat string
		// list, so an exception added for ONE sentence in AGENTS.md was
		// permitted everywhere — in build/index.html, in every doc, anywhere
		// the same shape happened to appear. "See" is a real surname, so a
		// global pass is a real hole, not a cosmetic one. The exception is now
		// (file, text) scoped: the exact string in the exact file it was
		// reviewed for is silent; the identical string anywhere else still
		// fires, and a nearby-but-different capital-letter break in the SAME
		// file still fires too.
		const inReviewedFile = scanText('AGENTS.md', 'under mechanism A. See the next section');
		expect(inReviewedFile.map((f) => f.ruleId)).not.toContain('private-personal-name');

		const sameTextElsewhere = scanText('docs/some-other-file.md', 'under mechanism A. See the next section');
		expect(sameTextElsewhere.map((f) => f.ruleId)).toContain('private-personal-name');

		const differentBreakSameFile = scanText('AGENTS.md', 'under mechanism B. See the next section');
		expect(differentBreakSameFile.map((f) => f.ruleId)).toContain('private-personal-name');
	});

	it('permits the licensing-required historical attribution credit only where it is actually cited', () => {
		const attribution = PERMITTED_NAME_FORMS.find((p) => p.file === 'docs/attribution.md');
		expect(attribution).toBeDefined();
		const inAttribution = scanText('docs/attribution.md', `photographed by ${attribution!.text} in 1922`);
		expect(inAttribution.map((f) => f.ruleId)).not.toContain('private-personal-name');
		// Same exact name string in an UNRELATED file (not a reviewed
		// attribution credit there) still fires — the exception does not
		// generalize to "this name is fine everywhere now".
		const elsewhere = scanText('src/lib/data/mail-clients.ts', `photographed by ${attribution!.text} in 1922`);
		expect(elsewhere.map((f) => f.ruleId)).toContain('private-personal-name');
	});

	it('catches the private keyholders list archive', () => {
		expect(idsFiring('https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/')).toContain(
			'private-list-archive',
		);
		expect(idsFiring('mailto:keyholders@latoolb.us')).not.toContain('private-list-archive');
	});
});

describe('positive allowlists (never a denylist of protected identifiers)', () => {
	it('flags an unreviewed outbound host but not a reviewed one', () => {
		// Not an RFC 2606 reserved suffix (example/invalid/test/localhost) on
		// purpose, so this fixture actually exercises the reviewed-allowlist
		// check rather than the reserved-domain carve-out below.
		expect(idsFiring('see https://leak-scan-fixture-host.zzz/path')).toContain('unreviewed-outbound-host');
		expect(idsFiring('see https://greatfallstoolbus.org/path')).not.toContain('unreviewed-outbound-host');
		// Any subdomain of this site's own two public domains is allowed
		// generically (SELF_DOMAIN_RE) rather than enumerated one at a time.
		expect(idsFiring('see https://some-new-subdomain.latoolb.us/path')).not.toContain('unreviewed-outbound-host');
	});

	it('flags an unreviewed mailbox, and does NOT extend the self-domain pass to mailboxes', () => {
		expect(idsFiring('contact fixture-only@leak-scan-fixture-host.zzz')).toContain('unreviewed-mailbox');
		expect(idsFiring(`contact ${ALLOWED_MAILBOXES[0]}`)).not.toContain('unreviewed-mailbox');
		// An address on this site's OWN domain is still checked against the
		// reviewed list — being on our domain is not automatically public.
		expect(idsFiring('contact someone-not-reviewed@latoolb.us')).toContain('unreviewed-mailbox');
	});

	it('always allows RFC 2606 reserved documentation/test domains regardless of the reviewed allowlist', () => {
		expect(idsFiring('see https://example.com/path')).not.toContain('unreviewed-outbound-host');
		expect(idsFiring('see https://sub.example.org/path')).not.toContain('unreviewed-outbound-host');
		expect(idsFiring('contact person@example.invalid')).not.toContain('unreviewed-mailbox');
	});

	it('exposes non-empty, reviewed allowlists', () => {
		expect(ALLOWED_HOSTS.length).toBeGreaterThan(0);
		expect(ALLOWED_MAILBOXES.length).toBeGreaterThan(0);
	});
});

describe('operator-supplied deniedLiterals (never committed)', () => {
	it('flags a literal only when explicitly supplied at call time', () => {
		const text = 'the operator-marked value SYNTHETIC-DENY-FIXTURE appears here';
		expect(scanText('f.html', text)).toHaveLength(0);
		const findings = scanText('f.html', text, { deniedLiterals: ['SYNTHETIC-DENY-FIXTURE'] });
		expect(findings.map((f) => f.ruleId)).toContain('operator-denied-literal');
	});

	// Adversarial review finding (B3): a repeated needle within the excerpt
	// window used to print the REAL, unredacted value — a public-repo, public-
	// CI-log disclosure of exactly the thing this gate exists to protect,
	// which for the GFTB_LEAK_SCAN_DENY path is a real operator-supplied
	// private literal, not a synthetic rule shape. Two distinct failure modes,
	// both must stay closed: (1) `String.prototype.replace(string, ...)`
	// replaces only the FIRST occurrence, printing the second in full; (2)
	// redacting only inside an already-sliced window can still print a
	// TRUNCATED fragment of a second occurrence straddling the window edge —
	// not the complete needle, but enough characters to defeat the point.
	it('never prints the needle, whole or as a fragment, when it repeats near itself (B3)', () => {
		const needle = 'SYNTHETIC-PRIVATE-NAME';
		const text = `ask ${needle} or ${needle} today`; // two copies ~19 chars apart
		const findings = scanText('f.html', text, { deniedLiterals: [needle] });
		expect(findings.length).toBeGreaterThan(0);
		for (const finding of findings) {
			expect(finding.excerpt).not.toContain(needle);
			// No fragment of length >= 4 of the needle may survive either —
			// this is what catches failure mode 2 (a partial copy at a window
			// boundary), which a whole-string `.includes(needle)` check alone
			// would miss.
			for (let len = needle.length; len >= 4; len -= 1) {
				for (let start = 0; start + len <= needle.length; start += 1) {
					expect(finding.excerpt).not.toContain(needle.slice(start, start + len));
				}
			}
		}
	});

	it('never prints a repeated secret-shaped match either, not just deniedLiterals (B3)', () => {
		const text = 'AKIAIOSFODNN7EXAMPLE and again AKIAIOSFODNN7EXAMPLE right here';
		const findings = scanText('f.html', text);
		expect(findings.map((f) => f.ruleId)).toContain('secret-cloud-access-key');
		for (const finding of findings) {
			expect(finding.excerpt).not.toContain('AKIAIOSFODNN7EXAMPLE');
		}
	});
});

describe('excludeRuleIds (scripts/check-tracked-tree.mjs governance-prose carve-out)', () => {
	it('suppresses exactly the named rules and nothing else', () => {
		const text = 'current-context: production and an AKIAIOSFODNN7EXAMPLE key';
		const withExclusion = scanText('f.md', text, { excludeRuleIds: ['kubeconfig-fragment'] });
		expect(withExclusion.map((f) => f.ruleId)).not.toContain('kubeconfig-fragment');
		expect(withExclusion.map((f) => f.ruleId)).toContain('secret-cloud-access-key');
	});
});

describe('formatFindings', () => {
	it('reports a clean scan and a redacted excerpt for a real finding', () => {
		expect(formatFindings([])).toBe('leak-scan: no findings');
		const findings = scanText('f.html', 'AKIAIOSFODNN7EXAMPLE');
		const formatted = formatFindings(findings);
		expect(formatted).toContain('secret-cloud-access-key');
		expect(formatted).not.toContain('AKIAIOSFODNN7EXAMPLE');
	});
});

describe('scanFiles', () => {
	it('scans multiple files and preserves per-file findings', () => {
		const findings = scanFiles([
			{ path: 'a.html', text: 'clean' },
			{ path: 'b.html', text: 'AKIAIOSFODNN7EXAMPLE' },
		]);
		expect(findings).toHaveLength(1);
		expect(findings[0].file).toBe('b.html');
	});
});

describe('collectFiles / UnclassifiedOutputError (fail-closed extension coverage)', () => {
	it('classifies every extension actually present in TEXT_EXTENSIONS or SKIP_EXTENSIONS', () => {
		// Guards against a silent drift where a real published extension (seen
		// once in `just build` output) is neither scanned nor explicitly
		// skipped — see collectFiles's own doc comment for why this fails
		// closed instead of defaulting either way.
		for (const ext of ['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml', '.md', '']) {
			expect(TEXT_EXTENSIONS.has(ext), `${ext || '<no ext>'} should be scanned as text`).toBe(true);
		}
		for (const ext of ['.br', '.gz', '.woff2', '.png', '.jpg']) {
			expect(SKIP_EXTENSIONS.has(ext), `${ext} should be a known-opaque skip`).toBe(true);
		}
	});

	it('throws UnclassifiedOutputError rather than silently skipping an unknown extension', async () => {
		const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const path = await import('node:path');
		const dir = mkdtempSync(path.join(tmpdir(), 'leak-scan-unclassified-'));
		try {
			writeFileSync(path.join(dir, 'mystery.wasm'), 'not real wasm, just a fixture');
			expect(() => collectFiles(dir)).toThrow(UnclassifiedOutputError);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('REPO_ROOT resolves to this repository, not the scripts/lib directory', async () => {
		// Strengthened per review (F7): `REPO_ROOT.split('/').length > 0` is
		// tautologically true for any non-empty string, so the previous `||`
		// made this assertion pass regardless of what REPO_ROOT actually
		// resolved to. Assert real, falsifiable facts instead: a known
		// repo-root file exists directly under REPO_ROOT, the module that
		// exports REPO_ROOT is reachable at the expected repo-relative path
		// from it, and REPO_ROOT itself does not end in scripts/ or lib/ (the
		// exact off-by-one this check exists to catch).
		const { existsSync } = await import('node:fs');
		const path = await import('node:path');
		expect(existsSync(path.join(REPO_ROOT, 'Justfile'))).toBe(true);
		expect(existsSync(path.join(REPO_ROOT, 'scripts', 'lib', 'leak-scan.mjs'))).toBe(true);
		expect(REPO_ROOT.endsWith(`${path.sep}scripts`)).toBe(false);
		expect(REPO_ROOT.endsWith(`${path.sep}lib`)).toBe(false);
	});
});
