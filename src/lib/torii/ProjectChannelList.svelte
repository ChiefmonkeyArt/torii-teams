<script lang="ts">
	// Torii Teams: the sidebar on a Torii node. One row per Continuum project the
	// signed-in member is on; a row opens that project's Cordn group only when
	// the group passes matchProjectGroup (fails closed). ADR 0002.
	import { resolve } from '$app/paths';
	import ChatGroupListItem from '$lib/components/chat/ChatGroupListItem.svelte';
	import { listChatGroups } from '$lib/services/chatGroups.svelte';
	import { groupRouteId } from '$lib/services/chatGroupLinks.svelte';
	import { activeAccount } from '$lib/services/accountManager.svelte';
	import type { ChatGroupProfileHints } from '$lib/components/chat/chatGroupDisplay';
	import { projectMarker } from './continuumApi';
	import {
		projectChannels,
		projectGroupId,
		refreshProjectChannels,
		signInToContinuum
	} from './projectChannels.svelte';

	let {
		collapsed = false,
		isGroupActive,
		onnavigate,
		getChatSummary,
		profileHints
	}: {
		collapsed?: boolean;
		isGroupActive: (groupId: string) => boolean;
		onnavigate?: () => void;
		getChatSummary: (groupId: string) => {
			preview: string;
			unreadCount: number;
			unreadReferenceCount: number;
		};
		profileHints?: ChatGroupProfileHints;
	} = $props();

	// Re-check when the signed-in Nostr account changes.
	$effect(() => {
		void $activeAccount?.pubkey;
		void refreshProjectChannels();
	});

	const rows = $derived.by(() => {
		const groups = listChatGroups();
		return projectChannels.projects.map((p) => {
			const id = projectGroupId(p.slug);
			return { project: p, group: id ? (groups.find((g) => g.id === id) ?? null) : null };
		});
	});

	function createHref(slug: string): string {
		const q = new URLSearchParams({
			name: slug,
			description: projectMarker(slug),
			coordinator: projectChannels.coordinator
		});
		return `${resolve('/chat/create-group')}?${q}`;
	}
</script>

{#if !collapsed}
	<div class="px-1 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
		Projects
	</div>
{/if}

{#if !$activeAccount}
	{#if !collapsed}
		<p
			class="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground"
		>
			Sign in with Nostr below to see your projects.
		</p>
	{/if}
{:else if projectChannels.status === 'signed-out' || projectChannels.status === 'signing-in'}
	{#if !collapsed}
		<div class="space-y-2 rounded-xl border border-border px-3 py-3 text-sm">
			<p class="text-muted-foreground">Confirm it's you to this node's Continuum.</p>
			<button
				type="button"
				class="w-full rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-60"
				disabled={projectChannels.status === 'signing-in'}
				onclick={() => void signInToContinuum()}
			>
				{projectChannels.status === 'signing-in' ? 'Signing…' : 'Show my projects'}
			</button>
		</div>
	{/if}
{:else if projectChannels.status === 'loading'}
	{#if !collapsed}<p class="px-3 py-2 text-sm text-muted-foreground">Loading projects…</p>{/if}
{:else if projectChannels.status === 'error'}
	{#if !collapsed}
		<div class="space-y-2 rounded-xl border border-border px-3 py-3 text-sm">
			<p class="text-muted-foreground">{projectChannels.error}</p>
			<button type="button" class="text-primary underline" onclick={() => void signInToContinuum()}
				>Try again</button
			>
		</div>
	{/if}
{:else if rows.length === 0}
	{#if !collapsed}
		<p
			class="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground"
		>
			No projects yet. The node owner adds you from Continuum.
		</p>
	{/if}
{:else}
	<div class="space-y-1">
		{#each rows as row (row.project.slug)}
			{#if row.group}
				{@const summary = getChatSummary(row.group.id)}
				<ChatGroupListItem
					group={row.group}
					href={resolve('/chat/[id]', { id: groupRouteId(row.group.id) })}
					preview={summary.preview}
					unreadCount={summary.unreadCount}
					unreadReferenceCount={summary.unreadReferenceCount}
					{collapsed}
					variant="sidebar"
					active={isGroupActive(row.group.id)}
					onclick={onnavigate}
					{profileHints}
				/>
			{:else if !collapsed}
				<div class="rounded-xl border border-dashed border-border px-3 py-2 text-sm">
					<div class="font-medium"># {row.project.slug}</div>
					{#if row.project.role === 'owner'}
						<!-- resolve() plus a query string -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							class="text-primary underline"
							href={createHref(row.project.slug)}
							onclick={onnavigate}>Create project chat</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{:else}
						<span class="text-muted-foreground">Waiting to be added to the chat</span>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
{/if}
