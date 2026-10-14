/**
 * Unread ledger (docs/long-history.md decision 4): durable per-group facts the
 * unread badge and mention list need, derived once per message so unread counts
 * never scan history. Windowed loading keeps only a slice of each history in the
 * reactive store; the ledger is what makes badge counts exact for the backlog
 * below the loaded window.
 *
 * Rows live in storage (`StoredMessageLedgerRow`), written alongside new
 * message rows by `putGroup`, and backfilled once per group for histories that
 * predate the ledger. The in-memory copy is a read model swapped wholesale on
 * refresh — counts fall back to window-scoped scanning while it is empty.
 */
import {
	MESSAGE_LEDGER_BACKFILL_CURSOR,
	getChatStorage,
	type ChatStorage,
	type StoredMessageLedgerRow
} from '$lib/storage/chatStorage';
import { SYSTEM_MESSAGE_KIND, isStreamHiddenKind } from '$lib/chat/kinds';
import { chatMessageReferencesPubkey } from '$lib/services/chatMentions';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';
import { samePubKey } from '$lib/utils';

export interface MessageLedger {
	/** Cursors that count toward the unread badge (non-system, not our own). */
	countableCursors: Set<number>;
	/** Reference rows below the loaded window: reference cursor → jump-target event id. */
	referenceTargets: Map<number, string>;
}

const EMPTY_LEDGER: MessageLedger = { countableCursors: new Set(), referenceTargets: new Map() };
const ledgers = new Map<string, MessageLedger>();
// Tracked read: deriveds that consult a ledger re-run when a refresh swaps one.
let ledgerEpoch = $state(0);

const BACKFILL_PAGE_SIZE = 500;

function currentLedgerEpoch(): number {
	return ledgerEpoch;
}

/**
 * Row facts for one message, mirroring the unread-scan rules exactly:
 * countable = non-system and not our own (samePubKey against `me`); referencing
 * = `p`-tag to `me` from someone else, with hidden aggregates (poll votes,
 * annotations) pointing at their `e`-tag target because their own rows never
 * render. `me` is the group's owner account at write time.
 */
export function buildMessageLedgerRows(
	groupId: string,
	messages: StoredChatMessage[],
	me: string | undefined
): StoredMessageLedgerRow[] {
	const rows: StoredMessageLedgerRow[] = [];
	for (const message of messages) {
		const countable =
			message.kind !== SYSTEM_MESSAGE_KIND && !(me && samePubKey(message.sender, me));
		let refTargetId: string | undefined;
		if (me && message.sender !== me && chatMessageReferencesPubkey(message.tags, me)) {
			refTargetId = isStreamHiddenKind(message.kind)
				? (message.tags.find((tag) => tag[0] === 'e')?.[1] ?? message.id)
				: message.id;
		}
		if (countable || refTargetId) {
			rows.push({ groupId, cursor: message.cursor, countable, refTargetId });
		}
	}
	return rows;
}

export function getMessageLedger(groupId: string): MessageLedger {
	currentLedgerEpoch();
	return ledgers.get(groupId) ?? EMPTY_LEDGER;
}

export function clearMessageLedgers(): void {
	ledgers.clear();
	ledgerEpoch += 1;
}

export function pruneMessageLedgers(keepGroupIds: Set<string>): void {
	let changed = false;
	for (const groupId of [...ledgers.keys()]) {
		if (!keepGroupIds.has(groupId)) {
			ledgers.delete(groupId);
			changed = true;
		}
	}
	if (changed) ledgerEpoch += 1;
}

/** Fill the in-memory ledgers from storage for each group, running the
 *  one-time backfill first where the sentinel row is missing. Never throws:
 *  a ledger failure degrades unread counts to window scope, it must not break
 *  group loading. Sequential per group — the backfill streams full histories. */
export async function refreshMessageLedgersForGroups(
	groupIds: string[],
	me: string | undefined
): Promise<void> {
	let storage: ChatStorage;
	try {
		storage = await getChatStorage();
	} catch (error) {
		console.error('[chat-unread-ledger] storage unavailable', { error });
		return;
	}
	for (const groupId of groupIds) {
		try {
			await refreshMessageLedger(storage, groupId, me);
		} catch (error) {
			console.error('[chat-unread-ledger] refresh failed', { groupId, error });
		}
	}
}

async function refreshMessageLedger(
	storage: ChatStorage,
	groupId: string,
	me: string | undefined
): Promise<void> {
	const rows = await storage.listMessageLedgerRows(groupId);
	if (!rows.some((row) => row.cursor === MESSAGE_LEDGER_BACKFILL_CURSOR)) {
		const derived: StoredMessageLedgerRow[] = [];
		let after = -Infinity;
		for (;;) {
			const page = await storage.getGroupMessagesPage(groupId, {
				after,
				limit: BACKFILL_PAGE_SIZE
			});
			if (page.length === 0) break;
			derived.push(...buildMessageLedgerRows(groupId, page, me));
			after = page[page.length - 1].cursor;
			if (page.length < BACKFILL_PAGE_SIZE) break;
		}
		derived.push({ groupId, cursor: MESSAGE_LEDGER_BACKFILL_CURSOR });
		await storage.putMessageLedgerRows(derived);
		rows.push(...derived);
	}
	const countableCursors = new Set<number>();
	const referenceTargets = new Map<number, string>();
	for (const row of rows) {
		if (row.cursor < 0) continue;
		if (row.countable) countableCursors.add(row.cursor);
		if (row.refTargetId) referenceTargets.set(row.cursor, row.refTargetId);
	}
	ledgers.set(groupId, { countableCursors, referenceTargets });
	ledgerEpoch += 1;
}
