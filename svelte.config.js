import adapterNode from '@sveltejs/adapter-node';
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

// GFTB is an app-stateful product whose sole served artifact is the
// adapter-node server image. The previous environment-selected adapter-static
// branch let local/CI builds validate bytes that could never be promoted to
// production. One source build now has one product shape everywhere, including
// the Bazel action submitted through the v4 REAPI fabric.
const adapter = adapterNode({ precompress: true });

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.svx'],
	preprocess: [vitePreprocess(), modernMdsvexPreprocess],
	compilerOptions: {
		runes: true,
	},
	kit: {
		adapter,
		prerender: {
			handleHttpError: 'warn',
			handleMissingId: 'warn',
			// `handleUnseenRoutes` keeps its SvelteKit >= 2.16 default ('fail'): a
			// genuinely orphaned/unlinked prerenderable page fails the gate here.
			// The former TIN-3898 carve-out for `/discuss/[thread]` (its entries()
			// enumerated pages from the live archive, so off-cluster builds
			// legitimately produced none) is retired with the D15 revival: the
			// revived /discuss routes are `prerender = false` and served only by
			// the ADAPTER=node origin, so they never enter the prerenderer at all.
		},
	},
};

export default config;
