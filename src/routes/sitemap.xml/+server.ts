// M3.3 sitemap.xml endpoint. Prerendered into the adapter-node build. Add
// additional routes here as M5 lands them.
//
// Single-product history (L72 Q3-A): the 15 legacy marketing-tree route
// families (mission, tools, cells, cell-sheets, wants, donate, safety,
// bibliography, shout-outs, keyholders, stewards, contact, discuss, agent,
// plus the old marketing `/`) are deleted from this list. `greatfallstoolbus.org`
// becomes the member-tree entry surface (ADR 0014 §1); public information-surface
// duty moves to `gftb-site`. `/apply` stays out of the sitemap: it is
// `noindex` while intake is closed (src/routes/apply/+page.svelte).
import type { RequestHandler } from './$types';

const SITE = 'https://greatfallstoolbus.org';
const PAGES: string[] = ['/'];

export const prerender = true;

export const GET: RequestHandler = () => {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}
</urlset>
`;
	return new Response(xml, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
		},
	});
};
