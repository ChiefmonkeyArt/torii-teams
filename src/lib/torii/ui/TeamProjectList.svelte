<script lang="ts">
	// One row per project the member is on (ADR 0005). A row always opens the
	// project page; the page explains when the chat is not ready yet.
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { activeAccount } from '$lib/services/accountManager.svelte';
	import { getChatGroupSummary } from '$lib/services/chatGroupPresence.svelte';
	import { projectChannels, projectGroupId } from '../projectChannels.svelte';
	import { markerSlugs } from '../rosterPlan';

	let { onnavigate }: { onnavigate?: () => void } = $props();

	const rows = $derived.by(() =>
		projectChannels.projects.map((p) => {
			const groupId = projectGroupId(p.slug);
			const summary = groupId ? getChatGroupSummary(groupId, $activeAccount?.pubkey) : null;
			const isOwner = projectChannels.owners[p.slug] === $activeAccount?.pubkey;
			// An empty chat previews its description (the project marker): hide it.
			const preview = summary?.preview ?? '';
			const shown = markerSlugs(preview).length || preview === 'Group chat' ? '' : preview;
			return {
				slug: p.slug,
				href: resolve('/chat/p/[slug]', { slug: p.slug }),
				unread: summary?.unreadCount ?? 0,
				preview: groupId ? shown : isOwner ? 'Not started' : 'Chat opens soon'
			};
		})
	);
</script>

{#if projectChannels.status === 'ready' && rows.length === 0}
	<p class="px-3 py-4 text-sm text-muted-foreground">
		You're not on a project yet. The project owner adds you in Continuum.
	</p>
{:else}
	<nav aria-label="Projects" class="flex flex-col gap-0.5 p-2">
		{#each rows as row (row.slug)}
			{@const active = page.url.pathname === row.href}
			<a
				href={row.href}
				onclick={onnavigate}
				aria-current={active ? 'page' : undefined}
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted {active
					? 'bg-muted font-medium'
					: ''}"
			>
				<span class="min-w-0 flex-1">
					<span class="block truncate">{row.slug}</span>
					{#if row.preview}
						<span class="block truncate text-xs text-muted-foreground">{row.preview}</span>
					{/if}
				</span>
				{#if row.unread > 0}
					<span
						class="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
						aria-label="{row.unread} unread">{row.unread > 99 ? '99+' : row.unread}</span
					>
				{/if}
			</a>
		{/each}
	</nav>
{/if}
