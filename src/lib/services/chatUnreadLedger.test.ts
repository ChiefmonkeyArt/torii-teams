import { describe, expect, test } from 'vitest';

import { ChatKinds, SYSTEM_MESSAGE_KIND } from '$lib/chat/kinds';
import { getChatStorage, type StoredChatGroupData } from '$lib/storage/chatStorage';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';
import {
	buildMessageLedgerRows,
	clearMessageLedgers,
	getMessageLedger,
	refreshMessageLedgersForGroups
} from '$lib/services/chatUnreadLedger.svelte';

const ME = 'ee'.repeat(32);
const MEMBER = 'cc'.repeat(32);

function makeMessage(
	cursor: number,
	overrides: Partial<StoredChatMessage> = {}
): StoredChatMessage {
	return {
		cursor,
		createdAt: 1_000 + cursor,
		direction: 'inbound',
		sender: MEMBER,
		id: `ev-${cursor}`,
		kind: ChatKinds.Text,
		tags: [],
		content: `message ${cursor}`,
		...overrides
	};
}

describe('buildMessageLedgerRows', () => {
	test('derives countable and reference facts with the unread-scan rules', () => {
		const rows = buildMessageLedgerRows(
			'g',
			[
				makeMessage(1, { kind: SYSTEM_MESSAGE_KIND }), // system rows never badge
				makeMessage(2, { sender: ME }), // our own send never badges
				// Owner checks are samePubKey, like every sender check in the codebase:
				// a signer returning a differently-cased pubkey is still us — neither a
				// badge row nor a mention row.
				makeMessage(7, { sender: ME.toUpperCase(), tags: [['p', ME]] }),
				makeMessage(3),
				makeMessage(4, { tags: [['p', ME]] }), // plain mention: self-targeted
				// Hidden aggregate (reaction): its own row never renders, so it points
				// at its `e`-tag target.
				makeMessage(5, {
					kind: ChatKinds.Reaction,
					tags: [
						['e', 'ev-3'],
						['p', ME]
					]
				}),
				makeMessage(6, { tags: [['p', 'ff'.repeat(32)]] }) // references someone else
			],
			ME
		);
		expect(rows).toEqual([
			{ groupId: 'g', cursor: 3, countable: true, refTargetId: undefined },
			{ groupId: 'g', cursor: 4, countable: true, refTargetId: 'ev-4' },
			{ groupId: 'g', cursor: 5, countable: true, refTargetId: 'ev-3' },
			{ groupId: 'g', cursor: 6, countable: true, refTargetId: undefined }
		]);
	});
});

describe('refreshMessageLedgersForGroups', () => {
	test('backfills histories that predate the ledger and is idempotent', async () => {
		const storage = await getChatStorage();
		const id = `ledger-${crypto.randomUUID()}`;
		const group: StoredChatGroupData = {
			id,
			coordinatorKey: 'aa'.repeat(32),
			createdAt: 1,
			lastCursor: 4,
			fetchCursor: 4,
			stateBytes: new Uint8Array([1]),
			messages: [1, 2, 3, 4].map((cursor) =>
				makeMessage(cursor, { tags: cursor === 2 ? [['p', ME]] : [] })
			),
			syncIssues: []
		};
		await storage.putGroup(group);

		await refreshMessageLedgersForGroups([id], ME);
		expect([...getMessageLedger(id).countableCursors].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
		expect(getMessageLedger(id).referenceTargets.get(2)).toBe('ev-2');

		// The backfill sentinel stops a rescan; counts stay exact.
		await refreshMessageLedgersForGroups([id], ME);
		expect(getMessageLedger(id).countableCursors.size).toBe(4);

		clearMessageLedgers();
		expect(getMessageLedger(id).countableCursors.size).toBe(0);
		await storage.deleteGroup(id);
	});
});
