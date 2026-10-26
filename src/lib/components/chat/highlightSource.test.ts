import { describe, expect, test } from 'vitest';
import { highlightSource } from './highlightSource';

const EVENT_ID = 'aa'.repeat(32);
const PUBKEY = 'bb'.repeat(32);

describe('highlightSource', () => {
	test('e tag resolves to a nostr.at nevent link', () => {
		const source = highlightSource([['e', EVENT_ID]]);
		expect(source?.label).toBe('Nostr event');
		expect(source?.href).toMatch(/^https:\/\/nostr\.at\/nevent1/);
	});

	test('a tag resolves to a nostr.at naddr link', () => {
		const source = highlightSource([['a', `30023:${PUBKEY}:my-article`]]);
		expect(source?.label).toBe('Nostr article');
		expect(source?.href).toMatch(/^https:\/\/nostr\.at\/naddr1/);
	});

	test('malformed a-tag coordinates fall through to the next source', () => {
		const source = highlightSource([
			['a', 'not-coords'],
			['r', 'https://example.com/post']
		]);
		expect(source?.label).toBe('example.com');
		expect(source?.href).toBe('https://example.com/post');
	});

	test('e tag with a non-hex id is skipped, not fatal', () => {
		const source = highlightSource([
			['e', 'zzzz'],
			['r', 'https://example.com']
		]);
		expect(source?.href).toBe('https://example.com');
	});

	test('r tag with a URL labels by hostname and links out', () => {
		const source = highlightSource([['r', 'https://example.com/some/long/path']]);
		expect(source).toEqual({ label: 'example.com', href: 'https://example.com/some/long/path' });
	});

	test('r tag with free text is a plain label with no link', () => {
		const source = highlightSource([['r', 'Paper edition, page 12']]);
		expect(source).toEqual({ label: 'Paper edition, page 12' });
	});

	test('r tags with the mention attribute are comment mentions, not sources', () => {
		expect(highlightSource([['r', 'https://example.com', 'mention']])).toBeNull();
	});

	test('i tags render as a raw label, linked only when they are URLs', () => {
		expect(highlightSource([['i', 'isbn:9780123456789']])).toEqual({
			label: 'isbn:9780123456789'
		});
		expect(highlightSource([['i', 'https://pod.example.com/ep/42']])).toEqual({
			label: 'pod.example.com',
			href: 'https://pod.example.com/ep/42'
		});
	});

	test('non-source tags (p attribution) never resolve', () => {
		expect(highlightSource([['p', PUBKEY, '', 'author']])).toBeNull();
		expect(highlightSource([])).toBeNull();
	});
});
