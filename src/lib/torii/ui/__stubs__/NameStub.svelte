<script lang="ts">
	// Test stand-in for MemberName (TeamChatHeader.svelte.test.ts).
	let { pubkey }: { pubkey: string } = $props();
</script>

<span data-testid="name-stub">{pubkey.slice(0, 4)}</span>
