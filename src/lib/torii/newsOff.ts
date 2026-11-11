// Torii Teams: stands in for `$lib/news/feedItems` in node builds (ADR 0018).
// A Torii build never shows Cordn's News, so its release notes and donation
// card (about 28 KB gzip) are swapped out at build time by the
// `torii-no-news` plugin in vite.config.ts. Same exports, no items.
import type { DonationConfig, NewsFeedItem } from '$lib/news/feedItems';

export type {
	NewsRelease,
	DonationConfig,
	NewsFeedItemKind,
	NewsFeedItem
} from '$lib/news/feedItems';

export const DEFAULT_DONATION: DonationConfig = {
	eyebrow: '',
	body: '',
	ctaLabel: '',
	lnAddress: '',
	recipientPubkey: '',
	dialogTitle: '',
	dialogDescription: ''
};

export function getNewsFeedItems(): NewsFeedItem[] {
	return [];
}
