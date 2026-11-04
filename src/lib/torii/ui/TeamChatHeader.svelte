<script lang="ts">
	// Project chat header: name, members, and who has not joined yet (ADR 0005).
	import { resolve } from '$app/paths';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import MemberName from './MemberName.svelte';

	let {
		slug,
		members,
		waiting,
		note = ''
	}: { slug: string; members: string[]; waiting: string[]; note?: string } = $props();

	let open = $state(false);
	const MAX_FACES = 5;
</script>

<header class="border-b border-border px-3 py-2 md:px-5">
	<div class="flex items-center gap-2">
		<a
			href={resolve('/chat')}
			class="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden"
			aria-label="Projects"><ChevronLeft class="size-5" /></a
		>
		<h1 class="min-w-0 flex-1 truncate text-base font-semibold">{slug}</h1>
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
