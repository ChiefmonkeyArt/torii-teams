// Torii node builds never show Cordn's News (ADR 0005), but Rolldown kept its
// release notes in a chunk every page loads (ADR 0012 §3). This Vite plugin
// swaps the feed for an empty one at build time (ADR 0018). Builds without
// VITE_TORII_NODE_BUILD=1 are unchanged.
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const FEED = '/src/lib/news/feedItems.ts';
const STUB = new URL('./newsOff.ts', import.meta.url);

export function isNewsFeed(id: string): boolean {
	return id.split('?')[0].replaceAll('\\', '/').endsWith(FEED);
}

export function toriiNoNews(env: Record<string, string | undefined> = process.env): Plugin {
	return {
		name: 'torii-no-news',
		enforce: 'pre',
		load(id) {
			if (env.VITE_TORII_NODE_BUILD !== '1' || !isNewsFeed(id)) return null;
			return readFileSync(STUB, 'utf8');
		}
	};
}
