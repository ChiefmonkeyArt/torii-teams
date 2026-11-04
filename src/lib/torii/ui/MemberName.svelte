<script lang="ts">
	// A person's avatar and name from their Nostr profile (falls back to a short key).
	import Avatar from '$lib/components/Avatar.svelte';
	import { ensureProfileLoaded } from '$lib/queries/chatProfileQueries';
	import { useProfile } from '$lib/services/useProfile.svelte';
	import { profileDisplayName } from '$lib/utils/profileName';

	let {
		pubkey,
		showName = true,
		size = 'h-6 w-6'
	}: { pubkey: string; showName?: boolean; size?: string } = $props();

	const profile = useProfile(() => pubkey);
	const name = $derived(profileDisplayName(profile.current, pubkey) ?? `${pubkey.slice(0, 8)}…`);
	$effect(() => {
		if (!profile.current) ensureProfileLoaded(pubkey);
	});
</script>

<span class="inline-flex min-w-0 items-center gap-2" title={name}>
	<Avatar {pubkey} picture={profile.current?.picture} {size} alt={name} />
	{#if showName}<span class="truncate">{name}</span>{/if}
</span>
