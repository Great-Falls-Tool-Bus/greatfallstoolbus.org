<script lang="ts">
	import { base } from '$app/paths';
	import { ArrowLeft, MessagesSquare } from '@lucide/svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import { relativeTime, formatTimestamp } from '$lib/data/discuss-snapshot';

	// On-site thread reader (TIN-2528). Renders ONE archived discuss@ thread fully
	// on-site so a reader is never dumped into unstyled HyperKitty/Postorius. The
	// server load hands us a sanitized, privacy-gated DiscussThreadDetail — or
	// `null`, which is the calm "unavailable" state, NOT an error page. Each
	// message body arrives as pre-sanitized paragraph blocks carrying a quotation
	// depth; quotation reads via indentation + muted ink (house canon: never a
	// side-stripe border-left). Hairline dividers separate messages; long subjects
	// and unbroken tokens wrap (375px-safe) rather than overflow.
	let { data } = $props();
	const detail = $derived(data.detail);

	// One readable header meta string (starter · relative-start · people · count),
	// mirroring the index's `threadMeta` idiom so the template stays trivial and
	// whitespace-unambiguous. Per-message rows carry their own semantic <time>.
	const headerMeta = $derived.by(() => {
		if (!detail) return '';
		const people = `${detail.participantsCount} ${detail.participantsCount === 1 ? 'participant' : 'participants'}`;
		const count = `${detail.messages.length} ${detail.messages.length === 1 ? 'message' : 'messages'}`;
		const starter = detail.messages[0].senderName;
		return `Started by ${starter} · ${relativeTime(detail.startedAt)} · ${people} · ${count}`;
	});

	// Head/meta description: the first non-empty, non-quoted paragraph of the
	// opening message, clipped. Empty when the thread is unavailable.
	const metaDescription = $derived.by(() => {
		const text = detail?.messages[0]?.body.find((block) => block.quoteLevel === 0 && block.text)?.text ?? '';
		return text.length > 160 ? `${text.slice(0, 159).trimEnd()}…` : text;
	});
	const pageTitle = $derived(
		detail ? `${detail.subject} | Discuss | Great Falls Tool Bus` : 'Conversation | Discuss | Great Falls Tool Bus',
	);

	// Cap the visible indent so deep reply nesting never pushes content off a
	// narrow screen; the depth is still faithfully encoded in quoteLevel.
	const indentRem = (quoteLevel: number) => Math.min(quoteLevel, 5) * 0.85;
</script>

<svelte:head>
	<title>{pageTitle}</title>
	{#if metaDescription}
		<meta name="description" content={metaDescription} />
	{/if}
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<a
		href={`${base}/discuss`}
		class="text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 inline-flex items-center gap-1 py-1 text-sm underline-offset-2 hover:underline"
	>
		<ArrowLeft size={14} aria-hidden="true" />
		<span>All conversations</span>
	</a>

	{#if detail}
		<header class="mt-6 space-y-4">
			<p class="text-surface-500 text-xs tracking-widest uppercase">Community board · Discuss</p>
			<h1 class="flex items-start gap-3 text-3xl leading-tight font-bold break-words sm:text-4xl">
				<MessagesSquare class="text-primary-500 mt-1 h-7 w-7 shrink-0" aria-hidden="true" />
				<span class="min-w-0 break-words">{detail.subject}</span>
			</h1>
			<p class="text-surface-500 text-sm">{headerMeta}</p>
		</header>

		<!-- Messages: hairline-divided, oldest first. No card chrome, no side-stripes. -->
		<div class="mt-10">
			{#each detail.messages as message, index (message.id)}
				{@const rel = relativeTime(message.sentAt)}
				{@const abs = formatTimestamp(message.sentAt)}
				<article class="border-surface-200-800 py-6" class:border-t={index > 0}>
					<header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span class="font-semibold break-words">{message.senderName}</span>
						<time datetime={message.sentAt} title={abs} class="text-surface-500 text-sm">{rel}</time>
					</header>

					<div class="mt-3 space-y-3">
						{#each message.body as block, blockIndex (blockIndex)}
							{#if block.quoteLevel > 0}
								<p
									class="text-surface-600-400 leading-relaxed break-words italic"
									style={`padding-inline-start: ${indentRem(block.quoteLevel)}rem`}
								>
									{block.text}
								</p>
							{:else}
								<p class="text-surface-700-300 leading-relaxed break-words">{block.text}</p>
							{/if}
						{/each}
						{#if message.body.length === 0}
							<p class="text-surface-500 text-sm italic">(No text content.)</p>
						{/if}
					</div>
				</article>
			{/each}
		</div>

		<footer class="border-surface-200-800 mt-6 border-t pt-6">
			<p class="text-sm">
				<ExternalLink
					href={data.archiveUrl}
					class="text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 underline-offset-4 hover:underline"
				>
					View on the mailing-list archive
				</ExternalLink>
			</p>
		</footer>
	{:else}
		<!-- Calm unavailable state: the live read failed (off-cluster, a transient
		     archive outage, or a privacy hard-fail). Never a hard 500, never invented
		     content — just an honest note and the way back to the board. -->
		<section class="border-surface-200-800 mt-12 border-y px-6 py-16 text-center" aria-label="Conversation unavailable">
			<h1 class="text-2xl font-semibold">This conversation isn't available right now</h1>
			<p class="text-surface-700 dark:text-surface-300 mx-auto mt-4 max-w-prose leading-relaxed">
				We couldn't load this thread from the archive. It may have moved, or the archive may be briefly unreachable.
				Please try again later.
			</p>
			<p class="mt-8">
				<a
					href={`${base}/discuss`}
					class="text-primary-600 hover:text-primary-500 font-semibold underline underline-offset-4"
				>
					Back to all conversations
				</a>
			</p>
		</section>
	{/if}
</main>
