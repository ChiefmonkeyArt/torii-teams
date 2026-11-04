import { describe, expect, it } from 'vitest';
import { isEmbedded } from './embed';

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
