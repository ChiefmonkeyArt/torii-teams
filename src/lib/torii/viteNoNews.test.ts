import { describe, expect, it } from 'vitest';
import * as feed from '$lib/news/feedItems';
import * as off from './newsOff';
import { isNewsFeed, toriiNoNews } from './viteNoNews';

// ADR 0018 §1: Torii builds swap Cordn's News feed for an empty one.
const load = (env: Record<string, string>, id: string) => {
	const hook = toriiNoNews(env).load as (id: string) => string | null;
	return hook(id);
};
const id = '/repo/src/lib/news/feedItems.ts';

describe('Torii builds leave out Cordn News (ADR 0018)', () => {
	it('swaps the feed only in a Torii node build', () => {
		expect(load({ VITE_TORII_NODE_BUILD: '1' }, id)).toContain('getNewsFeedItems');
		expect(load({}, id)).toBeNull();
		expect(
			load({ VITE_TORII_NODE_BUILD: '1' }, '/repo/src/lib/news/newsReadState.svelte.ts')
		).toBeNull();
	});

	it('matches Windows paths and query suffixes', () => {
		expect(isNewsFeed('C:\\repo\\src\\lib\\news\\feedItems.ts')).toBe(true);
		expect(isNewsFeed(id + '?v=1')).toBe(true);
		expect(isNewsFeed('/repo/src/lib/news/feedItems.test.ts')).toBe(false);
	});

	it('the stand-in has the same exports and no items', () => {
		expect(Object.keys(off).sort()).toEqual(Object.keys(feed).sort());
		expect(off.getNewsFeedItems()).toEqual([]);
		expect(feed.getNewsFeedItems().length).toBeGreaterThan(0);
	});
});
