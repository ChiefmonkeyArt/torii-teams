import { describe, expect, it } from 'vitest';

import { ChatKinds } from '$lib/chat/kinds';
import { foldActions } from '$lib/chat/actions';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';
import { mergeActionOps, readActionHistory, scanActionHistory } from './actionHistory.svelte';
import { addSourceToDraft, createOutgoing, resolveGroupRoles, statusOutgoing } from './actionsView';

const ME = 'a'.repeat(64);
const idFor = (cursor: number) => cursor.toString(16).padStart(64, '0');

function row(cursor: number, out?: { content: string; tags: string[][]; kind: number }) {
	return {
		cursor,
		createdAt: 1_000_000 + cursor,
		direction: 'inbound',
		sender: ME,
		id: idFor(cursor),
		kind: out?.kind ?? ChatKinds.Text,
		tags: out?.tags ?? [],
		content: out?.content ?? `message ${cursor}`
	} as StoredChatMessage;
}

/** A fake store: ascending pages below `before`, like getGroupMessagesPage. */
function pager(rows: StoredChatMessage[], limit: number) {
	const calls: (number | undefined)[] = [];
	const getPage = async (before: number | undefined) => {
		calls.push(before);
		const below = rows.filter((r) => before === undefined || r.cursor < before);
		return below.slice(Math.max(0, below.length - limit));
	};
	return { getPage, calls };
}

describe('scanActionHistory', () => {
	// 1..2000 text rows; an action at 1500 citing row 3 and row 1499, then done at 1990.
	const rows: StoredChatMessage[] = [];
	for (let c = 1; c <= 2000; c += 1) rows.push(row(c));
	const create = createOutgoing({
		...addSourceToDraft(null, { eventId: idFor(3), text: 'old talk' }),
		sources: [
			{ id: idFor(3), preview: 'old' },
			{ id: idFor(1499), preview: 'recent' }
		]
	});
	rows[1499] = row(1500, create);
	rows[1989] = row(1990, statusOutgoing(idFor(1500), 'done'));

	it('keeps only action ops, oldest first, across many pages', async () => {
		const { getPage, calls } = pager(rows, 500);
		const history = (await scanActionHistory(getPage))!;
		expect(history.ops.map((m) => m.cursor)).toEqual([1500, 1990]);
		expect(calls).toEqual([undefined, 1501, 1001, 501, 1]);
		const state = foldActions(history.ops, resolveGroupRoles([], [ME]));
		expect(state.byId.get(idFor(1500))?.status).toBe('done');
	});

	it('records cursors of cited sources found below the action', async () => {
		const { getPage } = pager(rows, 500);
		const history = (await scanActionHistory(getPage))!;
		expect(history.sourceCursors.get(idFor(3))).toBe(3);
		expect(history.sourceCursors.get(idFor(1499))).toBe(1499);
		expect(history.sourceCursors.size).toBe(2);
	});

	it('stops when cancelled', async () => {
		const { getPage } = pager(rows, 500);
		expect(await scanActionHistory(getPage, () => true)).toBeNull();
	});
});

describe('mergeActionOps', () => {
	it('unions history and window ops by cursor, ignoring window chat rows', () => {
		const op = (c: number) => row(c, statusOutgoing(idFor(1), 'done'));
		const merged = mergeActionOps([op(5), op(9)], [row(8), op(9), op(12)]);
		expect(merged.map((m) => m.cursor)).toEqual([5, 9, 12]);
	});
});

describe('ensureActionHistory + rememberActionOps', () => {
	it('scans stored history once, then keeps ops seen live', async () => {
		const { getChatStorage } = await import('$lib/storage/chatStorage');
		const mod = await import('./actionHistory.svelte');
		mod.forgetActionHistory();
		const created = row(
			2,
			createOutgoing(addSourceToDraft(null, { eventId: idFor(1), text: 'stored talk' }))
		);
		const storage = await getChatStorage();
		await storage.putGroup({
			id: 'g-hist',
			coordinatorKey: 'aa'.repeat(32),
			createdAt: 1,
			lastCursor: 2,
			fetchCursor: 2,
			stateBytes: new Uint8Array([1]),
			messages: [row(1), created],
			syncIssues: []
		} as never);

		// Before the scan nothing is cached, so live ops are not merged yet.
		mod.rememberActionOps('g-hist', [row(3, statusOutgoing(created.id, 'done'))]);
		expect(mod.getActionHistory('g-hist')).toBeUndefined();

		await Promise.all([mod.ensureActionHistory('g-hist'), mod.ensureActionHistory('g-hist')]);
		const history = mod.getActionHistory('g-hist')!;
		expect(history.ops.map((m) => m.cursor)).toEqual([2]);
		expect(history.sourceCursors.get(idFor(1))).toBe(1);

		mod.rememberActionOps('g-hist', [row(1), row(3, statusOutgoing(created.id, 'done'))]);
		expect(mod.getActionHistory('g-hist')!.ops.map((m) => m.cursor)).toEqual([2, 3]);
		const state = foldActions(mod.getActionHistory('g-hist')!.ops, resolveGroupRoles([], [ME]));
		expect(state.byId.get(created.id)?.status).toBe('done');
		mod.forgetActionHistory();
	});
});

describe('readActionHistory (indexed, ADR 0018 §3)', () => {
	const rows: StoredChatMessage[] = [];
	for (let c = 1; c <= 2000; c += 1) rows.push(row(c));
	rows[1499] = row(
		1500,
		createOutgoing({
			...addSourceToDraft(null, { eventId: idFor(3), text: 'old talk' }),
			sources: [
				{ id: idFor(3), preview: 'old' },
				{ id: idFor(1499), preview: 'recent' }
			]
		})
	);
	rows[1989] = row(1990, statusOutgoing(idFor(1500), 'done'));

	it('matches the full scan while reading only action rows and cited ids', async () => {
		let kindReads = 0;
		const asked: string[][] = [];
		const reader = {
			async getGroupMessagesOfKind(_group: string, kind: number) {
				kindReads += 1;
				return rows.filter((r) => r.kind === kind);
			},
			async getGroupMessageCursorsById(_group: string, ids: string[]) {
				asked.push(ids);
				return new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.cursor]));
			}
		};
		const indexed = await readActionHistory(reader, 'g');
		const scanned = (await scanActionHistory(pager(rows, 500).getPage))!;
		expect(indexed.ops.map((m) => m.cursor)).toEqual(scanned.ops.map((m) => m.cursor));
		expect([...indexed.sourceCursors.entries()].sort()).toEqual(
			[...scanned.sourceCursors.entries()].sort()
		);
		expect(kindReads).toBe(1);
		expect(asked).toEqual([[idFor(3), idFor(1499)]]);
	});

	it('an empty chat costs one kind read and no id lookups of note', async () => {
		const reader = {
			getGroupMessagesOfKind: async () => [],
			getGroupMessageCursorsById: async (_g: string, ids: string[]) => {
				expect(ids).toEqual([]);
				return new Map<string, number>();
			}
		};
		const history = await readActionHistory(reader, 'g');
		expect(history.ops).toEqual([]);
		expect(history.sourceCursors.size).toBe(0);
	});
});
