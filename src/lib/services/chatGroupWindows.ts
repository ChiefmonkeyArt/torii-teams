/**
 * Pure message-window math (docs/long-history.md decision 1): merge and cap the
 * bounded history window the reactive store keeps per group. Kept dependency-
 * free (type-only message import) so the eviction rules are unit-testable
 * without dragging the chat service graph in.
 */
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';

/** Rows kept for groups nobody has opened. */
export const IDLE_WINDOW_ROWS = 50;
/** Tail rows the open group's window always holds. */
export const TAIL_WINDOW_ROWS = 300;
/** Hard cap on a group's window (see capWindowRows). */
export const MAX_WINDOW_ROWS = 2_000;
/** Rows per history page (scroll-up / around a jump target). */
export const HISTORY_PAGE_ROWS = 200;

/** Copy-on-write merge: deduped by cursor (windowed ingest and recovery may
 *  re-offer rows the window already holds), sorted ascending. */
export function mergeWindowMessages(
	existing: StoredChatMessage[],
	incoming: StoredChatMessage[]
): StoredChatMessage[] {
	const byCursor = new Map<number, StoredChatMessage>();
	for (const message of existing) byCursor.set(message.cursor, message);
	for (const message of incoming) byCursor.set(message.cursor, message);
	return [...byCursor.values()].sort((a, b) => a.cursor - b.cursor);
}

/**
 * Bound the window: evict from `side`, never below the newest
 * TAIL_WINDOW_ROWS. 'low' for tail growth (ingest), 'high' for history growth
 * (scroll-up/jump pages) so a long reading session trims the rows it already
 * passed — next to the tail window — instead of what it is reading.
 * shortcut: ingest growth trims the oldest rows even if they are on screen (it
 * takes a full cap plus a parked reader to notice), upgrade to region-aware
 * eviction if that ever bites.
 */
export function capWindowRows(
	messages: StoredChatMessage[],
	side: 'low' | 'high'
): StoredChatMessage[] {
	if (messages.length <= MAX_WINDOW_ROWS) return messages;
	const excess = messages.length - MAX_WINDOW_ROWS;
	if (side === 'low') return messages.slice(excess);
	const keepFrom = messages.length - TAIL_WINDOW_ROWS;
	return [...messages.slice(0, Math.max(0, keepFrom - excess)), ...messages.slice(keepFrom)];
}
