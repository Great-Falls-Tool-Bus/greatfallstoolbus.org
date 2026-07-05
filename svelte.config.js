import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';

const mdsvexPreprocess = mdsvex({ extensions: ['.svx'] });
const modernMdsvexPreprocess = {
	...mdsvexPreprocess,
	async markup(options) {
		const transformed = await mdsvexPreprocess.markup?.(options);
		if (!transformed?.code) return transformed;
		return {
			...transformed,
			code: transformed.code.replace(/<script\s+context=(["'])module\1>/g, '<script module>'),
		};
	},
};

// On-cluster readiness (TIN-2541). The PRODUCTION default is unchanged:
// adapter-static -> Cloudflare Pages (ADR 0003), DB-less, no edge auth. Setting
// ADAPTER=node selects @sveltejs/adapter-node so the same source can be served
// in-cluster as `node build/index.js` (see ContainerFile). This is declare-only
// optionality, NOT a hosting change: ADR 0003 keeps CF Pages as the bound host
// and explicitly rejected cluster-served static as the production host.
//
// adapter-node is imported lazily and is intentionally NOT a committed
// devDependency yet: the frozen-lockfile static build (the default) never
// touches it, so every default gate stays green. The ContainerFile installs it
// at image-build time. Promoting it to a package.json devDependency is a
// deliberate follow-up contract bump (pnpm lockfile + Bazel graph); see
// docs/deploy/oncluster-container-readiness.md.
const useNodeAdapter = process.env.ADAPTER === 'node';

let adapter;
if (useNodeAdapter) {
	const { default: adapterNode } = await import('@sveltejs/adapter-node');
	adapter = adapterNode();
} else {
	adapter = adapterStatic({
		pages: 'build',
		assets: 'build',
		fallback: '404.html',
		precompress: true,
		strict: false,
	});
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.svx'],
	preprocess: [vitePreprocess(), modernMdsvexPreprocess],
	compilerOptions: {
		runes: true,
	},
	kit: {
		adapter,
		paths: {
			// GitHub Pages project-path hosting needs base="/<repo>" (set BASE_PATH in CI);
			// a custom domain / Cloudflare uses base="" (see docs/deploy/cloudflare-pages.md).
			base: process.env.BASE_PATH ?? '',
		},
		prerender: {
			handleHttpError: 'warn',
			handleMissingId: 'warn',
		},
	},
};

export default config;
