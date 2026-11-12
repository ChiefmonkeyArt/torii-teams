<script lang="ts">
	// Project chat header: name, members, and who has not joined yet (ADR 0005).
	import { resolve } from '$app/paths';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import MemberName from './MemberName.svelte';
	import { embedState } from './embedState.svelte';
	import { ensureProfileLoaded } from '$lib/queries/chatProfileQueries';
	import ChatSearchBar from '$lib/components/chat/ChatSearchBar.svelte';
	import ChatGroupAvatar from '$lib/components/chat/ChatGroupAvatar.svelte';
	import { listChatGroups } from '$lib/services/chatGroups.svelte';

	let {
		slug,
		group = null,
		members,
		waiting,
		note = ''
	}: {
		slug: string;
		/** The project's chat, once it exists (search and group icon, ADR 0023). */
		group?: { id: string } | null;
		members: string[];
		waiting: string[];
		note?: string;
	} = $props();
	const stored = $derived(group ? (listChatGroups().find((g) => g.id === group.id) ?? null) : null);

	let open = $state(false);
	const MAX_FACES = 5;

	// Framed, no MemberName renders here, and messages only read profiles that
	// are already loaded: load the team's profiles so names show (torii.23).
	$effect(() => {
		if (!embedState.on) return;
		for (const pk of [...members, ...waiting]) ensureProfileLoaded(pk);
	});
</script>

<!-- ADR 0021 §3: inside Continuum its strip is the header; only a note shows. -->
{#if embedState.on}
	<!-- ADR 0023 §8: Continuum's Search button opens this. -->
	{#if group}<ChatSearchBar groupId={group.id} bind:open={embedState.search} trigger={false} />{/if}
	{#if note}<p
			class="border-b border-border px-3 py-1 text-xs text-muted-foreground md:px-5"
			data-testid="chat-note"
		>
			{note}
		</p>{/if}
{:else}
	<header class="relative border-b border-border px-3 py-2 md:px-5">
		<div class="flex items-center gap-2">
			{#if !embedState.on}<a
					href={resolve('/chat')}
					class="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden"
					aria-label="Projects"><ChevronLeft class="size-5" /></a
				>{/if}
			{#if stored}<ChatGroupAvatar group={stored} class="h-8 w-8" />{/if}
			<h1 class="min-w-0 flex-1 truncate text-base font-semibold">{slug}</h1>
			{#if group}<ChatSearchBar groupId={group.id} />{/if}
			<button
				type="button"
				class="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted"
				aria-expanded={open}
				aria-label="Members"
				onclick={() => (open = !open)}
			>
				<span class="flex -space-x-1.5">
					{#each members.slice(0, MAX_FACES) as pk (pk)}
						<MemberName pubkey={pk} showName={false} size="h-6 w-6 ring-2 ring-background" />
					{/each}
				</span>
				<span class="text-xs text-muted-foreground">{members.length}</span>
			</button>
		</div>
		{#if note}<p class="mt-1 text-xs text-muted-foreground">{note}</p>{/if}
		{#if open}
			<div class="mt-2 grid gap-1 text-sm">
				{#each members as pk (pk)}
					<MemberName pubkey={pk} />
				{/each}
				{#each waiting as pk (pk)}
					<span class="flex items-center gap-2 text-muted-foreground">
						<MemberName pubkey={pk} />
						<span class="text-xs">hasn't signed in yet</span>
					</span>
				{/each}
			</div>
		{/if}
	</header>
{/if}
