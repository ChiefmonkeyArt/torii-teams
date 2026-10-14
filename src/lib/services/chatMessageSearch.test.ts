import { describe, expect, test, vi } from 'vitest';

import { ChatKinds } from '$lib/chat/kinds';
import { getChatStorage, type StoredChatGroupData } from '$lib/storage/chatStorage';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';
import type { StoredChatGroup } from '$lib/services/chatGroups.svelte';

const groups = vi.hoisted(() => new Map<string, StoredChatGroup>());

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/services/chatGroups.svelte', () => ({
	listChatGroups: () => [...groups.values()],
	listChatGroupMembers: () => []
}));
vi.mock('$lib/components/chat/chatGroupDisplay', () => ({
	getChatGroupDisplayTitle: () => 'Group'
}));

import {
	mergeChatMessageSearchResults,
	searchChatMessages,
	searchChatMessagesDeep
} from '$lib/services/chatMessageSearch';

const ALICE = 'cc'.repeat(32);
const BOB = 'dd'.repeat(32);

function makeMessage(
	cursor: number,
	overrides: Partial<StoredChatMessage> = {}
): StoredChatMessage {
	return {
		cursor,
		createdAt: cursor,
		direction: 'inbound',
		sender: BOB,
		id: `m${cursor}`,
		kind: ChatKinds.Text,
		tags: [],
		content: `message ${cursor}`,
		...overrides
	};
}

// m1: original · m2: edit of m1 · m3: reaction target · m4: reaction on m3 ·
// m5: later deleted · m6: the delete event.
const rows: StoredChatMessage[] = [
	makeMessage(1, { sender: ALICE, content: 'hello brave world' }),
	makeMessage(2, {
		sender: ALICE,
		kind: ChatKinds.Edit,
		tags: [['e', 'm1']],
		content: 'hello braver world'
	}),
	makeMessage(3, { sender: ALICE, content: 'plain target here' }),
	makeMessage(4, {
		kind: ChatKinds.Reaction,
		tags: [
			['e', 'm3'],
			['p', ALICE],
			['k', '9']
		],
		content: '👍'
	}),
	makeMessage(5, { sender: ALICE, content: 'goodbye cruel world' }),
	makeMessage(6, {
		sender: ALICE,
		kind: ChatKinds.Deletion,
		tags: [
			['e', 'm5'],
			['k', '9']
		],
		content: ''
	})
];

async function seedFixture() {
	const group = {
		id: 'g',
		coordinatorKey: 'aa'.repeat(32),
		createdAt: 1,
		stateBase64: '',
		lastCursor: 6,
		fetchCursor: 6,
		messages: rows,
		syncIssues: [],
		snapshots: [],
		joinEpoch: 0n,
		status: 'active'
	} as unknown as StoredChatGroup;
	groups.set('g', group);
	const storage = await getChatStorage();
	await storage.putGroup({
		id: 'g',
		coordinatorKey: 'aa'.repeat(32),
		createdAt: 1,
		lastCursor: 6,
		fetchCursor: 6,
		stateBytes: new Uint8Array([1]),
		messages: rows,
		syncIssues: []
	} satisfies StoredChatGroupData);
}

async function runDeep(query: string | string[]): Promise<ReturnType<typeof searchChatMessages>> {
	const batches: ReturnType<typeof searchChatMessages> = [];
	const handle = searchChatMessagesDeep(query, {}, (batch) => batches.push(...batch));
	await handle.done;
	return mergeChatMessageSearchResults(batches);
}

describe('searchChatMessagesDeep', () => {
	test('applies edits and deletes with the sync pass semantics', async () => {
		await seedFixture();

		// Edited message reports under the edit's key with the new content.
		expect((await runDeep('brave')).map((r) => r.messageKey)).toEqual(['m2:2']);
		expect((await runDeep('brave'))[0].snippet).toContain('braver');
		// Deleted message is gone.
		expect(await runDeep('goodbye')).toEqual([]);
		// Reaction text matches resolve through their target row.
		expect((await runDeep('👍')).map((r) => r.messageKey)).toEqual(['m3:3']);
		expect((await runDeep('👍'))[0].snippet).toBe('Reaction 👍 to: plain target here');
	});

	test('full deep scan matches the sync window pass exactly', async () => {
		await seedFixture();
		for (const query of ['brave', 'goodbye', 'target', '👍', 'hello', 'world', 'nothing']) {
			expect(await runDeep(query)).toEqual(searchChatMessages(query));
		}
	});

	test('cancellation resolves cleanly', async () => {
		await seedFixture();
		const handle = searchChatMessagesDeep('hello', {}, () => {});
		handle.cancel();
		await expect(handle.done).resolves.toBeUndefined();
	});
});
