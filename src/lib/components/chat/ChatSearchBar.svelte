<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { nip19 } from 'nostr-tools';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as InputGroup from '$lib/components/ui/input-group';
	import { Button } from '$lib/components/ui/button';
	import Search from '@lucide/svelte/icons/search';
	import ChatSearchResults from './ChatSearchResults.svelte';
	import { activeAccount } from '$lib/services/accountManager.svelte';
	import {
		searchChatContent,
		type ChatContentSearchResults
	} from '$lib/services/chatContentSearch';
	import type { ChatMessageSearchResult } from '$lib/services/chatMessageSearch';
	import { resolveSearchQuery } from '$lib/services/chatSearchKeywords';
	import { listChatGroupMembers, listChatGroups } from '$lib/services/chatGroups.svelte';
	import { groupRouteId } from '$lib/services/chatGroupLinks.svelte';
	import { useProfileHints } from '$lib/services/useProfileHints.svelte';
	import { metadataRelays } from '$lib/services/relay-pool';
	import { normalizePubKey } from '$lib/utils';

	let open = $state(false);
	let searchQuery = $state('');
	let debouncedSearchQuery = $state('');

	const profileHints = useProfileHints(
		() => {
			const activePubkey = $activeAccount ? normalizePubKey($activeAccount.pubkey) : '';
			return [
				...new Set(
					listChatGroups().flatMap((group) =>
						listChatGroupMembers(group.id)
							.map((member) => normalizePubKey(member.stablePubkey))
							.filter((pubkey): pubkey is string => Boolean(pubkey) && pubkey !== activePubkey)
					)
				)
			];
		},
		{ relays: metadataRelays }
	);

	const resolvedSearchQuery = $derived.by(() =>
		resolveSearchQuery(debouncedSearchQuery, $activeAccount?.pubkey)
	);
	const isSearching = $derived(debouncedSearchQuery.trim().length >= 2);
	const emptyResults: ChatContentSearchResults = { people: [], groups: [], messages: [] };
	const searchResults = $derived.by(() =>
		isSearching
			? searchChatContent(resolvedSearchQuery, {
					activePubkey: $activeAccount?.pubkey,
					profileHints
				})
			: emptyResults
	);
	const resultCount = $derived(
		searchResults.people.length + searchResults.groups.length + searchResults.messages.length
	);

	// Same 200ms settle as the sidebar search: the fold runs over every stored
	// message, so per-keystroke searches would fight typing.
	$effect(() => {
		const nextQuery = searchQuery;
		const timer = setTimeout(() => {
			debouncedSearchQuery = nextQuery;
		}, 200);
		return () => clearTimeout(timer);
	});

	function closeAndGoto(href: string) {
		open = false;
		// Callers pass paths already through resolve(); the message variant appends a
		// local query parameter after resolving (same as ChatSidebar.navigateToMessage).
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		void goto(href);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class="inline-flex">
		<Button
			type="button"
			variant="outline"
			class="h-10 gap-2 rounded-xl px-3"
			aria-label="Search messages, groups and people"
			title="Search"
		>
			<Search class="size-4" />
			<span class="hidden text-muted-foreground md:inline">Search…</span>
		</Button>
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Search</Dialog.Title>
			<Dialog.Description>Find people, groups and messages.</Dialog.Description>
		</Dialog.Header>

		<InputGroup.Root>
			<InputGroup.Input
				bind:value={searchQuery}
				type="search"
				autofocus
				placeholder="Search messages, groups and people…"
				aria-label="Search messages, groups and people"
			/>
			<InputGroup.Addon>
				<Search class="size-4" />
			</InputGroup.Addon>
			{#if isSearching}
				<InputGroup.Addon align="inline-end">
					<InputGroup.Text>{resultCount} results</InputGroup.Text>
				</InputGroup.Addon>
			{/if}
		</InputGroup.Root>

		{#if isSearching}
			<div class="max-h-[60vh] overflow-y-auto">
				<ChatSearchResults
					results={searchResults}
					query={debouncedSearchQuery.trim()}
					onSelectPerson={(pubkey) =>
						closeAndGoto(resolve('/p/[identifier]', { identifier: nip19.npubEncode(pubkey) }))}
					onSelectGroup={(selectedGroupId) =>
						closeAndGoto(resolve('/chat/[id]', { id: groupRouteId(selectedGroupId) }))}
					onSelectMessage={(result: ChatMessageSearchResult) =>
						closeAndGoto(
							`${resolve('/chat/[id]', { id: groupRouteId(result.groupId) })}?message=${encodeURIComponent(result.messageKey)}`
						)}
				/>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
