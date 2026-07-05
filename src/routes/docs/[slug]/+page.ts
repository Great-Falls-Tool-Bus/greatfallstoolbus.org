import { error } from '@sveltejs/kit';
import { docSlugs, getDoc } from '$lib/docs/registry';
import type { EntryGenerator, PageLoad } from './$types';

// Static site: prerender one page per registered operator doc. `entries` makes
// adapter-static enumerate the slugs at build so the dynamic route is fully
// prerendered even without link-crawling.
export const prerender = true;

export const entries: EntryGenerator = () => docSlugs().map((slug) => ({ slug }));

export const load: PageLoad = ({ params }) => {
	const doc = getDoc(params.slug);
	if (!doc) {
		throw error(404, `Unknown operator doc: ${params.slug}`);
	}
	return { doc };
};
