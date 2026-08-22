<script lang="ts">
	// Single-product history (L72 Q3-A, 2026-08-21): this page replaces the
	// former marketing body (mission/tools/cells/wants/donate/contact copy and
	// the trust-strip data pull from $lib/data/cells, all deleted). Public
	// information-surface duty moves to `gftb-site` (ADR 0014 §1);
	// `greatfallstoolbus.org` is now the member-tree entry point.
	//
	// MECHANICS ONLY, agent-drafted placeholder copy — same posture as
	// src/routes/apply/+page.svelte: skeletal until the operator writes it.
	import { base } from '$app/paths';

	const SITE_NAME = 'Great Falls Tool Bus';
</script>

<main class="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center gap-6 px-6 py-16 text-center">
	<h1 class="text-3xl font-semibold">{SITE_NAME}</h1>
	<p class="text-surface-700-300 text-lg">Member area.</p>
	<p class="text-surface-600-400">
		<a class="underline hover:no-underline" href={`${base}/apply`}>Apply for membership</a>
		— application intake is not yet open for the public launch window.
	</p>
</main>
