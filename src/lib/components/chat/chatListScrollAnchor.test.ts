import { describe, expect, test } from 'vitest';
import { prependRestoreScrollTop, shouldAnchorPrepend } from './chatListScrollAnchor';

const anchored = {
	hasAppliedList: true,
	firstRowChanged: true,
	atBottom: false,
	flightMidAir: false,
	loadingOlder: false,
	suppressed: false
};

describe('shouldAnchorPrepend', () => {
	test('anchors a quiet prepend while reading history', () => {
		expect(shouldAnchorPrepend(anchored)).toBe(true);
	});

	test('every other scroll owner wins over the anchor', () => {
		expect(shouldAnchorPrepend({ ...anchored, hasAppliedList: false })).toBe(false); // first render
		expect(shouldAnchorPrepend({ ...anchored, firstRowChanged: false })).toBe(false); // tail append
		expect(shouldAnchorPrepend({ ...anchored, atBottom: true })).toBe(false); // bottom pin
		expect(shouldAnchorPrepend({ ...anchored, flightMidAir: true })).toBe(false); // focus/jump flight
		expect(shouldAnchorPrepend({ ...anchored, loadingOlder: true })).toBe(false); // pager anchor
		expect(shouldAnchorPrepend({ ...anchored, suppressed: true })).toBe(false); // suppressed
	});
});

describe('prependRestoreScrollTop', () => {
	test('shifts down by the height prepended above the viewport', () => {
		expect(prependRestoreScrollTop(1000, 6000, 6500)).toBe(1500);
	});

	test('shifts up when rows were trimmed above, clamped at the top', () => {
		expect(prependRestoreScrollTop(1000, 6000, 5800)).toBe(800);
		expect(prependRestoreScrollTop(100, 6000, 5800)).toBe(0);
	});
});
