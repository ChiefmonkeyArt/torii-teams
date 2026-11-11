/**
 * Browser lane: real Chromium + real IndexedDB — exercises the compound-key
 * cursor walk in IndexedDbChatStorage.getGroupMessagesPage and the putGroup
 * write memo against the real message store.
 */
import { describe, expect, test } from 'vitest';

import {
	getChatStorage,
	upgradeChatSchema,
	type StoredChatGroupData
} from '$lib/storage/chatStorage';
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

	test('windowed group reads return the newest rows in ascending order', async () => {
		const storage = await getChatStorage();
		const id = `window-${crypto.randomUUID()}`;
		await storage.putGroup(makeGroup(id, [1, 2, 3, 5, 8]));

		const group = await storage.getGroup(id, { messageLimit: 2 });
		expect(cursorsOf(group?.messages ?? [])).toEqual([5, 8]);

		await storage.deleteGroup(id);
	});

	test('putGroup writes ledger rows only for newly written messages', async () => {
		const storage = await getChatStorage();
		const id = `ledger-${crypto.randomUUID()}`;
		await storage.putGroup({
			...makeGroup(id, [8]),
			messageLedger: [
				{ groupId: id, cursor: 8, countable: true },
				// No message at cursor 99: rows ride message writes, so this must
				// never reach storage.
				{ groupId: id, cursor: 99, countable: true }
			]
		});
		await storage.putGroup({
			...makeGroup(id, [3, 8]),
			messageLedger: [
				{ groupId: id, cursor: 3, refTargetId: 'ev-3' },
				{ groupId: id, cursor: 8, countable: true }
			]
		});

		const rows = await storage.listMessageLedgerRows(id);
		expect(rows.map((row) => row.cursor)).toEqual([3, 8]);
		expect(rows.find((row) => row.cursor === 3)?.refTargetId).toBe('ev-3');

		await storage.deleteGroup(id);
		expect(await storage.listMessageLedgerRows(id)).toEqual([]);
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

describe('by-kind and by-id indexes (indexeddb, ADR 0018 §3)', () => {
	test('reads one kind and finds cursors by id without the full history', async () => {
		const storage = await getChatStorage();
		const id = `kind-${crypto.randomUUID()}`;
		const other = `kind-other-${crypto.randomUUID()}`;
		const group = makeGroup(id, [1, 2, 3, 4, 5, 6]);
		group.messages[1] = { ...group.messages[1], kind: 1012 };
		group.messages[4] = { ...group.messages[4], kind: 1012 };
		await storage.putGroup(group);
		await storage.putGroup({
			...makeGroup(other, [2]),
			messages: [{ ...makeMessage(2), kind: 1012 }]
		});

		expect(cursorsOf(await storage.getGroupMessagesOfKind(id, 1012))).toEqual([2, 5]);
		expect(cursorsOf(await storage.getGroupMessagesOfKind(id, 1))).toEqual([1, 3, 4, 6]);
		expect(await storage.getGroupMessagesOfKind(id, 7)).toEqual([]);
		const found = await storage.getGroupMessageCursorsById(id, ['ev-3', 'ev-6', 'missing', 'ev-3']);
		expect([...found.entries()].sort()).toEqual([
			['ev-3', 3],
			['ev-6', 6]
		]);
		expect((await storage.getGroupMessageCursorsById(id, [])).size).toBe(0);

		await storage.deleteGroup(id);
		await storage.deleteGroup(other);
	});

	test('a version 6 database gains the indexes over rows it already holds', async () => {
		const name = `upgrade-${crypto.randomUUID()}`;
		const open = (version: number, upgrade: (req: IDBOpenDBRequest) => void) =>
			new Promise<IDBDatabase>((resolve, reject) => {
				const req = indexedDB.open(name, version);
				req.onupgradeneeded = () => upgrade(req);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
		const done = (tx: IDBTransaction) =>
			new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		// The v6 message store: compound key plus the groupId index, nothing else.
		const v6 = await open(1, (req) => {
			const store = req.result.createObjectStore('messages', { keyPath: ['groupId', 'cursor'] });
			store.createIndex('groupId', 'groupId', { unique: false });
		});
		const write = v6.transaction(['messages'], 'readwrite');
		for (const cursor of [1, 2, 3]) {
			write
				.objectStore('messages')
				.put({ ...makeMessage(cursor), kind: cursor === 2 ? 1012 : 1, groupId: 'g' });
		}
		await done(write);
		v6.close();

		const v7 = await open(2, (req) => upgradeChatSchema(req.result, req.transaction));
		const read = v7.transaction(['messages'], 'readonly');
		const store = read.objectStore('messages');
		const byKind = store
			.index('groupKindCursor')
			.getAll(IDBKeyRange.bound(['g', 1012, -Infinity], ['g', 1012, Infinity]));
		const byId = store.index('groupMessageId').getKey(['g', 'ev-3']);
		await done(read);
		expect(byKind.result.map((row: StoredChatMessage) => row.cursor)).toEqual([2]);
		expect(byId.result).toEqual(['g', 3]);
		v7.close();
		await new Promise((resolve) => {
			const del = indexedDB.deleteDatabase(name);
			del.onsuccess = del.onerror = () => resolve(null);
		});
	});
});
