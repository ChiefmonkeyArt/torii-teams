import { mount, unmount } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import Harness from './ChatMessageList.test-harness.svelte';
import type { ChatMessage } from './chat.types';

/**
 * Open-at-first-unread anchor reproducer: land the focus flight on a
 * mid-window row, then merge older rows in above the viewport — the open-time
 * window growth (ensureChatGroupWindow) that follows a notification-tap open.
 * The landed row must keep its viewport offset.
 *
 * This was the "lands on the new messages, then quickly jumps higher" race:
 * the virtualizer's derived offsets and the rendered rows both read the
 * reactive `messages` prop directly, so a window merge re-rendered row CONTENT
 * at the stale virtual offsets — the visible content slid up by the prepend
 * delta before any scroll bookkeeping ran, and the prepend anchor then
 * measured/anchored the already-shifted DOM. Rows and estimates now render
 * from a plain snapshot the messages effect swaps atomically with
 * virtualizer.setOptions, and the anchor restores by row identity through the
 * library's own scroll machinery.
 */
const ROWS = 300;
const FOCUS_CURSOR = 250;
const PREPENDED = 60;

function synthMessage(cursor: number): ChatMessage {
	// Pseudo-random lengths (seeded by cursor) give the shape-aware estimates
	// real, non-cancelling variance — a regular pattern sums to the same total
	// when indices shift, hiding exactly the drift this test exists to catch.
	const length = 18 + ((((cursor * 37) % 23) + 23) % 23) * 11;
	return {
		id: `m-${cursor}`,
		eventId: `m-${cursor}`,
		author: 'aa'.repeat(32),
		text: 'x'.repeat(length),
		kind: 9,
		createdAt: 1_700_000_000 + cursor * 60,
		timeLabel: '12:00',
		dayLabel: 'Jan 1',
		cursor
	};
}

function synthMessages(from: number, to: number): ChatMessage[] {
	const rows: ChatMessage[] = [];
	for (let cursor = from; cursor <= to; cursor++) rows.push(synthMessage(cursor));
	return rows;
}

function row(id: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
}

function container(): HTMLElement | null {
	return document.querySelector<HTMLElement>('.overscroll-contain');
}

async function settle(ms: number) {
	for (let i = 0; i < 2; i++) {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, budgetMs = 4000): Promise<boolean> {
	const start = performance.now();
	while (performance.now() - start < budgetMs) {
		if (predicate()) return true;
		await settle(16);
	}
	return predicate();
}

afterEach(() => {
	document.body.innerHTML = '';
});

test('a window prepend after the focus landing keeps the landed row in place', async () => {
	const base = synthMessages(1, ROWS);
	const target = base.find((message) => message.cursor === FOCUS_CURSOR)!;

	const target0 = document.createElement('div');
	document.body.append(target0);
	const harness = mount(Harness, {
		target: target0,
		props: { initialMessages: base, focusCursor: FOCUS_CURSOR }
	});

	// Wait for the focus flight to land: the target row pinned at the viewport
	// top, with the scroll position stable across two samples.
	let lastTop = Number.NaN;
	const landed = await waitFor(() => {
		const element = row(target.id);
		const box = container();
		if (!element || !box || box.scrollTop <= 0) return false;
		const offset = element.getBoundingClientRect().top - box.getBoundingClientRect().top;
		const stable = lastTop === offset;
		lastTop = offset;
		return stable && Math.abs(offset) < 4;
	});
	expect(landed).toBe(true);

	const before = row(target.id)!.getBoundingClientRect().top;

	// The prepend: fresh array identity, like a real store write merging older
	// rows into the window after the chat opened.
	harness.setMessages([...synthMessages(1 - PREPENDED, 0), ...base]);
	await settle(150);

	const afterRow = row(target.id);
	// A null row means the landed row left the rendered window entirely — the
	// jump exceeded the viewport, which is the very race under test.
	const after = afterRow ? afterRow.getBoundingClientRect().top : Number.NaN;
	expect(Number.isFinite(after) && Math.abs(after - before) < 8).toBe(true);

	await unmount(harness);
	target0.remove();
});
