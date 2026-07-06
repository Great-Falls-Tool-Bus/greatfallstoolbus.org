<script lang="ts">
	// On-site archive thread index (TIN-2528). Renders the discuss snapshot as a
	// hairline-divided list of threads — the same row idiom the home page uses
	// (subject → meta line → excerpt, separated by top hairlines), never a card
	// grid. Each subject now links INTERNALLY to the on-site reader at
	// `/discuss/<threadId>` (the full conversation renders on-site, never dumping a
	// reader into unstyled HyperKitty); the external deep link lives on that reader
	// page. `DiscussThread.url` intentionally still holds the public HyperKitty URL
	// (the privacy gate asserts it is archive-anchored) — the internal href is
	// derived from `threadId` here so the data contract and its gate stay stable.
	// Snapshot-driven and tolerant by contract: 0 threads (calm empty state),
	// missing excerpt (line omitted), and long subjects (break-words, never
	// truncated).
	import { base } from '$app/paths';
	import {
		type DiscussSnapshot,
		sortByLastActiveDesc,
		relativeTime,
		formatTimestamp,
		threadMeta,
	} from '$lib/data/discuss-snapshot';

	let { snapshot }: { snapshot: DiscussSnapshot } = $props();

	const threads = $derived(sortByLastActiveDesc(snapshot.threads));
	const updatedRelative = $derived(relativeTime(snapshot.generatedAt));
	const updatedExact = $derived(formatTimestamp(snapshot.generatedAt));
</script>

<div class="mt-6">
	{#if updatedRelative}
		<p class="text-surface-500 text-sm">
			Archive index updated <time datetime={snapshot.generatedAt} title={updatedExact}>{updatedRelative}</time>.
		</p>
	{/if}

	{#if threads.length === 0}
		<!-- Calm empty state: no threads yet is a normal, healthy state, not an error. -->
		<p class="text-surface-600-400 border-surface-200-800 mt-4 border-t py-10 leading-relaxed">
			No conversations archived yet. Start one at <span class="font-semibold">{snapshot.list}</span>.
		</p>
	{:else}
		<ul class="mt-4">
			{#each threads as thread (thread.threadId)}
				<li class="border-surface-200-800 border-t py-6">
					<h3 class="text-xl leading-snug font-semibold break-words">
						<a
							href={`${base}/discuss/${thread.threadId}`}
							class="hover:text-primary-600 dark:hover:text-primary-400 underline-offset-4 hover:underline"
						>
							{thread.subject}
						</a>
					</h3>
					<p class="text-surface-500 mt-2 text-sm">{threadMeta(thread)}</p>
					{#if thread.excerpt}
						<p class="text-surface-700-300 mt-2 leading-relaxed break-words">{thread.excerpt}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
