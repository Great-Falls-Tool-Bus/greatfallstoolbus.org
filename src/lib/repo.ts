// Single source of truth for this repo's GitHub identity on the client.
//
// The value mirrors `repo.github` in tinyland.repo.json
// ("Great-Falls-Tool-Bus/greatfallstoolbus.org"); the same slug is already
// hand-inlined in +layout.svelte and agent/+page.server.ts. Centralizing it
// here gives the DetailsNeeded "Edit this page" affordance one place to resolve
// a source-edit URL from.
//
// CONVERGENCE (#60): the view/edit page-source subsystem (PR wave25/view-source)
// introduces a derived source map + repo-URL resolver. When that lands, this
// module should defer to it (import its resolver / source-map.json) rather than
// keep the constant below, so there is exactly one repo-URL resolution path.
// Until then this constant IS that path, resolved the same way #60 will (from
// the tinyland.repo.json `repo.github` slug).
export const REPO_SLUG = 'Great-Falls-Tool-Bus/greatfallstoolbus.org';

export const REPO_URL = `https://github.com/${REPO_SLUG}`;

/** Default branch the site is built and edited from. */
export const REPO_DEFAULT_BRANCH = 'main';

/**
 * GitHub web edit URL for a repo-relative source path, e.g.
 * `editUrl('src/content/tools/welding/multiprocess-welder.svx')`. Opens the
 * in-browser editor on the default branch so a contributor can fill in a gap
 * and open a PR without a local checkout.
 */
export function editUrl(sourcePath: string): string {
	const clean = sourcePath.replace(/^\//, '');
	return `${REPO_URL}/edit/${REPO_DEFAULT_BRANCH}/${clean}`;
}
