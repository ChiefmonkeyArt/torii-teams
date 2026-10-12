import { findImetaTag } from '$lib/services/chatMediaCipher';

/**
 * Reply-quote view building — the single owner of how a quoted parent renders
 * inside a bubble, so optimistic, outbox, and confirmed quotes cannot drift
 * apart. All display fallbacks live here: deleted parents, textless media
 * parents, and parents missing from the local message list.
 */

export interface ReplyQuoteView {
	/** Jump-target id: confirmed quotes use the composite `${eventId}:${cursor}`. */
	id: string;
	author: string;
	text: string;
	deleted?: boolean;
}

export interface ReplyQuoteSource {
	id: string;
	author: string;
	/** Parent's display text with edits already applied by the caller. */
	content: string;
	/** Parent is deleted — `content` is ignored and the renderer shows its tombstone. */
	deleted?: boolean;
	/** Parent's event tags — read only to label textless media parents. */
	tags?: string[][];
}

export function buildReplyQuote(source: ReplyQuoteSource): ReplyQuoteView {
	if (source.deleted) {
		return {
			id: source.id,
			author: source.author,
			text: '',
			deleted: true
		};
	}
	return {
		id: source.id,
		author: source.author,
		// A textless media parent must not render as a blank quote — that reads
		// as "the reply text was dropped".
		text: source.content || quotePlaceholder(source.tags)
	};
}

/**
 * Parent not in the local message list (older than the fetched window, or
 * outside this client's `after` filter — the coordinator never serves it):
 * the thread tags still carry its id and author, so the quote renders instead
 * of silently disappearing.
 */
export function unavailableReplyQuote(parentId: string, parentPubkey: string): ReplyQuoteView {
	return { id: parentId, author: parentPubkey, text: 'Message unavailable' };
}

function quotePlaceholder(tags: string[][] | undefined): string {
	const media = tags ? findImetaTag(tags) : null;
	if (!media) return 'Attachment';
	if (media.mime.startsWith('image/')) return 'Photo';
	if (media.mime.startsWith('video/')) return 'Video';
	if (media.mime.startsWith('audio/')) return 'Voice note';
	return 'Attachment';
}
