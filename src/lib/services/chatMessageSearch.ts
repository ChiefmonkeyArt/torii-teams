import {
	getChatGroupDisplayTitle,
	type ChatGroupProfileHints
} from '$lib/components/chat/chatGroupDisplay';
import {
	buildAnnotationIndex,
	getMessageDeleteReference,
	getMessageEditReference,
	getMessageReactionReference
} from '$lib/chat/references';
import { ChatKinds } from '$lib/chat/kinds';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';
import { listChatGroupMembers, listChatGroups } from '$lib/services/chatGroups.svelte';
import { getChatStorage } from '$lib/storage/chatStorage';
import { samePubKey } from '$lib/utils';

export interface ChatMessageSearchResult {
	groupId: string;
	groupTitle: string;
	messageKey: string;
	createdAt: number;
	sender: string;
	snippet: string;
}

export interface SearchChatMessagesOptions {
	/** Scope to a single group's messages (the in-chat search). */
	groupId?: string;
	limit?: number;
	activePubkey?: string;
	profileHints?: ChatGroupProfileHints;
}

const DEFAULT_RESULT_LIMIT = 50;
const SNIPPET_RADIUS = 56;
/** Deep-scan page size (docs/long-history.md decision 9). */
const SCAN_PAGE_ROWS = 500;

export function searchChatMessages(
	query: string | string[],
	{
		groupId,
		limit = DEFAULT_RESULT_LIMIT,
		activePubkey,
		profileHints
	}: SearchChatMessagesOptions = {}
): ChatMessageSearchResult[] {
	const normalizedQueries = normalizeSearchQueries(query);
	if (normalizedQueries.length === 0) return [];
	const findMatchIndex = createMatchFinder(normalizedQueries);

	const results: ChatMessageSearchResult[] = [];

	for (const group of listChatGroups()) {
		if (groupId && group.id !== groupId) continue;
		const searchableMessages = getSearchableMessages(group.messages);
		const messageById = new Map(searchableMessages.map((message) => [message.id, message]));
		const groupTitle = getChatGroupDisplayTitle({
			group,
			activePubkey,
			profileHints,
			memberPubkeys: listChatGroupMembers(group.id).map((member) => member.stablePubkey)
		});

		for (const message of searchableMessages) {
			const match = matchSearchableMessage(message, findMatchIndex, messageById);
			if (match) results.push({ ...match, groupId: group.id, groupTitle });
		}
	}

	return sortResults(results).slice(0, limit);
}

export interface ChatMessageSearchHandle {
	/** Resolves when the scan finishes or is cancelled. */
	done: Promise<void>;
	cancel(): void;
}

/**
 * Always-deep search backfill (docs/long-history.md decision 9): scans durable
 * history newest-first per group and streams result batches, complementing the
 * sync window pass with everything below it. Edits/deletes apply with the sync
 * pass's semantics — annotations are always newer than their targets, so a
 * newest-first scan knows every edit and delete by the time it reaches the
 * original. Reaction matches wait for their target's row to stream by (targets
 * are older than reactions) and are dropped at scan end when it never does —
 * exactly how the sync pass skips reactions whose target is outside the
 * searched set.
 *
 * shortcut: each query scans complete history on the main thread, one IDB page
 * at a time (every read yields; the caller cancels on each new keystroke) — a
 * persisted index is the upgrade if scan time ever matters. A newest-first
 * early-out was dropped on purpose: results sort by createdAt and sender clocks
 * skew, so a stopped scan could differ from a full one.
 */
export function searchChatMessagesDeep(
	query: string | string[],
	options: SearchChatMessagesOptions,
	onBatch: (results: ChatMessageSearchResult[]) => void
): ChatMessageSearchHandle {
	const normalizedQueries = normalizeSearchQueries(query);
	let cancelled = false;

	const done = (async () => {
		if (normalizedQueries.length === 0) return;
		try {
			const storage = await getChatStorage();
			for (const group of listChatGroups()) {
				if (cancelled) return;
				if (options.groupId && group.id !== options.groupId) continue;
				await scanGroupHistory(
					storage,
					group.id,
					getChatGroupDisplayTitle({
						group,
						activePubkey: options.activePubkey,
						profileHints: options.profileHints,
						memberPubkeys: listChatGroupMembers(group.id).map((member) => member.stablePubkey)
					}),
					normalizedQueries,
					() => cancelled,
					onBatch
				);
			}
		} catch (error) {
			// Search must never break on a storage hiccup — the sync pass already
			// returned its window hits.
			console.error('[chat-search] deep scan failed', { error });
		}
	})();

	return {
		done,
		cancel: () => {
			cancelled = true;
		}
	};
}

async function scanGroupHistory(
	storage: Awaited<ReturnType<typeof getChatStorage>>,
	groupId: string,
	groupTitle: string,
	normalizedQueries: string[],
	isCancelled: () => boolean,
	onBatch: (results: ChatMessageSearchResult[]) => void
): Promise<void> {
	const findMatchIndex = createMatchFinder(normalizedQueries);
	// Newest-first incremental mirror of buildAnnotationIndex + the sync match
	// loop. Deletes and edits validate against their TARGET row (existence, kind,
	// author — buildAnnotationIndex's rules), and the target is older than its
	// annotation, so both pend until that row streams by. A deleted edit still
	// applies: buildAnnotationIndex never checks the edit's own deletion status
	// (kept for exact parity).
	const deletedIds = new Set<string>();
	const editMap = new Map<string, StoredChatMessage>();
	const pendingDeletes = new Map<
		string,
		Array<{ message: StoredChatMessage; targetKind: number }>
	>();
	const pendingEdits = new Map<string, StoredChatMessage[]>();
	const pendingReactions = new Map<
		string,
		Array<{ message: StoredChatMessage; reaction: string }>
	>();

	let before: number | undefined;
	for (;;) {
		if (isCancelled()) return;
		const page = await storage.getGroupMessagesPage(groupId, {
			before,
			limit: SCAN_PAGE_ROWS
		});
		if (page.length === 0) return;
		before = page[0].cursor;

		const batch: ChatMessageSearchResult[] = [];
		// Newest-first: by the time a row is reached, every annotation that could
		// affect it (all newer) has already been recorded or pended.
		for (let index = page.length - 1; index >= 0; index--) {
			const message = page[index];

			// This row is the target of earlier-pended annotations: validate and apply.
			for (const { message: deletion, targetKind } of pendingDeletes.get(message.id) ?? []) {
				if (targetKind !== message.kind) continue;
				if (!samePubKey(message.sender, deletion.sender)) continue;
				deletedIds.add(message.id);
			}
			pendingDeletes.delete(message.id);
			if (!deletedIds.has(message.id)) {
				for (const edit of pendingEdits.get(message.id) ?? []) {
					if (!samePubKey(message.sender, edit.sender)) continue;
					const current = editMap.get(message.id);
					// Latest edit wins by createdAt (same rule as buildAnnotationIndex).
					if (!current || edit.createdAt > current.createdAt) editMap.set(message.id, edit);
				}
			}
			pendingEdits.delete(message.id);

			if (message.kind === ChatKinds.Deletion) {
				const reference = getMessageDeleteReference(message.kind, message.tags);
				if (reference) {
					pushPending(pendingDeletes, reference.targetId, {
						message,
						targetKind: reference.targetKind
					});
				}
				continue;
			}
			if (message.kind === ChatKinds.Edit) {
				const reference = getMessageEditReference(message.kind, message.content, message.tags);
				if (reference) pushPending(pendingEdits, reference.targetId, message);
				continue;
			}
			if (deletedIds.has(message.id)) continue;
			const searchable = editMap.get(message.id) ?? message;

			const reactionReference = getMessageReactionReference(
				searchable.kind,
				searchable.content,
				searchable.tags
			);
			if (reactionReference) {
				if (findMatchIndex(normalizeSearchText(reactionReference.reaction))) {
					pushPending(pendingReactions, reactionReference.targetId, {
						message: searchable,
						reaction: reactionReference.reaction
					});
				}
			} else {
				const match = findMatchIndex(normalizeSearchText(searchable.content));
				if (match) {
					batch.push({
						groupId,
						groupTitle,
						messageKey: `${searchable.id}:${searchable.cursor}`,
						createdAt: searchable.createdAt,
						sender: searchable.sender,
						snippet: createSnippet(searchable.content, match.index, match.queryLen)
					});
				}
			}

			// The target's own searchable row streaming by resolves pended reactions
			// (keyed by the mapped id, mirroring the sync pass's messageById lookup).
			const resolved = pendingReactions.get(searchable.id);
			if (resolved) {
				pendingReactions.delete(searchable.id);
				for (const { message: reaction, reaction: text } of resolved) {
					batch.push({
						groupId,
						groupTitle,
						messageKey: `${searchable.id}:${searchable.cursor}`,
						createdAt: reaction.createdAt,
						sender: reaction.sender,
						snippet: `Reaction ${text} to: ${createSnippet(searchable.content, 0, 0)}`
					});
				}
			}
		}

		if (batch.length > 0) onBatch(sortResults(batch));
		if (page.length < SCAN_PAGE_ROWS) return;
	}
}

function pushPending<T>(map: Map<string, T[]>, key: string, value: T): void {
	const list = map.get(key) ?? [];
	list.push(value);
	map.set(key, list);
}

/** Merge result batches: deduped by messageKey (the deep scan re-finds window
 *  hits), sorted newest-first, capped at the result limit. Earlier lists win. */
export function mergeChatMessageSearchResults(
	...lists: ChatMessageSearchResult[][]
): ChatMessageSearchResult[] {
	const byKey = new Map<string, ChatMessageSearchResult>();
	for (const list of lists) {
		for (const result of list) {
			if (!byKey.has(result.messageKey)) byKey.set(result.messageKey, result);
		}
	}
	return sortResults([...byKey.values()]).slice(0, DEFAULT_RESULT_LIMIT);
}

type MessageMatch = Omit<ChatMessageSearchResult, 'groupId' | 'groupTitle'>;

/** Shared sync/deep matcher over one searchable message: reaction text against
 *  its target row (skipped when the target is outside the searched set — the
 *  sync pass's rule), otherwise the message content. */
function matchSearchableMessage(
	message: StoredChatMessage,
	findMatchIndex: (content: string) => { index: number; queryLen: number } | null,
	targetById: Map<string, StoredChatMessage>
): MessageMatch | null {
	const reactionReference = getMessageReactionReference(
		message.kind,
		message.content,
		message.tags
	);
	if (reactionReference) {
		const targetMessage = targetById.get(reactionReference.targetId);
		if (!targetMessage) return null;

		const reactionMatch = findMatchIndex(normalizeSearchText(reactionReference.reaction));
		if (!reactionMatch) return null;

		return {
			messageKey: `${targetMessage.id}:${targetMessage.cursor}`,
			createdAt: message.createdAt,
			sender: message.sender,
			snippet: `Reaction ${reactionReference.reaction} to: ${createSnippet(targetMessage.content, 0, 0)}`
		};
	}

	const match = findMatchIndex(normalizeSearchText(message.content));
	if (!match) return null;

	return {
		messageKey: `${message.id}:${message.cursor}`,
		createdAt: message.createdAt,
		sender: message.sender,
		snippet: createSnippet(message.content, match.index, match.queryLen)
	};
}

function getSearchableMessages(messages: StoredChatMessage[]): StoredChatMessage[] {
	const { editMap, deletedIds } = buildAnnotationIndex(messages);
	return messages
		.filter(
			(message) =>
				message.kind !== ChatKinds.Deletion &&
				message.kind !== ChatKinds.Edit &&
				// Torii Teams: action ops are hidden log entries, not messages.
				message.kind !== ChatKinds.Action
		)
		.filter((message) => !deletedIds.has(message.id))
		.map((message) => editMap.get(message.id) ?? message);
}

function normalizeSearchQueries(query: string | string[]): string[] {
	const queries = Array.isArray(query) ? query : [query];
	return [
		...new Set(
			queries
				.map((q) => q.trim())
				.map((q) => normalizeSearchText(q))
				.filter((q) => q.length >= 2)
		)
	];
}

function createMatchFinder(normalizedQueries: string[]) {
	return (content: string): { index: number; queryLen: number } | null => {
		for (const normalizedQuery of normalizedQueries) {
			const index = content.indexOf(normalizedQuery);
			if (index !== -1) return { index, queryLen: normalizedQuery.length };
		}
		return null;
	};
}

function normalizeSearchText(value: string): string {
	return value.toLocaleLowerCase();
}

function createSnippet(content: string, matchIndex: number, queryLength: number): string {
	const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
	const end = Math.min(content.length, matchIndex + queryLength + SNIPPET_RADIUS);
	const prefix = start > 0 ? '…' : '';
	const suffix = end < content.length ? '…' : '';

	return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

function sortResults(results: ChatMessageSearchResult[]): ChatMessageSearchResult[] {
	return [...results].sort(
		(a, b) => b.createdAt - a.createdAt || b.messageKey.localeCompare(a.messageKey)
	);
}
