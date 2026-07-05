import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { accessibilityPlugin } from '@tummycrypt/vite-plugin-a11y';
import { skeletonColorUtilities } from '@tummycrypt/vite-plugin-skeleton-colors';
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import pkg from './package.json';

// Skeleton-Tailwind v4 compatibility shim. Skeleton 4.15.2 still ships
// CSS using `@variant` and `@apply variant-*` syntax that pre-dates
// Tailwind v4 stable. This plugin rewrites those to stable equivalents
// during transform. Lifted verbatim from
// jesssullivan.github.io-vite8/vite.config.ts.
function skeletonTailwindV4Compat(): Plugin {
	return {
		name: 'skeleton-tailwind-v4-compat',
		enforce: 'pre',
		transform(code, id) {
			if (id.includes('@skeletonlabs/skeleton') && id.endsWith('.css')) {
				code = code
					.replace(/@variant\s+sm\s*{/g, '@media (min-width: 640px) {')
					.replace(/@variant\s+md\s*{/g, '@media (min-width: 768px) {')
					.replace(/@variant\s+lg\s*{/g, '@media (min-width: 1024px) {')
					.replace(/@variant\s+xl\s*{/g, '@media (min-width: 1280px) {')
					.replace(/@variant\s+2xl\s*{/g, '@media (min-width: 1536px) {')
					.replace(/@variant\s+dark\s*{/g, '.dark & {')
					.replace(/@apply\s+variant-/g, '@apply ');
				return { code, map: null };
			}
		},
	};
}

// Build-info constants (mirrors MassageIthaca's build-info `define`). Resolved
// once at config load. Env wins (CI), then a local git checkout, else unknown.
function resolveCommitHash(): string {
	const fromEnv = process.env.BUILD_COMMIT_SHA || process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || '';
	if (fromEnv) return fromEnv;
	try {
		// stderr ignored: on remote RBE workers git is absent and the shell's
		// "git: command not found" polluted proof logs (the catch already
		// handles the failure -> 'unknown').
		return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return 'unknown';
	}
}

const commitHash = resolveCommitHash();
const buildInfo = {
	version: pkg.version,
	commitHash,
	commitShort: commitHash === 'unknown' ? 'unknown' : commitHash.slice(0, 7),
};

// Bundle profiling: `ANALYZE=1 just build` (or `just analyze`) emits an
// interactive treemap at .bundle-stats/stats.html. Loaded lazily at module
// scope so ordinary builds never touch the plugin (it is a devDependency
// only). BUILD_ANALYZE is honored for backwards compatibility with the old
// Justfile recipe. Mirrors MassageIthaca/vite.config.ts.
const analyzePlugins: PluginOption[] = [];
const analyzeRequested =
	process.env.ANALYZE === '1' ||
	process.env.ANALYZE === 'true' ||
	process.env.BUILD_ANALYZE === '1' ||
	process.env.BUILD_ANALYZE === 'true';
if (analyzeRequested) {
	const { visualizer } = await import('rollup-plugin-visualizer');
	analyzePlugins.push(
		visualizer({
			filename: '.bundle-stats/stats.html',
			template: 'treemap',
			gzipSize: true,
			brotliSize: true,
		}) as Plugin,
	);
}

// NOTE on @sveltejs/enhanced-img: deliberately NOT wired here. It is still
// 0.x / experimental and is a build-time `<enhanced:img>` transform; it does
// NOT cover runtime/static assets in `static/`, which is the scaffold's
// default image path. The committed pipeline is `just optimize-images`
// (sharp + svgo -> webp/avif renditions plus static/image-manifest.json with
// intrinsic width/height), chained into `just build` when static/photos has
// assets. Consumption goes through src/lib/responsive-image.ts and the
// manifest-driven Picture.svelte component. Spokes that want the build-time
// transform can opt in by adding `enhancedImages()` to the plugins below,
// but it is not the default and is not a dependency of this scaffold.
export default defineConfig({
	// Expose `PUBLIC_`-prefixed env vars to client source via `import.meta.env`
	// (alongside Vite's built-in `VITE_`). This is what makes the operator-owned
	// build flags real: PUBLIC_ARCHIVE_LIVE (TIN-2528, the discuss@ archive gate,
	// default false / fail-closed) and the pre-existing PUBLIC_GFTB_FORM_ENDPOINT
	// are read via `import.meta.env.PUBLIC_*`, and Vite only inlines a prefix it
	// is told about. `PUBLIC_` matches SvelteKit's own public-env convention, so
	// nothing secret is widened by this — only already-public toggles.
	envPrefix: ['VITE_', 'PUBLIC_'],
	plugins: [
		skeletonTailwindV4Compat(),
		skeletonColorUtilities(),
		tailwindcss(),
		accessibilityPlugin({
			wcagLevel: 'AA',
			failOnError: false,
		}),
		sveltekit(),
		...analyzePlugins,
	],

	// Build-time constants. Source that reads __VERSION__ / __COMMIT_HASH__
	// should declare them as ambient globals (see src/app.d.ts when needed).
	define: {
		__VERSION__: JSON.stringify(buildInfo.version),
		__COMMIT_HASH__: JSON.stringify(buildInfo.commitHash),
		__COMMIT_SHORT__: JSON.stringify(buildInfo.commitShort),
	},

	build: {
		reportCompressedSize: true,
		chunkSizeWarningLimit: 250,

		// CSS code splitting + Lightning CSS minification (mirrors MI).
		cssCodeSplit: true,
		cssMinify: 'lightningcss',

		// Vendor chunk splitter. vite 8 in this house is rolldown-backed, so
		// the splitter lives under `rolldownOptions` (the rollupOptions analog).
		// Only node_modules is split — SvelteKit owns app-code chunking.
		rolldownOptions: {
			output: {
				manualChunks(id: string) {
					if (!id.includes('node_modules')) return undefined;
					// effect is large and pulled into the client runtime.
					if (id.includes('/effect/')) return 'vendor-effect';
					// shiki ships big grammar/theme JSON when used client-side.
					if (id.includes('/shiki/')) return 'vendor-shiki';
					return undefined;
				},
			},
		},
	},
});
