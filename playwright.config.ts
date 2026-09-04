import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const port = 3000;
const baseURL = `http://${host}:${port}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? 'github' : 'list',
	timeout: 180_000,
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
			},
		},
		// Firefox + WebKit gated behind PLAYWRIGHT_ALL_BROWSERS to keep M0 fast.
		// Enable in M1 CI by setting PLAYWRIGHT_ALL_BROWSERS=1.
		...(process.env.PLAYWRIGHT_ALL_BROWSERS
			? [
					{
						name: 'firefox',
						use: { ...devices['Desktop Firefox'] },
					},
					{
						name: 'webkit',
						use: { ...devices['Desktop Safari'] },
					},
				]
			: []),
	],
	webServer: {
		// Exercise the same custom adapter-node server and explicit origin shape
		// that production uses. A static file server would skip request-time
		// routes and the cache-header wrapper in server.js.
		command: `pnpm run build && HOST=${host} PORT=${port} ORIGIN=${baseURL} NODE_ENV=production node server.js`,
		url: baseURL,
		timeout: 180_000,
		reuseExistingServer: !process.env.CI,
	},
});
