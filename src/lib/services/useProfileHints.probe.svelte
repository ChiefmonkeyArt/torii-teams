<script lang="ts">
	import { useProfileHints } from './useProfileHints.svelte';

	// Mirrors ChatSidebar / ChatGroupListItem: the pubkey closure reads a
	// derived declared AFTER the call — legal because it only ever ran inside an
	// effect, and a TDZ landmine for anything that invokes it eagerly.
	const hints = useProfileHints(() => laterDerived.map((entry) => entry.pubkey));
	const laterDerived = $derived([{ pubkey: 'cc'.repeat(32) }]);
</script>

<span data-testid="hint-name">{hints['cc'.repeat(32)]?.name ?? ''}</span>
