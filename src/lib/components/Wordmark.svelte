<script lang="ts">
	// Interim visible wordmark — renders the brand name as a Raleway uppercase
	// lockup (.font-display) beside the decorative SaturnMark. This is the
	// accessible name for the brand link; the real logotype is Wave-3
	// designer-gated. Sizing/color come from the parent via `class`.
	let { text = 'Great Falls Tool Bus', class: extraClass = '' }: { text?: string; class?: string } = $props();
</script>

<span class={`font-display ${extraClass}`}>{text}</span>
