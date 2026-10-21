import { describe, expect, test } from 'vitest';
import { shouldAnchorPrepend } from './chatListScrollAnchor';

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
