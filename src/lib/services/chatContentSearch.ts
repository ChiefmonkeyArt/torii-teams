import { matchesProfileSearch } from '$lib/components/chat/profileSearch';
import {
	getChatGroupDisplayTitle,
	getGroupActivityAt,
	getProfileDisplayName,
	type ChatGroupProfileHints
} from '$lib/components/chat/chatGroupDisplay';
import { normalizePubKey } from '$lib/utils';
import { isChatGroupPinned } from '$lib/services/chatGroupPins.svelte';
import { searchChatMessages, type ChatMessageSearchResult } from '$lib/services/chatMessageSearch';
import {
	listChatGroupMembers,
	listChatGroups,
	type StoredChatGroup
} from '$lib/services/chatGroups.svelte';

export interface ChatPeopleSearchResult {
	pubkey: string;
	displayName: string;
}

export interface ChatGroupSearchResult {
	group: StoredChatGroup;
	title: string;
}

export interface ChatContentSearchResults {
	people: ChatPeopleSearchResult[];
	groups: ChatGroupSearchResult[];
	messages: ChatMessageSearchResult[];
}

export interface SearchChatContentOptions {
	/** Scope people and messages to one group (the in-chat search); no Groups section. */
	groupId?: string;
	activePubkey?: string;
	profileHints: ChatGroupProfileHints;
}

const PEOPLE_LIMIT = 10;
const GROUP_LIMIT = 10;

/**
 * Versatile search over local chat state: people (group members by name,
 * display name, NIP-05 or npub), groups (by display title) and messages (the
 * existing `searchChatMessages` — untouched). People dedupe across groups and
 * sort by display name; groups sort pinned-first then by recent activity,
 * matching the chat list. With `groupId` the search narrows to one chat: its members and its messages,
 * and no Groups section.
 */
export function searchChatContent(
	query: string | string[],
	{ groupId, activePubkey, profileHints }: SearchChatContentOptions
): ChatContentSearchResults {
	const normalizedQueries = [
		...new Set(
			(Array.isArray(query) ? query : [query])
				.map((q) => q.trim().toLocaleLowerCase())
				.filter((q) => q.length >= 2)
		)
	];
	if (normalizedQueries.length === 0) return { people: [], groups: [], messages: [] };

	const self = activePubkey ? normalizePubKey(activePubkey) : '';
	const peopleByPubkey = new Map<string, ChatPeopleSearchResult>();
	const groupResults: ChatGroupSearchResult[] = [];

	for (const group of listChatGroups()) {
		if (groupId && group.id !== groupId) continue;
		const memberPubkeys = [
			...new Set(
				listChatGroupMembers(group.id)
					.map((member) => normalizePubKey(member.stablePubkey))
					.filter((pubkey): pubkey is string => Boolean(pubkey))
			)
		];
		const title = getChatGroupDisplayTitle({ group, activePubkey, profileHints, memberPubkeys });
		if (!groupId && normalizedQueries.some((q) => title.toLocaleLowerCase().includes(q))) {
			groupResults.push({ group, title });
		}
		for (const pubkey of memberPubkeys) {
			if (pubkey === self || peopleByPubkey.has(pubkey)) continue;
			if (
				normalizedQueries.some((q) => matchesProfileSearch({ pubkey, profileHints, search: q }))
			) {
				peopleByPubkey.set(pubkey, {
					pubkey,
					displayName: getProfileDisplayName(pubkey, profileHints)
				});
			}
		}
	}

	return {
		people: [...peopleByPubkey.values()]
			.sort((a, b) => a.displayName.localeCompare(b.displayName))
			.slice(0, PEOPLE_LIMIT),
		groups: groupResults
			.sort(
				(a, b) =>
					// Pinned chats hold the top here too — same order as the chat list
					// and the share picker.
					Number(isChatGroupPinned(b.group.id)) - Number(isChatGroupPinned(a.group.id)) ||
					getGroupActivityAt(b.group) - getGroupActivityAt(a.group)
			)
			.slice(0, GROUP_LIMIT),
		messages: searchChatMessages(normalizedQueries, { groupId, activePubkey, profileHints })
	};
}
