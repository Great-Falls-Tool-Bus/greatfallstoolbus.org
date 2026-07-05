<script lang="ts">
	import { base } from '$app/paths';
	import { MailCheck } from '@lucide/svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import { KEYHOLDER_MAIL_GUIDE, LIST } from '$lib/data/mail-clients';

	const guideSections = KEYHOLDER_MAIL_GUIDE;

	function guideHref(href: string): string {
		return href.startsWith('/') ? `${base}${href}` : href;
	}

	function isExternalHref(href: string): boolean {
		return href.startsWith('http://') || href.startsWith('https://');
	}
</script>

<svelte:head>
	<title>Keyholder mail guide | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Onboarding guide for approved Great Falls Tool Bus keyholders using the keyholders Mailman list."
	/>
</svelte:head>

<main class="mx-auto max-w-4xl px-6 py-16 md:py-24">
	<PageHeader
		eyebrow="Keyholders"
		title="Keyholder mail guide"
		lead={`How to join, file, and reply on ${LIST.post}. This is the private role list for approved keyholders who coordinate access requests and bus operations.`}
		icon={MailCheck}
	/>

	<section class="mt-10" aria-labelledby="guide-heading">
		<h2 id="guide-heading" class="sr-only">Onboarding guide</h2>
		<ol class="space-y-6">
			{#each guideSections as section, sectionIndex (section.id)}
				<li>
					<Card eyebrow={`Step ${sectionIndex + 1}`} title={section.title} body={section.summary} headingLevel="h2">
						<div class="mt-5 space-y-5">
							{#each section.items as item (item.title)}
								<div class="border-surface-200-800 border-t pt-4 first:border-t-0 first:pt-0">
									<div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
										<h3 class="text-base font-semibold">{item.title}</h3>
										{#if item.meta}
											<p class="text-surface-500 text-xs">{item.meta}</p>
										{/if}
									</div>

									{#if item.address}
										<a
											class="text-primary-700 dark:text-primary-300 mt-2 inline-block break-all font-mono text-sm underline underline-offset-4"
											href={`mailto:${item.address}`}
										>
											{item.address}
										</a>
									{/if}

									<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">{item.body}</p>

									{#if item.details}
										<dl class="mt-3 grid gap-2 text-sm md:grid-cols-2">
											{#each item.details as detail (detail.label)}
												<div class="grid gap-0.5">
													<dt class="text-surface-500 text-xs tracking-wide uppercase">{detail.label}</dt>
													<dd class="text-surface-700-300 leading-relaxed">{detail.value}</dd>
												</div>
											{/each}
										</dl>
									{/if}

									{#if item.href}
										<a
											class="text-primary-700 dark:text-primary-300 mt-3 inline-block text-sm font-semibold underline underline-offset-4"
											href={guideHref(item.href)}
											target={isExternalHref(item.href) ? '_blank' : undefined}
											rel={isExternalHref(item.href) ? 'noopener' : undefined}
										>
											{item.ctaLabel ?? 'Open'}
										</a>
									{/if}
								</div>
							{/each}
						</div>
					</Card>
				</li>
			{/each}
		</ol>
	</section>
</main>
