/**
 * Browser lane: real Chromium + real IndexedDB — exercises the compound-key
 * cursor walk in IndexedDbChatStorage.getGroupMessagesPage and the putGroup
 * write memo against the real message store.
 */
import { describe, expect, test } from 'vitest';

import { getChatStorage, type StoredChatGroupData } from '$lib/storage/chatStorage';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';

function makeMessage(cursor: number): StoredChatMessage {
	return {
		cursor,
		createdAt: 1_000 + cursor,
		direction: 'inbound',
		sender: 'ab'.repeat(32),
		id: `ev-${cursor}`,
		kind: 1,
		tags: [],
		content: `message ${cursor}`
	};
}

function makeGroup(id: string, cursors: number[]): StoredChatGroupData {
	return {
		id,
		coordinatorKey: 'wss://relay.test',
		createdAt: 1_000,
		lastCursor: cursors.at(-1) ?? 0,
		fetchCursor: cursors.at(-1) ?? 0,
		stateBytes: new Uint8Array([1, 2, 3]),
		messages: cursors.map(makeMessage),
		syncIssues: []
	};
}

const cursorsOf = (messages: StoredChatMessage[]) => messages.map((message) => message.cursor);

describe('getGroupMessagesPage (indexeddb)', () => {
	test('pages by cursor range from real IndexedDB', async () => {
		const storage = await getChatStorage();
		const id = `page-${crypto.randomUUID()}`;
		await storage.putGroup(makeGroup(id, [1, 2, 3, 5, 8]));

		expect(cursorsOf(await storage.getGroupMessagesPage(id, { limit: 3 }))).toEqual([3, 5, 8]);
		expect(cursorsOf(await storage.getGroupMessagesPage(id, { before: 5, limit: 2 }))).toEqual([
			2, 3
		]);
		expect(cursorsOf(await storage.getGroupMessagesPage(id, { after: 2, limit: 2 }))).toEqual([
			3, 5
		]);
		expect(
			cursorsOf(await storage.getGroupMessagesPage(id, { after: 2, before: 8, limit: 5 }))
		).toEqual([3, 5]);
		expect(cursorsOf(await storage.getGroupMessagesPage(id, { limit: 0 }))).toEqual([]);

		await storage.deleteGroup(id);
	});

	test('putGroup memo still writes messages below the stored high-water', async () => {
		const storage = await getChatStorage();
		const id = `memo-${crypto.randomUUID()}`;
		// fastForward gap: cursor 8 lands first (advances fetchCursor past 3),
		// cursor 3 arrives later via recovery. The write memo must not skip it.
		await storage.putGroup(makeGroup(id, [8]));
		await storage.putGroup(makeGroup(id, [3, 8]));
		await storage.putGroup(makeGroup(id, [3, 8]));

		const group = await storage.getGroup(id);
		expect(cursorsOf(group?.messages ?? [])).toEqual([3, 8]);

		await storage.deleteGroup(id);
	});
});
