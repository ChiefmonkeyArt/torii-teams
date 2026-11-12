<script lang="ts">
	// Test stand-in for ChatSearchBar (TeamChatHeader.svelte.test.ts).
	let {
		groupId,
		open = $bindable(false),
		trigger = true
	}: { groupId?: string; open?: boolean; trigger?: boolean } = $props();
</script>

<span data-testid="search-stub" data-group={groupId} data-open={open} data-trigger={trigger}></span>
