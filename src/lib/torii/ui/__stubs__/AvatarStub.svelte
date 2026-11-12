<script lang="ts">
	// Test stand-in for ChatGroupAvatar (TeamChatHeader.svelte.test.ts).
	let { group }: { group: { id: string } } = $props();
</script>

<span data-testid="group-avatar-stub" data-group={group.id}></span>
