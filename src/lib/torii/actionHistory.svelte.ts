/**
 * Torii Teams — whole-history action log (J1 slice 3).
 *
 * The chat screen only holds a window of recent messages, so folding that
 * window alone hides older actions. When a group opens we walk its stored
 * history once, newest page first, keeping only action ops (and the cursors
 * of the messages they cite, so "show source" can jump below the window).
 * New ops keep arriving through the live window and are merged on top.
 *
 * Cost: one read pass over local storage per group per session; only action
 * ops are retained in memory.
 */
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

import { ChatKinds } from '$lib/chat/kinds';
import { parseActionOp } from '$lib/chat/actions';
import { getChatStorage } from '$lib/storage/chatStorage';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';

export const ACTION_SCAN_PAGE_ROWS = 500;

export interface ActionHistory {
	/** Action ops from stored history, ascending by cursor. */
	ops: StoredChatMessage[];
	/** Cursor of each cited source message found in history. */
	sourceCursors: Map<string, number>;
}

/**
 * Walk history newest-first via `getPage(before)` (ascending pages, exclusive
 * bound, `[]` at the start). Sources normally precede the action that cites
 * them, so one pass resolves their cursors.
 */
export async function scanActionHistory(
	getPage: (before: number | undefined) => Promise<StoredChatMessage[]>,
	isCancelled: () => boolean = () => false
): Promise<ActionHistory | null> {
	const ops: StoredChatMessage[] = [];
	const wanted = new Set<string>();
	const sourceCursors = new Map<string, number>();
	let before: number | undefined;
	for (;;) {
		if (isCancelled()) return null;
		const page = await getPage(before);
		if (page.length === 0) break;
		before = page[0].cursor;
		for (let index = page.length - 1; index >= 0; index -= 1) {
			const message = page[index];
			if (wanted.has(message.id)) {
				sourceCursors.set(message.id, message.cursor);
				wanted.delete(message.id);
			}
			if (message.kind !== ChatKinds.Action) continue;
			ops.push(message);
			const op = parseActionOp(message.kind, message.content, message.tags);
			if (op?.op === 'create') {
				for (const id of op.sources) if (!sourceCursors.has(id)) wanted.add(id);
			}
		}
	}
	ops.reverse();
	return { ops, sourceCursors };
}

/** Union of history ops and the live window's ops, deduped by cursor. */
export function mergeActionOps(
	history: StoredChatMessage[],
	window: StoredChatMessage[]
): StoredChatMessage[] {
	const byCursor = new Map<number, StoredChatMessage>();
	for (const message of history) byCursor.set(message.cursor, message);
	for (const message of window) {
		if (message.kind === ChatKinds.Action) byCursor.set(message.cursor, message);
	}
	return [...byCursor.values()].sort((a, b) => a.cursor - b.cursor);
}

const histories = new SvelteMap<string, ActionHistory>();
const inFlight = new Map<string, Promise<void>>();

export function getActionHistory(groupId: string): ActionHistory | undefined {
	return histories.get(groupId);
}

/** Load a group's action history once per session (deduped). */
export function ensureActionHistory(groupId: string): Promise<void> {
	if (histories.has(groupId)) return Promise.resolve();
	const running = inFlight.get(groupId);
	if (running) return running;
	const task = (async () => {
		try {
			const storage = await getChatStorage();
			const history = await scanActionHistory((before) =>
				storage.getGroupMessagesPage(groupId, { before, limit: ACTION_SCAN_PAGE_ROWS })
			);
			if (history) histories.set(groupId, history);
		} catch (error) {
			// Not fatal: the panel still folds the live window.
			console.warn('[torii-teams] action history scan failed', error);
		} finally {
			inFlight.delete(groupId);
		}
	})();
	inFlight.set(groupId, task);
	return task;
}

/**
 * Fold live-window ops into the cached history so they survive the window
 * evicting its newest rows (deep scroll-back). No-op until the scan finished,
 * and when nothing is new. Untracked: safe to call from an effect.
 */
export function rememberActionOps(groupId: string, window: StoredChatMessage[]): void {
	untrack(() => {
		const history = histories.get(groupId);
		if (!history) return;
		const known = new Set(history.ops.map((m) => m.cursor));
		const fresh = window.filter((m) => m.kind === ChatKinds.Action && !known.has(m.cursor));
		if (fresh.length === 0) return;
		histories.set(groupId, {
			ops: mergeActionOps(history.ops, fresh),
			sourceCursors: history.sourceCursors
		});
	});
}

/** Drop cached histories (sign-out, group removal, tests). */
export function forgetActionHistory(groupId?: string): void {
	if (groupId) histories.delete(groupId);
	else histories.clear();
}
