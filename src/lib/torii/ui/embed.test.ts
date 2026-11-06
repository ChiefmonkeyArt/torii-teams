import { describe, expect, it } from 'vitest';
import { isEmbedded, navigateTarget } from './embed';

describe('isEmbedded', () => {
	const top = {} as Window;
	it('reads ?embed=1 or a parent frame', () => {
		expect(isEmbedded({ self: top, top } as never, new URL('https://t.x/chat?embed=1'))).toBe(true);
		expect(isEmbedded({ self: top, top } as never, new URL('https://t.x/chat'))).toBe(false);
		expect(isEmbedded({ self: {} as Window, top } as never, new URL('https://t.x/chat'))).toBe(
			true
		);
	});
});

describe('navigateTarget (ADR 0010)', () => {
	const parent = {} as Window;
	const C = 'https://continuum.x';
	const msg = (path: unknown, over: Partial<MessageEvent> = {}) =>
		({ origin: C, source: parent, data: { type: 'torii:navigate', path }, ...over }) as never;
	it('accepts the project list and a project, from Continuum only', () => {
		expect(navigateTarget(msg('/chat'), parent, C)).toBe('');
		expect(navigateTarget(msg('/chat/p/studio-2'), parent, C)).toBe('studio-2');
	});
	it('ignores other origins, other windows, other paths and other messages', () => {
		expect(navigateTarget(msg('/chat', { origin: 'https://evil.x' }), parent, C)).toBeNull();
		expect(navigateTarget(msg('/chat', { source: {} as Window }), parent, C)).toBeNull();
		expect(navigateTarget(msg('/chat'), parent, undefined)).toBeNull();
		for (const bad of [
			'/settings',
			'/chat/p/',
			'/chat/p/Studio',
			'/chat/p/-a',
			'//evil.x',
			'/chat/p/a/b',
			'javascript:x',
			7,
			null
		])
			expect(navigateTarget(msg(bad), parent, C)).toBeNull();
		expect(navigateTarget(msg('/chat/p/' + 'a'.repeat(49)), parent, C)).toBeNull();
		expect(
			navigateTarget(
				{ origin: C, source: parent, data: { type: 'x', path: '/chat' } } as never,
				parent,
				C
			)
		).toBeNull();
	});
});
