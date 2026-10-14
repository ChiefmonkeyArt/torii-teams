import { describe, expect, test, vi } from 'vitest';
import { ChatKinds } from '$lib/chat/kinds';
import type { StoredChatGroup } from './chatGroups.svelte';

const groups = vi.hoisted(() => new Map<string, StoredChatGroup>());

vi.mock('$app/environment', () => ({ browser: false }));

vi.mock('$lib/services/nativeBridge', () => ({
	clearShownNotifications: () => Promise.resolve()
}));

const account = vi.hoisted(() => ({ pubkey: 'ee'.repeat(32) }));

vi.mock('$lib/services/accountManager.svelte', () => ({
	manager: { active: account }
}));

vi.mock('$lib/services/chatGroups.svelte', () => ({
	getChatGroup: (id: string) => groups.get(id),
	listChatGroups: () => [...groups.values()],
	areChatGroupsLoaded: () => true,
	listChatGroupMessages: (id: string) => {
		const group = groups.get(id);
		return group ? [...group.messages].sort((a, b) => a.cursor - b.cursor) : [];
	}
}));

import {
	getChatGroupLastReadCursor,
	getChatGroupSummary,
	getUnreadChatGroupMessageCount,
	listUnreadChatGroupReferenceTargets,
	markAllChatGroupsRead,
	markChatGroupMentionsRead,
	markChatGroupRead
} from './chatGroupPresence.svelte';
import { getChatStorage } from '$lib/storage/chatStorage';
import { refreshMessageLedgersForGroups } from '$lib/services/chatUnreadLedger.svelte';

const MEMBER = 'cc'.repeat(32);
const MENTIONED = 'dd'.repeat(32);

function seedGroup(id: string, cursors: number[]): void {
	const lastCursor = Math.max(...cursors);
	groups.set(id, {
		id,
		coordinatorKey: 'aa'.repeat(32),
		createdAt: 1,
		stateBase64: '',
		lastCursor,
		fetchCursor: lastCursor,
		messages: cursors.map((cursor, index) => ({
			cursor,
			createdAt: cursor,
			direction: 'inbound' as const,
			sender: MEMBER,
			id: `${id}-${index}`,
			kind: 9,
			tags: index === 0 ? [['p', MENTIONED]] : [],
			content: `message ${index}`
		})),
		syncIssues: [],
		snapshots: [],
		joinEpoch: 0n,
		status: 'active'
	});
}

describe('chat group presence unread scans', () => {
	test('own messages never count as unread', () => {
		seedGroup('presence-own', [10, 20, 30]);
		// The coordinator echoes our send back with its assigned cursor, `direction: 'inbound'`.
		const group = groups.get('presence-own')!;
		group.messages.push({
			cursor: 40,
			createdAt: 40,
			direction: 'inbound' as const,
			sender: account.pubkey,
			id: 'presence-own-self',
			kind: 9,
			tags: [],
			content: 'sent from this account'
		});
		group.lastCursor = 40;
		expect(getUnreadChatGroupMessageCount('presence-own')).toBe(3);
	});

	test('counts unread messages until the read cursor catches up', () => {
		seedGroup('presence-g1', [10, 20, 30]);
		expect(getUnreadChatGroupMessageCount('presence-g1')).toBe(3);

		markChatGroupRead('presence-g1', 30);
		// Exercises the lastCursor O(1) guard: no full-history rescan needed.
		expect(getUnreadChatGroupMessageCount('presence-g1')).toBe(0);
	});

	test('lists unread mention references and stops once the mention cursor catches up', () => {
		seedGroup('presence-g2', [10, 20]);
		const targets = listUnreadChatGroupReferenceTargets('presence-g2', MENTIONED);
		expect(targets).toHaveLength(1); // only the first message carries the p tag
		expect(targets[0]?.reference.id).toBe('presence-g2-0');

		markChatGroupMentionsRead('presence-g2', 20);
		// Exercises the lastCursor O(1) guard on the mention path.
		expect(listUnreadChatGroupReferenceTargets('presence-g2', MENTIONED)).toEqual([]);
	});

	test('mention scan ignores messages from the referenced account itself', () => {
		seedGroup('presence-g3', [10]);
		expect(listUnreadChatGroupReferenceTargets('presence-g3', MEMBER)).toEqual([]);
	});

	test('markAllChatGroupsRead clears every group, unread or not, without touching storage shape', () => {
		seedGroup('presence-all-1', [10]);
		seedGroup('presence-all-2', [5, 15]);
		// One group already partially read — must still end fully read.
		markChatGroupMentionsRead('presence-all-1', 5);
		markAllChatGroupsRead();
		expect(getUnreadChatGroupMessageCount('presence-all-1')).toBe(0);
		expect(getUnreadChatGroupMessageCount('presence-all-2')).toBe(0);
		expect(listUnreadChatGroupReferenceTargets('presence-all-1', MENTIONED)).toEqual([]);
		expect(listUnreadChatGroupReferenceTargets('presence-all-2', MENTIONED)).toEqual([]);
	});

	test('omitted read marks cover stored messages above the ingest counter', () => {
		// Records can carry stored messages whose cursors exceed group.lastCursor
		// (legacy/never-refetched history). Marking only the counter used to leave
		// the open-at-first-unread scan re-finding the same "unread" on every open
		// while the badge fast-path (group.lastCursor <= lastReadCursor) said zero.
		// Omitted-cursor marks (sidebar action, at-bottom visibility) keep covering
		// the full high-water; explicit visibility marks can't regress this because
		// they only ever mark cursors of rows that actually rendered.
		const id = 'presence-stale-counter';
		seedGroup(id, [1, 2, 3]);
		const group = groups.get(id)!;
		group.lastCursor = 2;
		markChatGroupRead(id);
		expect(getUnreadChatGroupMessageCount(id)).toBe(0);
		expect(
			group.messages.find((message) => message.cursor > getChatGroupLastReadCursor(id))
		).toBeUndefined();
	});

	test('explicit read cursors are exact visibility marks, not clamped upward', () => {
		// Opening a chat mid-backlog must only read what's on screen: stopping
		// partway keeps the rest unread so the marker resumes where reading
		// stopped. The old blanket clamp would have read everything here.
		const id = 'presence-partial';
		seedGroup(id, [10, 20, 30]);
		markChatGroupRead(id, 20);
		expect(getUnreadChatGroupMessageCount(id)).toBe(1);
	});

	test('preview follows copy-on-write history updates', () => {
		// The preview memo keys on the messages array identity; store writes
		// replace the array (never mutate it), so a new ref must recompute.
		const id = 'presence-preview';
		seedGroup(id, [10, 20]);
		expect(getChatGroupSummary(id).preview).toBe('message 1');
		// Stable across repeated reads (the memo hit path).
		expect(getChatGroupSummary(id).preview).toBe('message 1');

		const group = groups.get(id)!;
		groups.set(id, {
			...group,
			lastCursor: 30,
			fetchCursor: 30,
			messages: [
				...group.messages,
				{
					cursor: 30,
					createdAt: 30,
					direction: 'inbound' as const,
					sender: MEMBER,
					id: `${id}-2`,
					kind: 9,
					tags: [],
					content: 'message 2'
				}
			]
		});
		expect(getChatGroupSummary(id).preview).toBe('message 2');
	});

	test('preview follows description changes even when the history array is carried', () => {
		// Carried-ref spreads (e.g. group adoption) can change metadata without
		// replacing messages — the summary cache must not serve the old fallback.
		const id = 'presence-preview-meta';
		groups.set(id, {
			id,
			coordinatorKey: 'aa'.repeat(32),
			createdAt: 1,
			stateBase64: '',
			lastCursor: 0,
			fetchCursor: 0,
			messages: [],
			metadata: { name: 'presence-preview-meta', description: 'first' },
			syncIssues: [],
			snapshots: [],
			joinEpoch: 0n,
			status: 'active'
		} as StoredChatGroup);
		expect(getChatGroupSummary(id).preview).toBe('first');

		const group = groups.get(id)!;
		groups.set(id, {
			...group,
			metadata: { name: 'presence-preview-meta', description: 'second' }
		} as StoredChatGroup);
		expect(getChatGroupSummary(id).preview).toBe('second');
	});

	test('unread reference targets resolve annotation targets through the id map', () => {
		// Annotations (reactions/edits/deletes) resolve their target via byEventId;
		// plain mentions take the lazy no-map path covered by the tests above.
		const id = 'presence-annot';
		groups.set(id, {
			id,
			coordinatorKey: 'aa'.repeat(32),
			createdAt: 1,
			stateBase64: '',
			lastCursor: 20,
			fetchCursor: 20,
			messages: [
				{
					cursor: 10,
					createdAt: 10,
					direction: 'inbound' as const,
					sender: MEMBER,
					id: `${id}-target`,
					kind: 9,
					tags: [],
					content: 'original'
				},
				{
					cursor: 20,
					createdAt: 20,
					direction: 'inbound' as const,
					sender: MEMBER,
					id: `${id}-reaction`,
					kind: 7,
					tags: [
						['e', `${id}-target`],
						['p', MENTIONED]
					],
					content: '❤️'
				}
			],
			syncIssues: [],
			snapshots: [],
			joinEpoch: 0n,
			status: 'active'
		});
		const targets = listUnreadChatGroupReferenceTargets(id, MENTIONED);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.reference.id).toBe(`${id}-reaction`);
		expect(targets[0]?.target.id).toBe(`${id}-target`);
	});

	test('unread reference targets attach poll votes to the poll row', () => {
		// Vote rows are hidden aggregates (never rendered), so their references
		// must resolve to the poll row — that is what the visibility pass clears.
		const id = 'presence-poll';
		groups.set(id, {
			id,
			coordinatorKey: 'aa'.repeat(32),
			createdAt: 1,
			stateBase64: '',
			lastCursor: 20,
			fetchCursor: 20,
			messages: [
				{
					cursor: 10,
					createdAt: 10,
					direction: 'inbound' as const,
					sender: MEMBER,
					id: `${id}-poll`,
					kind: ChatKinds.Poll,
					tags: [['option', '0', 'Yay']],
					content: 'Pineapple on pizza?'
				},
				{
					cursor: 20,
					createdAt: 20,
					direction: 'inbound' as const,
					sender: MEMBER,
					id: `${id}-vote`,
					kind: ChatKinds.PollResponse,
					tags: [
						['e', `${id}-poll`],
						['p', MENTIONED],
						['response', '0']
					],
					content: ''
				}
			],
			syncIssues: [],
			snapshots: [],
			joinEpoch: 0n,
			status: 'active'
		});
		const targets = listUnreadChatGroupReferenceTargets(id, MENTIONED);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.reference.id).toBe(`${id}-vote`);
		expect(targets[0]?.target.id).toBe(`${id}-poll`);
	});
});

describe('unread ledger below the loaded window', () => {
	test('counts ledger rows the window no longer holds without double-counting loaded ones', async () => {
		const id = 'presence-ledger-counts';
		seedGroup(id, [30, 40]); // the loaded window
		const storage = await getChatStorage();
		await storage.putMessageLedgerRows([
			{ groupId: id, cursor: 10, countable: true },
			{ groupId: id, cursor: 20, countable: true },
			{ groupId: id, cursor: 30, countable: true } // loaded → counted by the window
		]);
		await refreshMessageLedgersForGroups([id], account.pubkey);

		expect(getUnreadChatGroupMessageCount(id)).toBe(4); // 10, 20 + window 30, 40
		markChatGroupRead(id, 30);
		expect(getUnreadChatGroupMessageCount(id)).toBe(1); // only 40
	});

	test('lists ledger mention rows below the window and skips loaded ones', async () => {
		const id = 'presence-ledger-mentions';
		seedGroup(id, [30]); // cursor 30 mentions MENTIONED (index 0 carries the p tag)
		const storage = await getChatStorage();
		await storage.putMessageLedgerRows([
			{ groupId: id, cursor: 5, refTargetId: 'ev-5' },
			{ groupId: id, cursor: 30, refTargetId: `${id}-0` } // loaded → listed once
		]);
		await refreshMessageLedgersForGroups([id], account.pubkey);

		const targets = listUnreadChatGroupReferenceTargets(id, MENTIONED);
		expect(targets.map((entry) => entry.reference.cursor)).toEqual([5, 30]);
		expect(targets[1]?.target.id).toBe(`${id}-0`);
	});
});
