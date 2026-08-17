<script lang="ts">
	import { base } from '$app/paths';
	import { Network } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	// Network + port diagrams for the operator-docs surface.
	//
	// GROUNDED, NOT INVENTED. Every fact below is drawn from documented truth:
	//   - node roles honey / bumble / sting and their placement posture:
	//     docs/decisions/0008-oncluster-production-hosting.md (this repo);
	//   - the on-cluster adapter-node web path behind the in-cluster cloudflared
	//     tunnel, production since the ADR 0010 cutover (Cloudflare Pages
	//     retired): docs/deploy/cloudflare-pages.md,
	//     docs/deploy/oncluster-container-readiness.md, ADR 0003;
	//   - the mail flow, transport split, and port map: the org apply-plane
	//     architecture record (great-falls-tool-bus-infra
	//     docs/architecture/diagrams.md) and docs/runbooks/dns-mail-checklist.md.
	//
	// PUBLIC-REPO-SAFE by construction: this page names ROLES and STANDARD /
	// APPLICATION ports only. It deliberately omits every private endpoint that
	// lives in the infra sources: on-prem node IPs, cluster-internal service DNS
	// names, and RBE grpc endpoints are NOT reproduced here. Those gaps are
	// intentional and called out in the "What is deliberately omitted" note.

	// Mail-stack port map (public-safe: standard mail ports + internal app ports;
	// no host is an on-prem IP or a cluster-internal DNS name).
	const portRows = [
		{ port: '25', proto: 'SMTP', where: 'Inbound MX', note: 'External mail reaches the substrate postfix.' },
		{ port: '587', proto: 'Submission', where: 'Outbound', note: 'STARTTLS + SASL, sent as lists-bounces@latoolb.us.' },
		{ port: '465', proto: 'SMTPS', where: 'Substrate', note: 'Implicit-TLS submission, substrate postfix.' },
		{ port: '993', proto: 'IMAPS', where: 'dovecot', note: 'tinyland.dev mailboxes (substrate).' },
		{ port: '8024', proto: 'LMTP', where: 'mailman-core', note: 'List-family delivery from postfix.' },
		{ port: '8001', proto: 'REST', where: 'mailman-core', note: 'Postorius / HyperKitty talk to the engine.' },
		{ port: '8000', proto: 'HTTP', where: 'mailman-web', note: 'Postorius admin + HyperKitty archive.' },
		{ port: '8080', proto: 'HTTP', where: 'mailman-web', note: 'Archive POST from the list engine.' },
		{ port: '5432', proto: 'PostgreSQL', where: 'mailman-postgres', note: 'List + archive state.' },
		{
			port: '3000',
			proto: 'HTTP',
			where: 'web (adapter-node)',
			note: 'Target on-cluster web server (node build/index.js); /health probes.',
		},
		{
			port: '80',
			proto: 'HTTP',
			where: 'web Service',
			note: 'ClusterIP, internal only; fronts :3000 on the target serving path.',
		},
		{ port: '8081', proto: 'HTTP', where: 'anubis-archive', note: 'Bot-wall in front of the public archive.' },
	];
</script>

<svelte:head>
	<title>Network and port diagrams | Operator docs | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Public-safe diagrams of the Great Falls Tool Bus serving topology (the on-cluster adapter-node deployment behind the Cloudflare tunnel, production since the ADR 0010 cutover; Cloudflare Pages retired), the cluster node roles (honey, bumble, sting), and the mail-stack flow and port map, grounded in documented infrastructure truth."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Network and port diagrams"
		icon={Network}
		lead="How the bus site reaches the world and how its mail moves, drawn from the documented infrastructure truth. These diagrams name roles and standard ports only; no private endpoints are reproduced here."
	/>

	<section class="border-surface-200-800 mt-8 border-y py-6" aria-label="Grounding">
		<p class="text-surface-700 dark:text-surface-300 text-sm leading-relaxed">
			Grounded in <a class="underline" href={`${base}/docs/dns-mail-checklist`}>the DNS and mail cutover checklist</a>,
			<a class="underline" href={`${base}/docs/oncluster-container-readiness`}>on-cluster container readiness</a>, and
			the org apply-plane architecture record. On-cluster serving (adapter-node image into a K8s Deployment behind a
			ClusterIP Service and the in-cluster cloudflared tunnel) is production per ADR 0008; the ADR 0010 cutover is
			complete and Cloudflare Pages has been retired (project deleted). The diagram below marks the live production path
			in the accent colour and solid.
		</p>
	</section>

	<!-- ===== Diagram 1: serving topology (target vs current) ===== -->
	<section class="mt-12" aria-label="Serving topology">
		<h2 class="text-2xl font-semibold">Serving topology</h2>
		<p class="text-surface-700-300 mt-2 leading-relaxed">
			A visitor always reaches the Cloudflare edge first, where TLS terminates and the apex and www sit behind
			Cloudflare Access during the gated phase. From the edge the diagram shows the production origin. The accent, solid
			path is production per ADR 0008: an adapter-node image in a K8s Deployment, behind a ClusterIP Service and the
			in-cluster cloudflared tunnel on the honey ingress. Cloudflare Pages is drawn muted and marked retired: the ADR
			0010 cutover is complete and the Pages project has been deleted, so nobody should read it as still serving
			traffic.
		</p>

		<figure class="border-surface-200-800 mt-6 border p-4">
			<div class="overflow-x-auto">
				<svg class="diagram" viewBox="0 0 760 752" width="760" role="img" aria-labelledby="topo-title topo-desc">
					<title id="topo-title">Serving topology: on-cluster production, Cloudflare Pages retired</title>
					<desc id="topo-desc"
						>A visitor reaches the Cloudflare edge, where TLS terminates and the apex and www are gated by Cloudflare
						Access. The edge routes to the production origin. Production per ADR 0008, drawn in accent and solid, is
						on-cluster serving: an adapter-node web Deployment on port 3000 with two replicas, behind an internal
						ClusterIP web Service on port 80 and the in-cluster cloudflared tunnel on the honey ingress. Cloudflare
						Pages, drawn muted, is retired since the ADR 0010 cutover; the project has been deleted. The on-prem cluster
						has three nodes with zero public IP: honey (mail substrate, Mailman list stack, form and archive guard,
						tightest headroom), bumble (worker, web replica target), and sting (worker, web replica target, CI runners).
						The two web replicas are scheduled onto bumble and sting under anti-affinity, leaving honey for its mail and
						form load.</desc
					>
					<defs>
						<marker
							id="arrow"
							viewBox="0 0 10 10"
							refX="9"
							refY="5"
							markerWidth="7"
							markerHeight="7"
							orient="auto-start-reverse"
						>
							<path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
						</marker>
					</defs>

					<!-- Visitor -->
					<rect class="node" x="300" y="12" width="160" height="44" />
					<text class="lbl strong" x="380" y="32">Visitor / browser</text>
					<text class="lbl muted" x="380" y="47">or external client</text>
					<line class="flow" x1="380" y1="56" x2="380" y2="82" marker-end="url(#arrow)" />

					<!-- Cloudflare edge -->
					<rect class="node accent" x="110" y="84" width="540" height="78" />
					<text class="lbl strong" x="380" y="110">Cloudflare edge</text>
					<text class="lbl muted" x="380" y="128">TLS terminates here</text>
					<text class="lbl muted" x="380" y="146">apex + www gated by Cloudflare Access</text>

					<!-- Branch to on-cluster origin (accent, production) and to retired Pages -->
					<line class="flow" x1="204" y1="162" x2="204" y2="194" marker-end="url(#arrow)" />
					<line class="flow" x1="573" y1="162" x2="573" y2="194" marker-end="url(#arrow)" />

					<!-- On-cluster origin (production, accent + solid) -->
					<rect class="node accent" x="44" y="196" width="320" height="96" />
					<text class="lbl strong" x="204" y="220">On-cluster serving</text>
					<text class="lbl muted" x="204" y="238">PRODUCTION, ADR 0008</text>
					<text class="lbl muted" x="204" y="256">adapter-node to image to K8s to tunnel</text>
					<text class="lbl muted" x="204" y="278">live since the ADR 0010 cutover</text>

					<!-- Cloudflare Pages (retired, ADR 0010: dashed + muted) -->
					<rect class="node sub" x="430" y="196" width="286" height="96" />
					<text class="lbl strong" x="573" y="220">Cloudflare Pages</text>
					<text class="lbl muted" x="573" y="238">static build (adapter-static)</text>
					<text class="lbl muted" x="573" y="256">RETIRED, ADR 0010</text>
					<text class="lbl muted" x="573" y="278">project deleted</text>

					<!-- On-cluster origin down into the cluster -->
					<line class="flow" x1="200" y1="292" x2="168" y2="362" marker-end="url(#arrow)" />

					<!-- honey cluster container -->
					<rect class="node" x="44" y="324" width="672" height="404" />
					<text class="lbl strong" x="380" y="348">honey cluster (on-prem, zero public IP)</text>

					<!-- Serving chain: tunnel to Service to Deployment (accent = target path) -->
					<rect class="node accent" x="64" y="366" width="196" height="62" />
					<text class="lbl strong" x="162" y="390">in-cluster cloudflared</text>
					<text class="lbl muted" x="162" y="408">tunnel, honey ingress</text>
					<line class="flow" x1="260" y1="397" x2="288" y2="397" marker-end="url(#arrow)" />

					<rect class="node accent" x="290" y="366" width="176" height="62" />
					<text class="lbl strong" x="378" y="388">web Service</text>
					<text class="lbl muted" x="378" y="405">ClusterIP, port 80</text>
					<text class="lbl muted" x="378" y="421">internal only, to :3000</text>
					<line class="flow" x1="466" y1="397" x2="494" y2="397" marker-end="url(#arrow)" />

					<rect class="node accent" x="496" y="366" width="200" height="62" />
					<text class="lbl strong" x="596" y="388">web Deployment</text>
					<text class="lbl muted" x="596" y="405">adapter-node, :3000</text>
					<text class="lbl muted" x="596" y="421">replicas 2</text>

					<!-- scheduled onto bumble + sting (dashed, anti-affinity; see desc + caption) -->
					<text class="lbl muted" x="230" y="452">scheduled onto (anti-affinity)</text>
					<line class="flow dashed" x1="596" y1="430" x2="596" y2="464" marker-end="url(#arrow)" />
					<line class="flow dashed" x1="540" y1="430" x2="392" y2="464" marker-end="url(#arrow)" />

					<!-- honey node -->
					<rect class="node" x="64" y="468" width="196" height="234" />
					<text class="lbl strong" x="162" y="494">honey</text>
					<text class="lbl muted" x="162" y="518">mail substrate</text>
					<text class="lbl muted" x="162" y="538">list stack (Mailman)</text>
					<text class="lbl muted" x="162" y="558">form + archive guard</text>
					<text class="lbl muted" x="162" y="582">tightest headroom</text>

					<!-- bumble node -->
					<rect class="node" x="290" y="468" width="176" height="234" />
					<text class="lbl strong" x="378" y="494">bumble</text>
					<text class="lbl muted" x="378" y="518">worker node</text>
					<text class="lbl muted" x="378" y="538">web replica target</text>
					<text class="lbl muted" x="378" y="558">roomy headroom</text>

					<!-- sting node -->
					<rect class="node" x="496" y="468" width="200" height="234" />
					<text class="lbl strong" x="596" y="494">sting</text>
					<text class="lbl muted" x="596" y="518">worker node</text>
					<text class="lbl muted" x="596" y="538">web replica target</text>
					<text class="lbl muted" x="596" y="558">CI runners (nix)</text>
					<text class="lbl muted" x="596" y="582">roomiest headroom</text>
				</svg>
			</div>
			<ul class="text-surface-500 mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
				<li><span class="text-primary-500 font-semibold">Accent</span> = on-cluster production path (ADR 0008)</li>
				<li><span class="font-semibold">Dashed / muted</span> = Cloudflare Pages, retired (ADR 0010)</li>
			</ul>
			<figcaption class="text-surface-500 mt-3 text-xs">
				The accent path (in-cluster cloudflared tunnel to a ClusterIP web Service to an adapter-node web Deployment) is
				production per ADR 0008, which supersedes ADR 0003 for production hosting. The ADR 0010 cutover is complete, so
				Cloudflare Pages (dashed, muted) is retired and its project has been deleted. Gated-dynamic web I/O (the contact
				form) and the static web serving path both serve on-cluster through the same tunnel today. The apply plane is
				the org overlay great-falls-tool-bus-infra; this public repo holds intent only.
			</figcaption>
		</figure>
	</section>

	<!-- ===== Diagram 2: mail flow ===== -->
	<section class="mt-14" aria-label="Mail flow">
		<h2 class="text-2xl font-semibold">Mail flow, end to end</h2>
		<p class="text-surface-700-300 mt-2 leading-relaxed">
			Inbound mail for <span class="font-mono">latoolb.us</span> enters through the house MX
			<span class="font-mono">relay.tinyland.dev</span>, reaches the substrate postfix on honey, and is split by
			recipient: <span class="font-mono">tinyland.dev</span> mailboxes land in dovecot, while the
			<span class="font-mono">keyholders@</span> and <span class="font-mono">discuss@</span> list families are delivered by
			LMTP to the Mailman engine. Mailman moderates and fans out, submits outbound over 587, and the substrate rspamd milter
			adds the DKIM signature before the message leaves.
		</p>

		<figure class="border-surface-200-800 mt-6 border p-4">
			<div class="overflow-x-auto">
				<svg class="diagram" viewBox="0 0 620 720" width="620" role="img" aria-labelledby="mail-title mail-desc">
					<title id="mail-title">Mail flow, end to end</title>
					<desc id="mail-desc"
						>External sender resolves DNS (MX relay.tinyland.dev, SPF, DKIM selector mail, DMARC p=none), delivers to MX
						relay.tinyland.dev, then substrate postfix on honey. The transport map splits by recipient: tinyland.dev
						mailboxes to dovecot on IMAPS 993; latoolb.us list families over LMTP 8024 to mailman-core, which moderates
						and fans out, submits outbound on 587 with STARTTLS and SASL, and the rspamd DKIM milter signs before the
						mail reaches the world.</desc
					>
					<defs>
						<marker
							id="arrow2"
							viewBox="0 0 10 10"
							refX="9"
							refY="5"
							markerWidth="7"
							markerHeight="7"
							orient="auto-start-reverse"
						>
							<path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
						</marker>
					</defs>

					<rect class="node" x="200" y="10" width="220" height="42" />
					<text class="lbl strong" x="310" y="35">External sender</text>
					<line class="flow" x1="310" y1="52" x2="310" y2="78" marker-end="url(#arrow2)" />

					<rect class="node accent" x="120" y="78" width="380" height="70" />
					<text class="lbl strong" x="310" y="102">DNS edge for latoolb.us</text>
					<text class="lbl muted" x="310" y="120">MX 10 relay.tinyland.dev, SPF authorizes relay + honey egress</text>
					<text class="lbl muted" x="310" y="138">DKIM selector mail, DMARC p=none</text>
					<line class="flow" x1="310" y1="148" x2="310" y2="174" marker-end="url(#arrow2)" />

					<rect class="node" x="200" y="174" width="220" height="42" />
					<text class="lbl strong" x="310" y="199">MX relay.tinyland.dev</text>
					<line class="flow" x1="310" y1="216" x2="310" y2="242" marker-end="url(#arrow2)" />

					<rect class="node sub" x="160" y="242" width="300" height="66" />
					<text class="lbl strong" x="310" y="266">postfix on honey (substrate)</text>
					<text class="lbl muted" x="310" y="284">host-networked, ports 25 / 587 / 465</text>
					<text class="lbl muted" x="310" y="300">owned by the swappable blahaj substrate</text>
					<line class="flow" x1="310" y1="308" x2="310" y2="334" marker-end="url(#arrow2)" />

					<rect class="node" x="220" y="334" width="180" height="46" />
					<text class="lbl strong" x="310" y="356">transport split</text>
					<text class="lbl muted" x="310" y="372">by recipient</text>

					<!-- left branch: dovecot -->
					<line class="flow" x1="245" y1="380" x2="150" y2="418" marker-end="url(#arrow2)" />
					<rect class="node sub" x="20" y="418" width="240" height="62" />
					<text class="lbl strong" x="140" y="442">dovecot (substrate)</text>
					<text class="lbl muted" x="140" y="460">tinyland.dev mailboxes</text>
					<text class="lbl muted" x="140" y="475">IMAPS 993</text>

					<!-- right branch: LMTP to mailman -->
					<line class="flow" x1="375" y1="380" x2="470" y2="418" marker-end="url(#arrow2)" />
					<rect class="node accent" x="360" y="418" width="240" height="62" />
					<text class="lbl strong" x="480" y="442">mailman-core</text>
					<text class="lbl muted" x="480" y="460">LMTP 8024, keyholders@ / discuss@</text>
					<text class="lbl muted" x="480" y="475">moderation + fan-out</text>
					<line class="flow" x1="480" y1="480" x2="480" y2="512" marker-end="url(#arrow2)" />

					<rect class="node" x="330" y="512" width="300" height="60" />
					<text class="lbl strong" x="480" y="536">outbound submission 587</text>
					<text class="lbl muted" x="480" y="554">STARTTLS + SASL as lists-bounces@latoolb.us</text>
					<line class="flow" x1="480" y1="572" x2="480" y2="604" marker-end="url(#arrow2)" />

					<rect class="node sub" x="330" y="604" width="300" height="58" />
					<text class="lbl strong" x="480" y="628">rspamd DKIM milter (substrate)</text>
					<text class="lbl muted" x="480" y="646">signs d=latoolb.us, selector mail</text>
					<line class="flow" x1="480" y1="662" x2="480" y2="690" marker-end="url(#arrow2)" />

					<rect class="node" x="410" y="690" width="140" height="26" />
					<text class="lbl strong" x="480" y="708">World</text>
				</svg>
			</div>
			<figcaption class="text-surface-500 mt-3 text-xs">
				postfix, dovecot, and rspamd (with the DKIM key material) are owned by the swappable blahaj substrate and shown
				dashed. The list engine, its web front end, and its database are the org apply-plane workloads.
			</figcaption>
		</figure>
	</section>

	<!-- ===== Port map table ===== -->
	<section class="mt-14" aria-label="Mail and web port map">
		<h2 class="text-2xl font-semibold">Port map</h2>
		<p class="text-surface-700-300 mt-2 leading-relaxed">
			The standard mail ports and the internal application ports the list and web stacks use. Every host here is a role,
			not an address; the cluster-internal DNS names and node IPs are intentionally not reproduced.
		</p>
		<div class="mt-6 overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-surface-300-700 border-b text-left">
						<th class="py-2 pr-4 font-semibold">Port</th>
						<th class="py-2 pr-4 font-semibold">Protocol</th>
						<th class="py-2 pr-4 font-semibold">Role</th>
						<th class="py-2 font-semibold">What rides it</th>
					</tr>
				</thead>
				<tbody>
					{#each portRows as row (row.port + row.where)}
						<tr class="border-surface-200-800 border-b align-top">
							<td class="py-2 pr-4 font-mono font-semibold">{row.port}</td>
							<td class="py-2 pr-4">{row.proto}</td>
							<td class="text-surface-700-300 py-2 pr-4 font-mono">{row.where}</td>
							<td class="text-surface-700-300 py-2">{row.note}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- ===== Omissions / gaps ===== -->
	<section class="mt-14" aria-label="What is deliberately omitted">
		<h2 class="text-2xl font-semibold">What is deliberately omitted</h2>
		<div class="border-surface-200-800 bg-surface-50-950/75 mt-6 border p-5">
			<ul class="text-surface-700-300 space-y-2 text-sm leading-relaxed">
				<li>
					<span class="font-semibold">Node IPs and the on-prem subnet.</span> honey, bumble, and sting sit on a private on-prem
					network; those addresses live in the org overlay, never in this public repo.
				</li>
				<li>
					<span class="font-semibold">Cluster-internal service DNS names.</span> The in-cluster service hostnames and the
					RBE executor endpoint are private substrate facts and are shown here only by role.
				</li>
				<li>
					<span class="font-semibold">The live tunnel route.</span> The cloudflared public-hostname route is managed at the
					Cloudflare edge and is not committed to git. On-cluster serving is production (ADR 0008); the route flip and image
					pin are an org overlay apply, applied outside this repo.
				</li>
			</ul>
		</div>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		Back to <a class="underline" href={`${base}/docs`}>operator docs</a>.
	</footer>
</main>

<style>
	/* SVG diagram theming. All TEXT is currentColor so contrast is anchored to the
	   page foreground in both light and dark (AA by construction) and prints black
	   on white. Node fills are a faint theme wash (glass, featured, not opaque);
	   strokes are currentColor so boxes survive print. Zero corner radius, house
	   canon. No animation, so nothing to gate on reduced motion. */
	.diagram {
		max-width: 100%;
		height: auto;
		color: var(--color-surface-900-100);
	}
	.diagram .node {
		fill: color-mix(in oklch, var(--color-surface-500) 8%, transparent);
		stroke: currentColor;
		stroke-width: 1.4;
	}
	.diagram .accent {
		stroke: var(--color-primary-500);
		stroke-width: 1.8;
	}
	.diagram .sub {
		stroke-dasharray: 6 4;
	}
	.diagram .flow {
		stroke: currentColor;
		stroke-width: 1.4;
		fill: none;
	}
	.diagram .flow.dashed {
		stroke-dasharray: 6 4;
	}
	.diagram .lbl {
		fill: currentColor;
		font-family: var(--font-sans);
		font-size: 13px;
		text-anchor: middle;
	}
	.diagram .lbl.strong {
		font-weight: 600;
	}
	.diagram .lbl.muted {
		fill: var(--color-surface-600-400);
		font-size: 11.5px;
	}
</style>
