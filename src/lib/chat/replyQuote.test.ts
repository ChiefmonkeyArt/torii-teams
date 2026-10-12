import { describe, it, expect } from 'vitest';
import { buildReplyQuote, unavailableReplyQuote } from '$lib/chat/replyQuote';
import { buildImetaTag } from '$lib/services/chatMediaCipher';

function mediaTags(mime: string): string[][] {
	return [
		buildImetaTag({
			url: 'https://cdn.example/blob',
			mime,
			filename: 'file',
			plaintextHashHex: 'a'.repeat(64),
			nonceHex: 'b'.repeat(24),
			version: 'cordn-em-v1'
		})
	];
}

describe('reply quote', () => {
	it('keeps the parent text and identity', () => {
		expect(
			buildReplyQuote({ id: 'e1:1', author: 'pub', authorLabel: 'Ann', content: 'hello' })
		).toEqual({ id: 'e1:1', author: 'pub', authorLabel: 'Ann', text: 'hello' });
	});

	it('marks deleted parents without inventing text', () => {
		const quote = buildReplyQuote({
			id: 'e1:1',
			author: 'pub',
			content: 'gone',
			deleted: true
		});
		expect(quote.deleted).toBe(true);
		expect(quote.text).toBe('');
	});

	it('labels textless media parents instead of rendering a blank quote', () => {
		expect(
			buildReplyQuote({ id: 'e:1', author: 'p', content: '', tags: mediaTags('image/png') }).text
		).toBe('Photo');
		expect(
			buildReplyQuote({ id: 'e:1', author: 'p', content: '', tags: mediaTags('video/mp4') }).text
		).toBe('Video');
		expect(
			buildReplyQuote({ id: 'e:1', author: 'p', content: '', tags: mediaTags('audio/ogg') }).text
		).toBe('Voice note');
		expect(buildReplyQuote({ id: 'e:1', author: 'p', content: '', tags: [] }).text).toBe(
			'Attachment'
		);
	});

	it('prefers caption text over the media placeholder', () => {
		expect(
			buildReplyQuote({ id: 'e:1', author: 'p', content: 'caption', tags: mediaTags('image/png') })
				.text
		).toBe('caption');
	});

	it('still quotes parents missing from the local list', () => {
		expect(unavailableReplyQuote('parent-id', 'parent-pub')).toEqual({
			id: 'parent-id',
			author: 'parent-pub',
			text: 'Message unavailable'
		});
	});
});
