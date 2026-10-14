<script lang="ts">
	import { browser } from '$app/environment';
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { onMount, tick, untrack } from 'svelte';
	import { scale } from 'svelte/transition';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import { Button } from '$lib/components/ui/button';
	import ChatMessageItem from './ChatMessageItem.svelte';
	import { estimateChatMessageHeight } from './chatMessageRenderCache';
	import type { ChatMessage } from './chat.types';

	let {
		messages,
		groupId = '',
		initialFocusCursor = 0,
		ensureMessage,
		onLoadOlder,
		onReply = () => {},
		onReact = () => Promise.resolve(),
		onUnreact = () => Promise.resolve(),
		onEdit = () => {},
		onDelete = () => Promise.resolve(),
		onRetrySend = () => {},
		onVisibleUnreadReference = () => {},
		onVisibleRead = () => {},
		onOpenRich = () => {},
		onPin = () => {},
		onVote = () => Promise.resolve(false),
		unreadReferenceCount = 0,
		onNavigateToReference = () => {}
	}: {
		messages: ChatMessage[];
		/** Group the rows belong to — poll rows self-query their votes from here. */
		groupId?: string;
		/** Unread @-mentions of the viewer: shown as a floating jump button
		 *  stacked above scroll-to-bottom (moved out of the composer). */
		unreadReferenceCount?: number;
		onNavigateToReference?: () => void | Promise<void>;
		/** Open-at-first-unread target cursor, set once per group by ChatShell on
		 *  open (0 = open at the bottom). Cursor-based so a gap start below the
		 *  loaded window can be loaded before landing (docs/long-history.md). */
		initialFocusCursor?: number;
		/** Load the history page around `cursor` (windowed history: jump and focus
		 *  targets may not be loaded yet). */
		ensureMessage?: (cursor: number) => Promise<void>;
		/** Load the next history page below the window; returns the rows fetched
		 *  (falsy = the group's history start was reached). */
		onLoadOlder?: () => Promise<number | void>;
		onReply?: (message: ChatMessage) => void;
		onReact?: (message: ChatMessage, reaction: string) => void | Promise<void>;
		onUnreact?: (message: ChatMessage, reaction: string) => void | Promise<void>;
		onEdit?: (message: ChatMessage) => void;
		onDelete?: (message: ChatMessage) => void | Promise<void>;
		onRetrySend?: (message: ChatMessage) => void | Promise<void>;
		onVisibleUnreadReference?: (message: ChatMessage) => void;
		/** Visibility-based read marking: reports the highest message cursor
		 *  actually on screen (plus whether the viewport sits at the bottom, where
		 *  folded annotations without rows mean "mark everything stored"). Called
		 *  only from settled positions — never mid programmatic-scroll flight. */
		onVisibleRead?: (report: { cursor: number; atBottom: boolean }) => void;
		onOpenRich?: (eventId: string) => void;
		onPin?: (message: ChatMessage) => void;
		/** Cast a poll vote (kind 1018): complete selection of option ids. */
		onVote?: (message: ChatMessage, optionIds: string[]) => void | Promise<boolean>;
	} = $props();
	let container: HTMLDivElement | null = $state(null);
	let highlightedMessageId = $state('');
	let highlightTimeout: number | null = null;
	let unreadReferenceFrame: number | null = null;
	let wasAtBottom = true;
	let showScrollToBottom = $state(false);
	let suppressNextAutoScroll = false;
	// Open-at-first-unread bookkeeping: the focus cursor already consumed, and a
	// monotonic token so a newer programmatic scroll invalidates older in-flight
	// ones (mount → focus and group-switch → focus can overlap mid-await).
	let consumedFocusCursor = 0;
	let scrollRun = 0;
	// History paging (docs/long-history.md): scroll-up prepends older pages.
	let historyExhaustedForGroup = '';
	let loadOlderInFlight = false;
	// The scrollRun value of the last COMPLETED programmatic flight. While
	// scrollRun !== settledRun a flight is mid-air and the visible window is
	// transient (focus jumps pass over the tail) — visibility-based read
	// marking must wait for the final position. Equal values = user scroll only.
	let settledRun = 0;

	const ESTIMATED_MESSAGE_HEIGHT = 128;
	const VIRTUAL_OVERSCAN = 8;

	const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: 0,
		getScrollElement: () => container,
		// Shape-aware estimates shrink the estimate→measure deltas that make
		// first-pass scrolls jump; measured rows keep their real heights.
		estimateSize: (index) =>
			messages[index] ? estimateChatMessageHeight(messages[index]) : ESTIMATED_MESSAGE_HEIGHT,
		overscan: VIRTUAL_OVERSCAN,
		getItemKey: (index) => messages[index]?.id ?? index
	});
	// Class field, not an option (setOptions never touches it), assigned once.
	// ($store reads are safe, but `$store.prop = …` compiles to store.set() and
	// this store is derived/read-only — so assign through a plain local.)
	// Tanstack's default only absorbs above-viewport resizes while scrolling
	// forward — during backward scroll the corrections land as visible jumps.
	// Anchor in both directions; with shape-aware estimates the deltas are small,
	// so anchoring holds the reading position without fighting scroll input.
	// ponytail: mirrors the default minus the direction clause and the private
	// scrollAdjustments term — live scrollTop is close enough.
	const virtualizerInstance = $virtualizer;
	virtualizerInstance.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
		// Never drag a viewport pinned at the bottom: rows settling from estimate to
		// measured height (short text especially) would otherwise pull the freshly
		// opened chat up to a deterministic mid-history spot. At the bottom the
		// browser clamps scrollTop to the shrunken content and the totalSize effect
		// re-pins, so the view stays glued to the latest message.
		const el = container;
		if (el && el.scrollHeight - el.scrollTop - el.clientHeight <= 2) return false;
		return item.start < (el?.scrollTop ?? 0);
	};

	const virtualItems = $derived($virtualizer.getVirtualItems());
	const totalSize = $derived($virtualizer.getTotalSize());
	// The "New messages" line rides the row the focus flight lands on (the first
	// row at/after the focus cursor — the gap start may fall between cursors).
	const focusMarkerId = $derived.by(() => {
		if (initialFocusCursor <= 0) return '';
		return messages.find((message) => (message.cursor ?? 0) >= initialFocusCursor)?.id ?? '';
	});

	async function scrollToLatestMessage() {
		const run = ++scrollRun;
		await tick();
		if (!browser || !container || messages.length === 0 || run !== scrollRun) return;

		$virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
		await tick();
		if (run !== scrollRun) return;
		measureVisibleItems();
		await tick();
		if (run !== scrollRun || !container) return;
		container.scrollTo({
			top: container.scrollHeight,
			behavior: 'instant'
		});
		settledRun = run;
	}

	export async function scrollToBottom() {
		await scrollToLatestMessage();
	}

	export async function scrollToMessage(messageId: string) {
		await tick();
		await navigateToMessage(messageId);
	}

	// scrollToIndex reads measurementsCache — measured rows plus estimates for
	// rows that never rendered. A deep target's estimated offset can overshoot
	// the real content entirely (the jump clamps at the end and the row never
	// mounts), so converge: jump, measure what rendered, jump again with the
	// corrected offsets. Returns the target row or null when it never rendered.
	async function jumpToRow(
		index: number,
		align: 'start' | 'center',
		run: number
	): Promise<HTMLElement | null> {
		for (let attempt = 0; attempt < 3; attempt++) {
			$virtualizer.scrollToIndex(index, { align });
			// The virtual window recomputes on the element's scroll event, which
			// lands after every microtask — wait for the next frame or the row
			// lookup races the render and misses a row that is in fact mounted.
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			await tick();
			if (run !== scrollRun || !container) return null;
			measureVisibleItems();
			await tick();
			if (run !== scrollRun || !container) return null;
			const row = container.querySelector<HTMLElement>(`[data-index="${index}"]`);
			if (row) return row;
		}
		return null;
	}

	// Open-at-first-unread: land with the first unread message (and its "New
	// messages" marker) at the TOP of the viewport, WhatsApp-style. The final
	// position comes from DOM geometry (not another scrollToIndex) so late
	// measurements can't drift it. Cursor-based: the gap start may sit below the
	// loaded window, so load its page first (decision 6). Returns false when no
	// row renders at/after the cursor (consumer falls back to the bottom-pin).
	async function scrollToFocusMessage(focusCursor: number): Promise<boolean> {
		if (!browser || !container) return false;
		let index = messages.findIndex((message) => (message.cursor ?? 0) >= focusCursor);
		if (index === -1 && ensureMessage) {
			// Hold the focus flight across the load: no bottom-pin may claim the
			// scroll while the page loads.
			wasAtBottom = false;
			suppressNextAutoScroll = true;
			await ensureMessage(focusCursor);
			await tick();
			index = messages.findIndex((message) => (message.cursor ?? 0) >= focusCursor);
		}
		if (index === -1) return false;

		consumedFocusCursor = focusCursor;
		// The focus flight owns the scroll: mark "not at bottom" so no auto-scroll
		// actor (message-arrival effect re-runs, the container RO, the totalSize
		// re-pin) can race it back to the latest message mid-flight.
		wasAtBottom = false;
		const run = ++scrollRun;
		// Suppress the totalSize re-pin while measurements settle (same guard
		// navigateToMessage uses).
		suppressNextAutoScroll = true;
		// Anchor to the ROW (not the bubble) so the unread marker renders inside
		// the viewport top; double pass because late measurements keep settling.
		const row = await jumpToRow(index, 'start', run);
		if (run !== scrollRun) return true;
		if (!row) return false; // target vanished mid-flight — fall back to bottom-pin
		positionMessage(row, 'top');
		await tick();
		if (run !== scrollRun) return true;
		positionMessage(row, 'top');
		updateBottomState();
		settledRun = run;
		markVisibleUnreadReferences();
		return true;
	}

	function isAtBottom() {
		if (!container) return true;
		return container.scrollHeight - container.scrollTop - container.clientHeight < 80;
	}

	// Visible-content pass: marks visible unread references (mentions) AND
	// advances the group read cursor to the highest message row actually on
	// screen — the atBottom flag lets the owner mark-everything instead, since
	// rows can't see annotations folded into other rows. Skipped while a
	// programmatic scroll flight is mid-air (see settledRun): the transient
	// window may briefly cover the tail during a focus jump.
	function markVisibleUnreadReferences() {
		if (!browser || !container) return;
		if (scrollRun !== settledRun) return;
		const containerRect = container.getBoundingClientRect();
		let maxVisibleCursor = 0;

		for (const virtualItem of virtualItems) {
			const message = messages[virtualItem.index];
			if (!message) continue;
			const element = container.querySelector<HTMLElement>(`[data-index="${virtualItem.index}"]`);
			if (!element) continue;

			const elementRect = element.getBoundingClientRect();
			const isVisible =
				elementRect.top < containerRect.bottom && elementRect.bottom > containerRect.top;
			if (!isVisible) continue;
			const cursor = message.cursor ?? 0;
			if (cursor > maxVisibleCursor) maxVisibleCursor = cursor;
			if (message.systemKind || !message.unreadReference) continue;
			onVisibleUnreadReference(message);
		}

		if (maxVisibleCursor > 0) onVisibleRead({ cursor: maxVisibleCursor, atBottom: wasAtBottom });
	}

	function scheduleVisibleUnreadReferenceCheck() {
		if (!browser) return;
		if (unreadReferenceFrame !== null) return;
		unreadReferenceFrame = window.requestAnimationFrame(() => {
			unreadReferenceFrame = null;
			markVisibleUnreadReferences();
		});
	}

	function updateBottomState() {
		wasAtBottom = isAtBottom();
		showScrollToBottom = !wasAtBottom;
	}

	function handleScroll() {
		updateBottomState();
		scheduleVisibleUnreadReferenceCheck();
		if (container && container.scrollTop < 240) void handleLoadOlder();
	}

	// Composite message keys are `${eventId}:${cursor}` (raw event ids carry no
	// colon) — the cursor is what pages below the window.
	function parseMessageKeyCursor(messageKey: string): number | undefined {
		const at = messageKey.lastIndexOf(':');
		if (at === -1) return undefined;
		const cursor = Number(messageKey.slice(at + 1));
		return Number.isFinite(cursor) && cursor >= 0 ? cursor : undefined;
	}

	// Scroll-up paging: the anchor math keeps the reading position fixed while
	// rows splice in above. shortcut: exact unless new arrivals land in the same
	// update (their height over-shifts the correction slightly); TanStack's
	// item-size anchoring refines the rest.
	async function handleLoadOlder() {
		if (!onLoadOlder || loadOlderInFlight || historyExhaustedForGroup === groupId) return;
		loadOlderInFlight = true;
		const beforeHeight = container?.scrollHeight ?? 0;
		const beforeTop = container?.scrollTop ?? 0;
		try {
			const loaded = await onLoadOlder();
			await tick();
			if (container) {
				container.scrollTop = beforeTop + (container.scrollHeight - beforeHeight);
			}
			measureVisibleItems();
			if (!loaded) historyExhaustedForGroup = groupId;
		} finally {
			loadOlderInFlight = false;
		}
	}

	// DOM-anchored positioning (immune to virtualizer estimate error above the
	// target): rects are truth, cache-derived translateY offsets are not — see
	// scrollToFocusMessage.
	function positionMessage(element: HTMLElement, align: 'top' | 'center') {
		if (!container) return;
		const containerRect = container.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();
		const currentTop = container.scrollTop;
		const delta =
			align === 'top'
				? elementRect.top - containerRect.top
				: elementRect.top - containerRect.top - container.clientHeight / 2 + elementRect.height / 2;
		container.scrollTo({ top: Math.max(0, currentTop + delta), behavior: 'instant' });
	}

	function measureVisibleItems() {
		if (!browser || !container) return;
		for (const element of container.querySelectorAll<HTMLDivElement>('[data-virtual-item]')) {
			$virtualizer.measureElement(element);
		}
	}

	// Ongoing per-row measurement: the virtualizer's built-in `measureElement`
	// observes each row, so when a row resizes after mount — a media image
	// finishing its async load, or a progress bar appearing — `totalSize` updates.
	// The batch `measureVisibleItems` above is a one-shot; this adds the continuous
	// ResizeObserver that keeps the layout honest post-scroll (one shared RO for
	// all rows, as tanstack ships it).
	function measureItem(node: HTMLDivElement) {
		$virtualizer.measureElement(node);
	}

	onMount(() => {
		// Initial positioning (bottom-pin or first-unread focus) is owned by the
		// messages $effect below — it runs on mount too. Here: keep the container
		// shrink observer (soft keyboard) only.

		// Re-pin to the bottom when the scroll container itself shrinks — most importantly the soft
		// keyboard opening on mobile, and the composer growing a line on desktop — so the latest
		// messages stay visible instead of being clipped off the new bottom edge. Guarded by
		// wasAtBottom (never yank someone reading history). The scroll runs synchronously inside the
		// RO callback, which fires before paint in the same rendering update as the resize — a
		// deferred pin left one painted frame sitting off-bottom, and the correction read as the
		// chat "jumping" on every composer line change.
		const ro = new ResizeObserver(() => {
			if (!container || !wasAtBottom || suppressNextAutoScroll) return;
			container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
		});
		if (container) ro.observe(container);
		return () => {
			ro.disconnect();
		};
	});

	$effect(() => {
		const messageCount = messages.length;
		const lastMessageId = messages.at(-1)?.id;
		if (!browser || !container) return;
		untrack(() => {
			$virtualizer.setOptions({
				count: messageCount,
				getScrollElement: () => container,
				getItemKey: (index) => messages[index]?.id ?? index
			});
		});

		const shouldScroll = wasAtBottom;
		const focusCursor = initialFocusCursor;
		void tick().then(async () => {
			void messageCount;
			void lastMessageId;
			measureVisibleItems();
			if (suppressNextAutoScroll) {
				suppressNextAutoScroll = false;
			} else {
				// Land on the first unread message when the chat opens with one;
				// otherwise keep the classic bottom-pin for new arrivals.
				const focused =
					focusCursor > 0 &&
					focusCursor !== consumedFocusCursor &&
					(await scrollToFocusMessage(focusCursor));
				if (!focused && shouldScroll) await scrollToLatestMessage();
			}
			updateBottomState();
			markVisibleUnreadReferences();
		});
	});

	// Re-pin to the bottom when content resizes while stuck there. Catches async
	// media loads (local blob previews, decrypted fetches) that grow a row AFTER
	// the new-message scroll already ran — the source of the "need to scroll down a
	// bit" gap on media. Guarded by `wasAtBottom` (never yank someone reading
	// history) and `suppressNextAutoScroll` (don't fight a navigate-to-message).
	$effect(() => {
		void totalSize;
		if (!browser || !container) return;
		if (!wasAtBottom || suppressNextAutoScroll) return;
		void tick().then(() => {
			if (wasAtBottom && !suppressNextAutoScroll && container) {
				container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
			}
		});
	});

	async function navigateToMessage(messageId: string) {
		if (!browser || !container) return;
		// Accept the raw event id too: reply quotes on pending bubbles and
		// unavailable-parent stubs carry it (no cursor yet), while rendered
		// messages match on their composite `${eventId}:${cursor}` id. Raw ids
		// can't collide with composite ones (no colon).
		let messageIndex = messages.findIndex(
			(message) => message.id === messageId || message.eventId === messageId
		);
		// Windowed history (docs/long-history.md): the target may not be loaded.
		// Composite keys carry the cursor, so load its page and retry; raw event
		// ids can't be resolved below the window (no id index) and no-op as before.
		if (messageIndex === -1 && ensureMessage) {
			const cursor = parseMessageKeyCursor(messageId);
			if (cursor === undefined) return;
			suppressNextAutoScroll = true;
			await ensureMessage(cursor);
			await tick();
			messageIndex = messages.findIndex(
				(message) => message.id === messageId || message.eventId === messageId
			);
			if (messageIndex === -1) {
				suppressNextAutoScroll = false;
				return;
			}
		}
		if (messageIndex === -1) return;
		const targetId = messages[messageIndex].id;

		suppressNextAutoScroll = true;
		const run = ++scrollRun;
		const element = await jumpToRow(messageIndex, 'center', run);
		if (run !== scrollRun) return;
		if (!element) return;

		highlightedMessageId = targetId;
		if (highlightTimeout) {
			clearTimeout(highlightTimeout);
		}
		highlightTimeout = window.setTimeout(() => {
			highlightedMessageId = '';
		}, 2400);

		positionMessage(element, 'center');
		await tick();
		if (run !== scrollRun) return;
		positionMessage(element, 'center');
		updateBottomState();
		settledRun = run;
		markVisibleUnreadReferences();
	}

	$effect(() => {
		return () => {
			if (unreadReferenceFrame !== null) {
				window.cancelAnimationFrame(unreadReferenceFrame);
			}
			if (highlightTimeout) {
				clearTimeout(highlightTimeout);
			}
		};
	});

	$effect(() => {
		void virtualItems;
		void tick().then(measureVisibleItems);
	});
</script>

<div class="relative h-full">
	<div
		bind:this={container}
		class="h-full overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none]"
		onscroll={handleScroll}
	>
		<div class="mx-auto min-h-full w-full max-w-5xl px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-8">
			<div class="relative w-full" style={`height: ${totalSize}px;`}>
				{#each virtualItems as virtualItem (virtualItem.key)}
					{@const message = messages[virtualItem.index]}
					{#if message}
						{@const previousMessage = messages[virtualItem.index - 1]}
						{@const nextMessage = messages[virtualItem.index + 1]}
						{@const systemRow = Boolean(message.systemKind)}
						{@const runHead = !systemRow && previousMessage?.author !== message.author}
						<!-- Pfp anchors to the NEWEST message of a run (bottom-aligned like Signal): the hop to
							a new tail only mounts an Avatar whose picture prop is already resolved and cached
							(loadedPictures paints it at full opacity instantly), so no fade replays. -->
						{@const runTail = !systemRow && nextMessage?.author !== message.author}
						<div
							data-index={virtualItem.index}
							data-virtual-item
							data-message-id={message.id}
							class="absolute top-0 left-0 w-full pb-4 sm:pb-5 md:pb-6"
							style={`transform: translateY(${virtualItem.start}px);`}
							use:measureItem
						>
							<ChatMessageItem
								{message}
								{groupId}
								showAuthor={runHead}
								showAvatar={runTail}
								showDayLabel={previousMessage?.dayLabel !== message.dayLabel}
								showUnreadMarker={message.id === focusMarkerId}
								{onReply}
								{onReact}
								{onUnreact}
								{onEdit}
								{onDelete}
								{onRetrySend}
								onNavigateToMessage={navigateToMessage}
								{onOpenRich}
								{onPin}
								{onVote}
								highlighted={highlightedMessageId === message.id}
							/>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</div>

	{#if showScrollToBottom || unreadReferenceCount > 0}
		<div class="absolute right-4 bottom-4 z-10 flex flex-col items-end gap-2 md:right-6">
			{#if unreadReferenceCount > 0}
				<Button
					type="button"
					size="icon"
					variant="secondary"
					class="relative h-10 w-10 rounded-full shadow-lg"
					onclick={() => void onNavigateToReference()}
					aria-label="Jump to unread reference"
				>
					<AtSign class="size-4" />
					{#if unreadReferenceCount > 1}
						<span
							class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
						>
							{unreadReferenceCount}
						</span>
					{/if}
				</Button>
			{/if}
			{#if showScrollToBottom}
				<div transition:scale={{ start: 0.8, duration: 150 }}>
					<Button
						type="button"
						size="icon"
						variant="secondary"
						class="h-10 w-10 rounded-full shadow-lg"
						onclick={scrollToBottom}
						aria-label="Scroll to bottom"
					>
						<ChevronDown class="size-5" />
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
