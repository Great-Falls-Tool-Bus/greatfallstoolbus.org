import { defineConfig, devices } from '@playwright/test';

const port = 3000;
const baseURL = `http://localhost:${port}`;
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
		// adapter-node emits a Node server bundle in build/, but booting it needs
		// the full runtime env (DATABASE_URL etc.) that the CI playwright job does
		// not have — CI run 33715124706 proved `node build` cannot start there.
		// The static server below serves only the prerendered subset of build/,
		// which is exactly the surface the current e2e specs exercise. Dynamic
		// (server-rendered) routes are NOT covered by this suite; full-server e2e
		// belongs to the integration/preview-tailnet lane.
		command: 'pnpm run build && pnpm exec serve build -l ' + port,
		port,
		timeout: 180_000,
		reuseExistingServer: !process.env.CI,
	},
});
