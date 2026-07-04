import adapter from '@sveltejs/adapter-static';
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

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.svx'],
	preprocess: [vitePreprocess(), modernMdsvexPreprocess],
	compilerOptions: {
		runes: true,
	},
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '404.html',
			precompress: true,
			strict: false,
		}),
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
