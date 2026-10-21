/**
 * Scroll-anchoring math for window prepends in ChatMessageList (pure and
 * DOM-free so the decision table is unit-testable). When older rows merge in
 * above the viewport — `ensureChatGroupWindow`'s tail growth on open, the
 * focus flight's around-loads — the browser keeps scrollTop at the same pixel
 * and nothing re-anchors it, so the view slides up into old history. That is
 * the notification-open race: the focus flight lands on the first unread,
 * then the window grows above it and the chat "jumps higher".
 */
export interface PrependAnchorGuard {
	/** A previous list was applied — not this list instance's first render. */
	hasAppliedList: boolean;
	/** The first row's id changed — rows were added (or trimmed) at the top. */
	firstRowChanged: boolean;
	/** The viewport is bottom-pinned; the bottom-pin actors own the scroll. */
	atBottom: boolean;
	/** A programmatic scroll flight is mid-air (scrollRun !== settledRun). */
	flightMidAir: boolean;
	/** The scroll-up pager is anchoring its own load (handleLoadOlder). */
	loadingOlder: boolean;
	/** A navigate/focus flight asked to suppress auto-scrolls. */
	suppressed: boolean;
}

export function shouldAnchorPrepend(guard: PrependAnchorGuard): boolean {
	return (
		guard.hasAppliedList &&
		guard.firstRowChanged &&
		!guard.atBottom &&
		!guard.flightMidAir &&
		!guard.loadingOlder &&
		!guard.suppressed
	);
}

/**
 * scrollTop that keeps the viewport on the same rows after the content above
 * it changed: shift by the height delta (negative for top trims, clamped at
 * 0). shortcut: exact for prepend-only updates; rows appended in the same
 * write over-shift by their height — the known sources (tail/around loads)
 * are prepend-only, same trade-off handleLoadOlder makes.
 */
export function prependRestoreScrollTop(
	scrollTop: number,
	prevScrollHeight: number,
	nextScrollHeight: number
): number {
	return Math.max(0, scrollTop + (nextScrollHeight - prevScrollHeight));
}
