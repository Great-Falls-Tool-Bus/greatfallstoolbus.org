// Ambient module shape for mdsvex-compiled .svx content (see svelte.config.js).
// `metadata` is the parsed YAML frontmatter; the default export is the
// rendered body as a Svelte component (used by future per-tool pages).
declare module '*.svx' {
	import type { Component } from 'svelte';

	export const metadata: Record<string, unknown>;
	const component: Component;
	export default component;
}
