import { describe, expect, it } from 'vitest';

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

describe('message ledger rows', () => {
	it('round-trips rows and clears them with the group', async () => {
		const storage = await getChatStorage();
		await storage.putMessageLedgerRows([
			{ groupId: 'ledger-mem', cursor: 5, countable: true },
			{ groupId: 'ledger-mem', cursor: 1, refTargetId: 'ev-1' }
		]);
		const rows = await storage.listMessageLedgerRows('ledger-mem');
		expect(rows.map((row) => row.cursor)).toEqual([1, 5]);
		expect(rows.find((row) => row.cursor === 1)?.refTargetId).toBe('ev-1');
		await storage.deleteGroup('ledger-mem');
		expect(await storage.listMessageLedgerRows('ledger-mem')).toEqual([]);
	});
});

describe('getGroupMessagesPage', () => {
	it('returns tail, before and after pages in ascending cursor order', async () => {
		const storage = await getChatStorage();
		await storage.putGroup(makeGroup('page-modes', [1, 2, 3, 5, 8]));

		// tail: newest `limit`
		expect(cursorsOf(await storage.getGroupMessagesPage('page-modes', { limit: 3 }))).toEqual([
			3, 5, 8
		]);
		// prepend page: newest `limit` below `before`, boundaries exclusive
		expect(
			cursorsOf(await storage.getGroupMessagesPage('page-modes', { before: 5, limit: 2 }))
		).toEqual([2, 3]);
		// append page: oldest `limit` above `after`
		expect(
			cursorsOf(await storage.getGroupMessagesPage('page-modes', { after: 2, limit: 2 }))
		).toEqual([3, 5]);
		expect(
			cursorsOf(await storage.getGroupMessagesPage('page-modes', { after: 2, before: 8, limit: 5 }))
		).toEqual([3, 5]);
		expect(cursorsOf(await storage.getGroupMessagesPage('page-modes', { limit: 0 }))).toEqual([]);
		expect(cursorsOf(await storage.getGroupMessagesPage('page-missing', { limit: 3 }))).toEqual([]);

		await storage.deleteGroup('page-modes');
	});
});

describe('by-kind and by-id reads (memory, ADR 0018 §3)', () => {
	it('returns one kind ascending and cursors for stored ids', async () => {
		const storage = await getChatStorage();
		const id = `kind-${crypto.randomUUID()}`;
		const base = {
			createdAt: 1,
			direction: 'inbound' as const,
			sender: 'ab'.repeat(32),
			tags: [],
			content: 'x'
		};
		await storage.putGroup({
			id,
			coordinatorKey: 'wss://relay.test',
			createdAt: 1,
			lastCursor: 3,
			fetchCursor: 3,
			stateBytes: new Uint8Array([1]),
			messages: [
				{ ...base, cursor: 3, id: 'c', kind: 1012 },
				{ ...base, cursor: 1, id: 'a', kind: 1012 },
				{ ...base, cursor: 2, id: 'b', kind: 1 }
			],
			syncIssues: []
		});
		expect((await storage.getGroupMessagesOfKind(id, 1012)).map((m) => m.cursor)).toEqual([1, 3]);
		const found = await storage.getGroupMessageCursorsById(id, ['b', 'zz']);
		expect([...found]).toEqual([['b', 2]]);
		await storage.deleteGroup(id);
	});
});
