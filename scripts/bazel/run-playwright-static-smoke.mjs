import { createServer } from 'node:http';
import { accessSync, constants, createReadStream, existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';

const buildDir = resolve('build');
const chromiumRuntimeDir = mkdtempSync(join(tmpdir(), 'site-scaffold-playwright-'));
ensureWritableEnvDir('HOME', join(chromiumRuntimeDir, 'home'));
ensureWritableEnvDir('XDG_CONFIG_HOME', join(chromiumRuntimeDir, 'xdg-config'));
ensureWritableEnvDir('XDG_CACHE_HOME', join(chromiumRuntimeDir, 'xdg-cache'));

if (!existsSync(join(buildDir, 'index.html'))) {
	console.error('site.scaffold Playwright smoke requires build/index.html');
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
	await page.goto(`${baseURL}/agent`, { waitUntil: 'networkidle' });
	const text = normalizeWhitespace((await page.locator('body').textContent()) || '');

	for (const term of ['site.scaffold traversal map', 'tinyland-flywheel-bazel', 'just flywheel-test']) {
		if (!text.includes(term)) {
			throw new Error(`agent route did not render expected content: ${term}`);
		}
	}

	console.log(`site.scaffold Playwright static smoke passed with ${chromiumPath}`);
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

function normalizeWhitespace(value) {
	return value.replace(/\s+/g, ' ').trim();
}
