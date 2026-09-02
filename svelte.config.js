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
			// DATA-DEPENDENT PRERENDER ENTRIES (TIN-3898).
			//
			// `/discuss/[thread]` enumerates its pages from the LIVE HyperKitty
			// archive: src/routes/discuss/[thread]/+page.server.ts `entries()`
			// reads the same snapshot the index renders, and `fetchDiscussSnapshot`
			// fails soft to an empty snapshot rather than throwing. So any build
			// that cannot reach the archive — local dev, fork CI, an in-cluster
			// runner with no namespace configured — legitimately yields zero
			// entries, the route is never crawled, and that file's stated contract
			// is "the build MUST NOT fail off-cluster".
			//
			// SvelteKit >= 2.16 defaults `handleUnseenRoutes` to 'fail', which
			// breaks that contract. Tolerate exactly this one route and keep the
			// build-breaking default for every other unseen prerenderable route,
			// so a genuinely orphaned/unlinked page still fails the gate here.
			//
			// The adapter-node server reads this route per request. A build with no
			// archive access therefore emits no static thread pages and still keeps
			// every other unseen prerenderable route fail-closed.
			handleUnseenRoutes: ({ routes, message }) => {
				const unexpected = routes.filter((id) => id !== '/discuss/[thread]');
				if (unexpected.length > 0) {
					throw new Error(message);
				}
				console.warn(
					'[prerender] /discuss/[thread] produced no entries — the discuss archive was ' +
						'unreachable at build time, so no thread pages were baked. Expected off-cluster; ' +
						'set DISCUSS_ARCHIVE_NAMESPACE or DISCUSS_ARCHIVE_ORIGIN to prerender them.',
				);
			},
		},
	},
};

export default config;
