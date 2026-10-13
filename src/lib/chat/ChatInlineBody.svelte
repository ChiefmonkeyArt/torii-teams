<script lang="ts">
	import { inlineBodies, defaultInlineBody, type InlineBodyProps } from '$lib/chat/registry';
	import CollapsibleText from '$lib/components/chat/CollapsibleText.svelte';

	let { message, groupId, onVote, onOpenRich }: InlineBodyProps = $props();

	const Body = $derived(inlineBodies[message.kind] ?? defaultInlineBody);
</script>

<!-- Deleted rows never mount this (gated in ChatMessageItem); empty text is a
     no-op clamp. The wrapper enforces the README's inline-boundedness contract. -->
<CollapsibleText length={message.text.length} isOwn={message.isOwn ?? false}>
	<Body {message} {groupId} {onVote} {onOpenRich} />
</CollapsibleText>
