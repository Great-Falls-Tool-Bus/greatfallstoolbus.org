<script lang="ts">
	// Every entry verified live or via scholarly index on 2026-07-02. Where a
	// primary URL could not be verified, the entry says so — no guessed links.
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import { BookOpen } from '@lucide/svelte';

	type Entry = { title: string; meta: string; note: string; href: string };
	type Section = { heading: string; entries: Entry[] };

	const sections: Section[] = [
		{
			heading: 'Hackerspace & makerspace practice',
			entries: [
				{
					title: 'Hackerspace Design Patterns',
					meta: 'C4 Cologne · CCCamp 2007 / 24C3',
					note: 'The founding operational playbook of the hackerspace movement — the Plenum, Physics, and financial-reserve patterns map directly onto tool-bus governance.',
					href: 'https://wiki.hackerspaces.org/Design_Patterns',
				},
				{
					title: 'Hackerspace Design Patterns 2.0',
					meta: 'Mitch Altman · CCCamp 2015',
					note: 'Adds the Mentor and Caretaker patterns — a named zone caretaker with public contact info per shop area translates directly to a bus with distinct tool cells.',
					href: 'https://www.noisebridge.net/wiki/Hackerspace_Design_Patterns_2.0',
				},
				{
					title: 'Making Makerspaces: Creating a Business Model',
					meta: 'Gui Cavalcanti (Artisan’s Asylum) · Make:, 2013',
					note: 'The canonical expense/income taxonomy for creative manufacturing spaces, adapted here for a rolling one.',
					href: 'https://makezine.com/article/education/making-makerspaces-creating-a-business-model/',
				},
				{
					title: 'How to Make a Makerspace (workshop series)',
					meta: 'Cavalcanti + MAKE / Artisan’s Asylum · 2013–2014',
					note: 'Full-day curriculum distilled from growing Artisan’s Asylum to 40,000 sq ft in four stages.',
					href: 'https://makezine.com/2014/05/08/learn-how-to-make-a-makerspace-with-gui-cavalcanti/',
				},
				{
					title: 'Nation of Makers Resource Library',
					meta: 'Nation of Makers · ongoing',
					note: 'Crowdsourced best-practice repository across 2,000+ US maker organizations — bylaws, waivers, budgets, peers.',
					href: 'https://www.nationofmakers.us/resource-library',
				},
				{
					title: 'Makerspace Playbook (School Edition)',
					meta: 'Maker Education Initiative / MAKE · 2013',
					note: 'The standard getting-started manual: space setup, safety, tools, community programs. Free and open.',
					href: 'https://makered.gitbook.io/makerspace-playbook',
				},
				{
					title: 'Getting Started with Fab Labs',
					meta: 'Fab Foundation · ongoing',
					note: 'The Fab Lab network’s official startup guidance, including its mobile fab lab program.',
					href: 'https://fabfoundation.org/getting-started/',
				},
			],
		},
		{
			heading: 'Tool-lending libraries',
			entries: [
				{
					title: 'Tool Lending Library: a Brief History',
					meta: 'Berkeley Public Library · current',
					note: 'Founded 1979 with $30k of federal CDBG money in a portable trailer with ~500 tools — the reference policy set for public tool lending (3/7-day loans, no gas or powder-actuated tools).',
					href: 'https://www.berkeleypubliclibrary.org/locations/tool-lending-library/tool-lending-library-brief-history',
				},
				{
					title: 'What’s Mine Is Yours: The History of U.S. Tool-Lending Libraries',
					meta: 'Samantha Hamilton · SJSU iSchool Student Research Journal 11(1), 2021',
					note: 'Peer-reviewed history dating the first US tool library to 1940s Grosse Pointe, MI — the scholarly anchor for any origin-story claims.',
					href: 'https://scholarworks.sjsu.edu/ischoolsrj/vol11/iss1/4/',
				},
				{
					title: 'Station North Tool Library — membership model',
					meta: 'SNTL Baltimore · current',
					note: 'Sliding-scale $1 per $1,000 of annual income, never turn away for inability to pay, mandatory shop-safety orientation: the strongest equity-first vetting and pricing template we found.',
					href: 'https://toollibrary.org/membership',
				},
				{
					title: 'Starting a Tool Library: Insights from Station North',
					meta: 'New Dream · ~2016',
					note: 'Founder-level lessons on launch sequencing, volunteer staffing, and community buy-in.',
					href: 'https://newdream.org/blog/starting-a-tool-library-inspiration-and-insights-from-station-north',
				},
				{
					title: 'West Seattle Tool Library',
					meta: 'Sustainable West Seattle · founded 2010',
					note: '3,000+ tools for 4,000+ residents, with a published replication starter kit (sample agreements, delinquency letters) worth lifting wholesale.',
					href: 'https://www.wstools.org/',
				},
				{
					title: 'Phinney Neighborhood Association Tool Lending Library',
					meta: 'PNA Seattle · claims 1977 founding',
					note: 'Sliding-scale membership on the myTurn platform. (Its “oldest in the country” claim conflicts with Hamilton 2021 — see above.)',
					href: 'https://www.phinneycenter.org/diy-hub/tool-library/',
				},
				{
					title: 'myTurn / localtools.org',
					meta: 'myTurn Inc. · ongoing',
					note: 'The dominant lending-library management platform: inventory, membership, reservations, barcode check-in/out.',
					href: 'https://myturn.com/lending-libraries/',
				},
				{
					title: 'How to Start a Tool Lending Library',
					meta: 'David Lang · Make:, 2012',
					note: 'The standard first-read for tool-library founders: insurance, inventory software, starter-kit templates.',
					href: 'https://makezine.com/article/home/how-to-start-a-tool-lending-library/',
				},
				{
					title: 'How to Start a Lending Library, Part 1: Insurance and Operations',
					meta: 'Local Tools / myTurn · 2012',
					note: 'The ops-launch reference: general liability for tool libraries ran ~$600–700/yr, reuse peers’ published member agreements, run real lending software from day one.',
					href: 'https://localtools.org/2012/06/10/how-to-start-a-lending-library-part-1-insurance-and-operations/',
				},
			],
		},
		{
			heading: 'Scholarship',
			entries: [
				{
					title: 'Learning in the Making: A Comparative Case Study of Three Makerspaces',
					meta: 'Sheridan et al. · Harvard Educational Review 84(4), 2014',
					note: 'The most-cited empirical comparison of makerspace organizational models — grounds our choice of participation structure.',
					href: 'https://doi.org/10.17763/haer.84.4.brr34733723j648u',
				},
				{
					title: 'Hackerspace Tropes, Identities, and Community Values',
					meta: 'Austin L. Toombs · ACM DIS 2017',
					note: 'Ethnography of how member identities and care work sustain — or fracture — hackerspace communities.',
					href: 'https://doi.org/10.1145/3064663.3064760',
				},
				{
					title: 'Emerging Hackerspaces — Peer-Production Generation',
					meta: 'Jarkko Moilanen · IFIP AICT, 2012',
					note: 'Longitudinal survey data on hackerspace membership, motivations, and organizational forms.',
					href: 'https://doi.org/10.1007/978-3-642-33442-9_7',
				},
				{
					title: 'The role of tool libraries in the new economy',
					meta: 'Chakori & Hopkinson · Edward Elgar, 2021',
					note: 'The most direct academic treatment of tool libraries as institutions.',
					href: 'https://doi.org/10.4337/9781789909562.00026',
				},
				{
					title: 'Libraries of Things as a new form of sharing',
					meta: 'Najine Ameli · The Design Journal 20(sup1), 2017',
					note: 'Analyzes libraries-of-things as product-service systems: the quality-vs-price contradiction and the maintenance burden.',
					href: 'https://doi.org/10.1080/14606925.2017.1352833',
				},
				{
					title: 'Libraries of things: at the intersection of sharing and social economies',
					meta: 'Silva & Mont · Edward Elgar, 2025',
					note: 'Current scholarship positioning LoTs between sharing-economy and social-economy logics.',
					href: 'https://doi.org/10.4337/9781035320547.00013',
				},
				{
					title: 'Assessing sharing of household goods: tool and toy sharing in Melbourne and Toronto',
					meta: 'Oksana Mont · Edward Elgar, 2025',
					note: 'Cross-national evidence on what usage patterns a sharing organization should expect.',
					href: 'https://doi.org/10.4337/9781035320547.00017',
				},
				{
					title: 'Collaborative Governance in Practice for fostering Makerspaces',
					meta: 'Lange & Harding · De Gruyter, 2020',
					note: 'Governance-studies chapter on multi-stakeholder makerspace stewardship.',
					href: 'https://doi.org/10.1515/9783110665994-015',
				},
				{
					title: 'How Do You Measure Community In A Makerspace?',
					meta: 'Osserman, Avecilla & Thomas · IJAMM, 2025',
					note: 'A recent metrics framework for makerspace community health — a candidate KPI set.',
					href: 'https://doi.org/10.21428/70cb44c5.0b5897f8',
				},
				{
					title: '3D printing in library makerspace: health and safety concern',
					meta: 'Bharti, Singh & Singh · ACS, 2020',
					note: 'Representative of the (thin) formal literature on community-workshop safety; most safety guidance remains practitioner-grade.',
					href: 'https://doi.org/10.1021/scimeetings.0c05671',
				},
			],
		},
		{
			heading: 'Mobile precedents',
			entries: [
				{
					title: 'SparkTruck',
					meta: 'Stanford d.school · 2012 (adopted by SMU 2017)',
					note: 'The flagship educational build-mobile: 15,323 miles, 33 states, 65 schools in two summers — the closest precedent for a tool bus. (The original sparktruck.org domain is now squatted; cite the d.school.)',
					href: 'https://dschool.stanford.edu/news-events/dschool-sparktruck-story',
				},
				{
					title: 'MIT Mobile Fab Lab',
					meta: 'Center for Bits and Atoms · 2007',
					note: 'A 32-ft trailer with a full digital-fab suite and a published operating envelope (~60×16 ft site, 240 V 40 A service) — the hardest engineering numbers available for bus fit-out planning.',
					href: 'https://en.wikipedia.org/wiki/Mobile_fab_lab',
				},
				{
					title: 'ALA Bookmobile guides',
					meta: 'American Library Association · ongoing (US bookmobiles since 1905)',
					note: 'A century of mobile-service-model literature — routes, stops, deposit collections, partner agencies — that tool-bus circulation should be derived from.',
					href: 'https://libguides.ala.org/bookmobiles',
				},
			],
		},
		{
			heading: 'Operations: kitting, waivers, shrinkage',
			entries: [
				{
					title: 'Mastering Tool Control & FOD Prevention',
					meta: 'Shadow Foam · aviation practice',
					note: 'Aviation tool-control doctrine — “slot empty = missing tool” — plus cheap kaizen-foam drawer inserts: the proven bits-and-bobs kitting pattern for kits on a moving vehicle.',
					href: 'https://shadowfoam.com/blogs/article/mastering-tool-control-fod-prevention-in-the-aerospace-aviation-industries',
				},
				{
					title: 'Securing Waivers of Liability from Volunteers of Nonprofit Organizations',
					meta: 'D.C. Bar Pro Bono Center · 2017 update',
					note: 'Free legal-grade guidance on drafting enforceable volunteer waivers, paired with insurance.',
					href: 'https://www.lawhelp.org/dc/resource/legal-alert-securing-waivers-of-liability-fro/download/B2D45E53-D266-7BAB-6ECA-914B78E09076.pdf',
				},
				{
					title: 'Asset-tracking loss statistics',
					meta: 'MapTrack · 2026',
					note: 'Trades lose 5–10% of portable tool inventory annually — no community-tool-library loss study exists yet, so this is our honest shrinkage-planning proxy.',
					href: 'https://www.maptrack.com/statistics',
				},
			],
		},
	];
</script>

<svelte:head>
	<title>Bibliography | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="The research the tool bus stands on: hackerspace design patterns, tool-lending library history and policy, makerspace scholarship, mobile precedents, and kitting practice."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Bibliography"
		lead="The tool bus is not a guess — it stands on forty years of tool-library practice, the hackerspace design-pattern tradition, and a growing body of scholarship on shared workshops. Every link below was verified on 2026-07-02."
		icon={BookOpen}
	/>

	{#each sections as section (section.heading)}
		<section class="mt-12" aria-label={section.heading}>
			<h2 class="text-2xl font-semibold">{section.heading}</h2>
			<div class="mt-6 space-y-3">
				{#each section.entries as e (e.title)}
					<Card titleHref={e.href} external title={e.title} meta={e.meta} body={e.note} headingLevel="none" compact />
				{/each}
			</div>
		</section>
	{/each}

	<footer class="text-surface-500 pt-12 text-sm">
		A note we enjoy: the hackerspaces.org wiki is itself guarded by Techaro Anubis — the same bot-guard this project
		deploys on its contact form.
	</footer>
</main>
