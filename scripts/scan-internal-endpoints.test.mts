import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// End-to-end guard for scripts/scan-internal-endpoints.sh, the public-safety
// denylist that keeps private cluster endpoints out of this PUBLIC repo.
//
// Regression fixed here: the RFC1918 private-IP pattern was
//   (10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.N\.N\.N
// One shared 3-octet suffix assumed a 1-octet prefix. The 10.x branch works
// (10 + 3 octets = 4), but the 2-octet 192.168 and 172.16-31 branches demanded
// a phantom 5th octet, so real 4-octet addresses like 192.168.70.11 and
// 172.20.5.5 slipped past the scanner undetected.
//
// This test runs the REAL scanner (no reimplemented regex) against throwaway
// git repos, so it proves the shipped bash behaviour, on the same grep the CI
// gate uses. Private IPs live only in ephemeral temp dirs, never committed.
// The fixture octets below are assembled with ip() so no literal dotted private
// address exists in this tracked file for the scanner to (correctly) flag.

const scannerPath = fileURLToPath(new URL('./scan-internal-endpoints.sh', import.meta.url));

/** Assemble a dotted IPv4 string from octet parts (keeps literals out of source). */
const ip = (...octets: Array<number | string>): string => octets.join('.');

interface ScanResult {
	status: number;
	output: string;
}

/**
 * Run the real scanner against a throwaway git repo seeded with `files`
 * (repo-relative path -> contents). Returns exit status + combined output.
 */
function runScanner(files: Record<string, string>): ScanResult {
	const dir = mkdtempSync(path.join(tmpdir(), 'scan-endpoints-'));
	try {
		const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
		git('init', '-q');

		// The scanner derives its root from its own location (dirname/..), so a
		// copy under scripts/ makes the temp repo its scan root. Being tracked,
		// the copy is self-excluded exactly as in the real repo.
		mkdirSync(path.join(dir, 'scripts'), { recursive: true });
		copyFileSync(scannerPath, path.join(dir, 'scripts', 'scan-internal-endpoints.sh'));

		for (const [rel, contents] of Object.entries(files)) {
			const abs = path.join(dir, rel);
			mkdirSync(path.dirname(abs), { recursive: true });
			writeFileSync(abs, contents);
		}

		// git ls-files reads the index; staging (no commit) is enough.
		git('add', '-A');

		const res = spawnSync('bash', ['scripts/scan-internal-endpoints.sh'], {
			cwd: dir,
			encoding: 'utf8',
		});
		return { status: res.status ?? -1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('scan-internal-endpoints private-IP guard', () => {
	it('flags 192.168.0.0/16 addresses (regression: 192.168.70.11 slipped past)', () => {
		const addr = ip(192, 168, 70, 11);
		const { status, output } = runScanner({ 'infra/notes.txt': `endpoint ${addr}\n` });
		expect(status).toBe(1);
		expect(output).toContain(addr);
		expect(output).toContain('FAIL');
	});

	it('flags 172.16.0.0/12 addresses (172.20.5.5) and the range edges', () => {
		for (const addr of [ip(172, 20, 5, 5), ip(172, 16, 0, 1), ip(172, 31, 255, 254)]) {
			const { status, output } = runScanner({ 'infra/notes.txt': `host ${addr}\n` });
			expect(status, `${addr} should be flagged`).toBe(1);
			expect(output).toContain(addr);
		}
	});

	it('flags 10.0.0.0/8 addresses (10.1.2.3)', () => {
		const addr = ip(10, 1, 2, 3);
		const { status, output } = runScanner({ 'infra/notes.txt': `bind ${addr}\n` });
		expect(status).toBe(1);
		expect(output).toContain(addr);
	});

	it('reports a clean tree for public IPs (8.8.8.8, 1.1.1.1)', () => {
		const { status, output } = runScanner({
			'docs/dns.txt': `resolvers ${ip(8, 8, 8, 8)} ${ip(1, 1, 1, 1)} ${ip(9, 9, 9, 9)}\n`,
		});
		expect(status).toBe(0);
		expect(output).toContain('clean');
	});

	it('does not false-positive on a public IP embedding a private substring (210.1.2.3)', () => {
		// 210.1.2.3 contains "10.1.2.3"; the leading \b keeps it from tripping the
		// 10.x branch. Also guards the 172 out-of-range boundaries.
		const { status, output } = runScanner({
			'docs/dns.txt': `public ${ip(210, 1, 2, 3)} ${ip(172, 15, 0, 1)} ${ip(172, 32, 0, 1)}\n`,
		});
		expect(status).toBe(0);
		expect(output).toContain('clean');
	});

	it('still ignores a version-like dotted number that is not a private IP (4.10.2.3)', () => {
		const { status } = runScanner({ 'docs/ver.txt': `bumped to ${ip(4, 10, 2, 3)}\n` });
		expect(status).toBe(0);
	});
});
