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

// On-cluster readiness (TIN-2541). The build default is unchanged: adapter-static
// -> Cloudflare Pages, DB-less, no edge auth. Setting ADAPTER=node selects
// @sveltejs/adapter-node so the same source can be served in-cluster as
// `node build/index.js` (see ContainerFile). adapter-node is the decided
// production serving mode (ADR 0010, Accepted 2026-07-05; Amendment 1,
// 2026-07-06): Cloudflare Pages, including this build default, is the
// deprecated interim lane, spinning down per ADR 0010 §3. adapter-static stays
// the default `just build` output only for that interim lane and as a
// local/CI fallback.
//
// adapter-node is now a committed devDependency (TIN-2543, MassageIthaca parity
// @sveltejs/adapter-node ^5.5.7): package.json and pnpm-lock.yaml carry it, and
// the Bazel npm graph resolves it from the lock via npm_translate_lock. It is
// still imported lazily and only under ADAPTER=node, so the frozen-lockfile
// static build (the default) never loads it and every default gate stays green;
// see docs/deploy/oncluster-container-readiness.md.
const useNodeAdapter = process.env.ADAPTER === 'node';

let adapter;
if (useNodeAdapter) {
	const { default: adapterNode } = await import('@sveltejs/adapter-node');
	adapter = adapterNode({
		// Explicit for parity with the adapter-static branch below and as a
		// defensive pin: @sveltejs/adapter-node@5.5.7 already defaults
		// `precompress: true` (gzip + brotli, built at compile time, over both
		// `build/client` and `build/prerendered`), so this is a no-op today —
		// but writing it out keeps the origin's compression posture from
		// silently drifting if that upstream default ever changes.
		precompress: true,
	});
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
			// Nothing is lost when the list is unreachable: the static build is a
			// local/CI gate only (ADR 0010 — Cloudflare Pages is the spinning-down
			// interim lane), and the production ADAPTER=node image turns prerender
			// off for this route entirely and reads it per request.
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
