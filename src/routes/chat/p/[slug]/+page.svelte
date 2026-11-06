<script lang="ts">
	// One project's chat (Torii builds, ADR 0005).
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ChatShell from '$lib/components/chat/ChatShell.svelte';
	import { activeAccount } from '$lib/services/accountManager.svelte';
	import { listChatGroups } from '$lib/services/chatGroups.svelte';
	import { safeNormalizePubKey as normalizePubKey } from '$lib/utils';
	import { TORII_NODE_BUILD } from '$lib/torii/build';
	import { projectChannels, projectGroup } from '$lib/torii/projectChannels.svelte';
	import { rosterSync, startProjectChat } from '$lib/torii/rosterSync.svelte';
	import { waitingMembers } from '$lib/torii/rosterPlan';
	import TeamChatHeader from '$lib/torii/ui/TeamChatHeader.svelte';
	import ShisaWelcome from '$lib/torii/ui/ShisaWelcome.svelte';

	let { params } = $props();
	const slug = $derived(params.slug);

	$effect(() => {
		if (!TORII_NODE_BUILD) void goto(resolve('/chat'), { replaceState: true });
	});

	const onProject = $derived(projectChannels.projects.some((p) => p.slug === slug));
	const group = $derived.by(() => {
		void listChatGroups().length; // re-match when chats change
		return onProject ? projectGroup(slug) : null;
	});
	const me = $derived(normalizePubKey($activeAccount?.pubkey ?? ''));
	const isOwner = $derived(Boolean(me) && projectChannels.owners[slug] === me);
	// ADR 0006: with Continuum's signals the owner's chat starts by itself.
	const signals = $derived(Boolean(projectChannels.teams[slug]));
	const added = $derived(projectChannels.projects.find((p) => p.slug === slug)?.added ?? false);
	const waiting = $derived(
		isOwner
			? (rosterSync.waiting[slug] ?? [])
			: waitingMembers(projectChannels.rosters[slug], group?.memberPubkeys ?? [])
	);
	const note = $derived(
		rosterSync.error[slug]
			? `Couldn't update members: ${rosterSync.error[slug]}`
			: waiting.length
				? `${waiting.length} not joined yet`
				: ''
	);
</script>

{#if !onProject}
	<div class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
		You're not on this project.
	</div>
{:else if group}
	{#key group.id}
		<ChatShell groupId={group.id} title={slug} minimal>
			{#snippet header()}
				<TeamChatHeader {slug} members={group.memberPubkeys} {waiting} {note} />
			{/snippet}
		</ChatShell>
	{/key}
{:else}
	<div class="flex h-full flex-col">
		<TeamChatHeader {slug} members={[]} waiting={[]} />
		<div
			class="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground"
		>
			{#if isOwner && rosterSync.elsewhere[slug]}
				<div class="max-w-xs space-y-2">
					<p>This chat was started on another of your devices.</p>
					<p class="text-xs">Open Teams there to add people. It appears here once you are in it.</p>
				</div>
			{:else if isOwner && signals && !rosterSync.error[slug]}
				<p class="max-w-xs">Starting the chat for this project…</p>
			{:else if isOwner}
				<div class="max-w-xs space-y-3">
					<p>
						Start the chat for this project. Everyone on the member list is added as soon as they
						sign in.
					</p>
					<p class="text-xs">Already started it on another device? Open it there instead.</p>
					{#if rosterSync.error[slug]}<p class="text-xs">
							Couldn't start it: {rosterSync.error[slug]}
						</p>{/if}
					<button
						type="button"
						class="w-full rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-60"
						disabled={rosterSync.busy[slug]}
						onclick={() => void startProjectChat(slug)}
						>{rosterSync.busy[slug] ? 'Starting…' : 'Start project chat'}</button
					>
				</div>
			{:else if added}
				You've been added. Joining the chat…
			{:else}
				<div class="max-w-xs space-y-3" data-testid="joined-waiting">
					{#if projectChannels.welcome}<ShisaWelcome lively size={180} />{/if}
					<p class="font-medium text-foreground">You're in.</p>
					<p>
						{projectChannels.welcome?.ownerName || 'The project owner'} adds you to the chat the next
						time their Continuum is open. This page updates by itself.
					</p>
				</div>
			{/if}
		</div>
	</div>
{/if}
