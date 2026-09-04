import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { accessibilityPlugin } from '@tummycrypt/vite-plugin-a11y';
import { skeletonColorUtilities } from '@tummycrypt/vite-plugin-skeleton-colors';
import { defineConfig, type Plugin, type PluginOption } from 'vite';

// NOTE: the old skeletonTailwindV4Compat() shim (needed for Skeleton 4.15.2's
// pre-stable `@variant` / `@apply variant-*` syntax) is deliberately GONE.
// Skeleton 5 ships stable Tailwind v4 syntax and its base/globals.css requires
// the `@variant dark` blocks to be RETAINED — the shim's `@variant dark` →
// `.dark &` rewrite would break them (this app switches dark mode via
// [data-mode], never a `.dark` class). skeletonColorUtilities() below is NOT
// part of that shim and stays: it supplies paired utilities like
// `text-surface-900-50` that Skeleton itself never ships.

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
	// (alongside Vite's built-in `VITE_`). The future typed GF-I07/GF-I09
	// provenance carrier may supply PUBLIC_BUILD_SHA through this seam; no
	// runtime authority or secret is widened by the prefix.
	envPrefix: ['VITE_', 'PUBLIC_'],

	// `@tummycrypt/tinyland-auth@0.3.3` does `import * as bcrypt from 'bcryptjs'`,
	// and bcryptjs@2.4.3 is a UMD-only CJS artifact: under PLAIN node ESM —
	// which is exactly how adapter-node loads production `dependencies`, since
	// it bundles only devDependencies — cjs-module-lexer extracts no named
	// exports from it, `bcrypt.hash` is undefined, and every hashPassword/
	// verifyPassword call throws at runtime (TIN-3817 S2; probed and confirmed
	// on node 24). Bundling the package through Vite applies real CJS interop
	// and makes the named import work. vitest.integration.config.ts carries the
	// same setting for the test lane, and the integration suite's password rows
	// would catch a regression here.
	ssr: {
		noExternal: ['@tummycrypt/tinyland-auth'],
	},

	plugins: [
		skeletonColorUtilities(),
		tailwindcss(),
		accessibilityPlugin({
			wcagLevel: 'AA',
			failOnError: false,
		}),
		sveltekit(),
		...analyzePlugins,
	],

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
