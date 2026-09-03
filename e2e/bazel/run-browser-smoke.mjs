// Chromium loopback smoke over the Bazel-declared site build (TIN-4251 v4 prep).
//
// Shape follows GloriousFlywheel's browser-RBE candidate template
// (examples/web-rbe/run-static-browser-smoke.mjs + the browser-rbe-candidate
// guide): the site is built through declared Bazel inputs (//:build), served
// from INSIDE the test action on 127.0.0.1, and loaded by an
// already-provisioned Chromium named via GF_RBE_CHROMIUM_EXECUTABLE (or its
// fallbacks) through playwright's explicit `executablePath`. No browser binary
// is ever downloaded inside the action — MODULE.bazel pins
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD at npm lifecycle time. HOME and the XDG
// dirs are created writable under the test scratch area before Chromium
// starts.
//
// Smoke assertions: the document title carries the site name, the page loads
// with zero console errors / page errors, and — when
// GF_BROWSER_SMOKE_REQUIRE_PROVENANCE=1 — the footer build-sha provenance
// element exists. That element is +layout.svelte's `{#if buildShaShort}`
// "built from <sha>" paragraph inside `footer.site-footer`; it carries no
// dedicated class, so the default selector targets its one distinctive hook:
// the commit anchor (`${REPO_URL}/commit/${buildSha}`). It renders ONLY when
// PUBLIC_BUILD_SHA was baked into the vite build (src/lib/build-info.ts) —
// today that channel belongs exclusively to the Justfile container-image
// recipes, and //:build is unstamped adapter-static output, so
// REQUIRE_PROVENANCE=1 additionally presumes a build invocation that exports
// PUBLIC_BUILD_SHA into the vite env (see the BUILD.bazel target comment).
//
// `chromium` is imported from @playwright/test (the repo's declared Playwright
// dependency, which re-exports playwright-core's browser types); the guide's
// preferred bare `playwright-core` is not a direct npm dependency here, and
// this harness deliberately reuses what the lockfile already carries.
import { createServer } from 'node:http';
import { accessSync, constants, createReadStream, existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';

const buildDir = resolve(process.env.GF_BROWSER_SMOKE_BUILD_DIR || 'build');
const smokePath = process.env.GF_BROWSER_SMOKE_PATH || '/';
const expectedTitle = process.env.GF_BROWSER_SMOKE_TITLE || 'Great Falls Tool Bus';
const requireProvenance = process.env.GF_BROWSER_SMOKE_REQUIRE_PROVENANCE === '1';
// Default matches this repo's real markup (src/routes/+layout.svelte): the
// conditional "built from <sha>" paragraph has no dedicated class, so the
// stable hook is the GitHub commit link it wraps. `.site-footer__provenance`
// is gftb-site's class and matches nothing here — do not reintroduce it.
const provenanceSelector = process.env.GF_BROWSER_SMOKE_PROVENANCE_SELECTOR || 'footer.site-footer a[href*="/commit/"]';

// Writable browser scratch under the Bazel test scratch area (TEST_TMPDIR)
// rather than the worker's ambient (possibly read-only) HOME.
const scratchRoot = process.env.TEST_TMPDIR || tmpdir();
const chromiumRuntimeDir = mkdtempSync(join(scratchRoot, 'gf-browser-smoke-'));
ensureWritableEnvDir('HOME', join(chromiumRuntimeDir, 'home'));
ensureWritableEnvDir('XDG_CONFIG_HOME', join(chromiumRuntimeDir, 'xdg-config'));
ensureWritableEnvDir('XDG_CACHE_HOME', join(chromiumRuntimeDir, 'xdg-cache'));

if (!existsSync(join(buildDir, 'index.html'))) {
	console.error(`browser smoke requires ${join(buildDir, 'index.html')} (declared //:build output)`);
	process.exit(1);
}

const chromiumPath = findChromiumExecutable();
if (!chromiumPath) {
	console.error(
		'set GF_RBE_CHROMIUM_EXECUTABLE, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, PUPPETEER_EXECUTABLE_PATH, or CHROME_BIN',
	);
	process.exit(1);
}

const server = createServer((request, response) => {
	const url = new URL(request.url ?? '/', 'http://127.0.0.1');
	const filePath = resolvePath(url.pathname);
	if (!filePath) {
		response.writeHead(403);
		response.end('forbidden');
		return;
	}

	const pathToRead = existsSync(filePath) ? filePath : join(buildDir, 'index.html');
	response.setHeader('content-type', contentType(pathToRead));
	createReadStream(pathToRead).pipe(response);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));

const address = server.address();
const baseURL = `http://127.0.0.1:${address.port}`;
let browser;

try {
	browser = await chromium.launch({
		executablePath: chromiumPath,
		headless: true,
		args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
	});

	const page = await browser.newPage();
	const consoleErrors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		consoleErrors.push(String(error));
	});

	await page.goto(`${baseURL}${smokePath}`, { waitUntil: 'networkidle' });

	const pageTitle = await page.title();
	if (!pageTitle.includes(expectedTitle)) {
		throw new Error(`document title ${JSON.stringify(pageTitle)} does not carry ${JSON.stringify(expectedTitle)}`);
	}

	if (requireProvenance) {
		const provenanceCount = await page.locator(provenanceSelector).count();
		if (provenanceCount === 0) {
			throw new Error(
				`footer build-sha provenance element (${provenanceSelector}) is absent — the build carried no ` +
					'PUBLIC_BUILD_SHA, the only channel that renders the footer "built from <sha>" line ' +
					'(src/lib/build-info.ts; today only the Justfile container-image recipes set it, and //:build is ' +
					'unstamped). Require provenance only for a build invocation that exports PUBLIC_BUILD_SHA; ' +
					'otherwise relax with --test_env=GF_BROWSER_SMOKE_REQUIRE_PROVENANCE=0.',
			);
		}
	}

	if (consoleErrors.length > 0) {
		throw new Error(`page emitted ${consoleErrors.length} console error(s):\n${consoleErrors.join('\n')}`);
	}

	console.log(`browser smoke passed for ${smokePath} with ${chromiumPath}`);
} finally {
	await browser?.close();
	await new Promise((resolveClose) => server.close(resolveClose));
}

function resolvePath(pathname) {
	const candidate = normalize(decodeURIComponent(pathname)).replace(/^\/+/, '');
	const target = resolve(buildDir, candidate || 'index.html');
	if (target !== buildDir && !target.startsWith(`${buildDir}${sep}`)) {
		return undefined;
	}

	if (existsSync(target) && statSync(target).isDirectory()) {
		return join(target, 'index.html');
	}

	if (!existsSync(target) && existsSync(`${target}.html`)) {
		return `${target}.html`;
	}

	return target;
}

function contentType(path) {
	switch (extname(path)) {
		case '.css':
			return 'text/css; charset=utf-8';
		case '.html':
			return 'text/html; charset=utf-8';
		case '.js':
			return 'text/javascript; charset=utf-8';
		case '.json':
			return 'application/json; charset=utf-8';
		case '.md':
			return 'text/markdown; charset=utf-8';
		case '.svg':
			return 'image/svg+xml';
		case '.txt':
			return 'text/plain; charset=utf-8';
		case '.webmanifest':
			return 'application/manifest+json; charset=utf-8';
		case '.woff2':
			return 'font/woff2';
		default:
			return 'application/octet-stream';
	}
}

function findChromiumExecutable() {
	const candidates = [
		process.env.GF_RBE_CHROMIUM_EXECUTABLE,
		process.env.GF_CHROMIUM_EXECUTABLE_PATH,
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		process.env.PUPPETEER_EXECUTABLE_PATH,
		process.env.CHROME_BIN,
		'/bin/chromium',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
	].filter(Boolean);

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return '';
}

function ensureWritableEnvDir(name, fallback) {
	const current = process.env[name];
	if (current && isWritableDirectory(current)) {
		return current;
	}

	mkdirSync(fallback, { recursive: true });
	process.env[name] = fallback;
	return fallback;
}

function isWritableDirectory(path) {
	try {
		if (!existsSync(path) || !statSync(path).isDirectory()) {
			return false;
		}
		accessSync(path, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}
