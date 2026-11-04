import { describe, expect, it } from 'vitest';
import { toriiRedirect } from './routes';

const base = { search: '', pending: false, groupId: '', projectForGroup: () => null };

describe('toriiRedirect', () => {
	it('keeps the team routes', () => {
		expect(toriiRedirect({ ...base, pathname: '/chat' })).toBeNull();
		expect(toriiRedirect({ ...base, pathname: '/chat/p/site' })).toBeNull();
	});

	it('sends everything else to /chat, keeping embed', () => {
		expect(toriiRedirect({ ...base, pathname: '/' })).toBe('/chat');
		expect(toriiRedirect({ ...base, pathname: '/why', search: '?embed=1' })).toBe('/chat?embed=1');
		expect(toriiRedirect({ ...base, pathname: '/chat/news' })).toBe('/chat');
		expect(toriiRedirect({ ...base, pathname: '/chat/p/Bad_Slug' })).toBe('/chat');
	});

	it('maps a group link to its project once projects are loaded', () => {
		const projectForGroup = (g: string) => (g === 'g1' ? 'site' : null);
		expect(
			toriiRedirect({ ...base, pathname: '/chat/x', groupId: 'g1', projectForGroup, pending: true })
		).toBeNull();
		expect(toriiRedirect({ ...base, pathname: '/chat/x', groupId: 'g1', projectForGroup })).toBe(
			'/chat/p/site'
		);
		expect(toriiRedirect({ ...base, pathname: '/chat/x', groupId: 'g2', projectForGroup })).toBe(
			'/chat'
		);
	});
});
