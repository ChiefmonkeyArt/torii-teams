import { describe, expect, it, vi } from 'vitest';
import { captureInvite, dropInvite, heldInvite } from './inviteLink';

const ID = 'A'.repeat(16);
const SECRET = 'S'.repeat(22);

function win(pathname: string, hash = '', search = '') {
	const m = new Map<string, string>();
	const sessionStorage = {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k)
	};
	const replaceState = vi.fn();
	return {
		w: {
			location: { pathname, hash, search },
			history: { state: { i: 1 }, replaceState },
			sessionStorage
		},
		replaceState,
		sessionStorage
	};
}

describe('captureInvite (ADR 0009)', () => {
	it('moves the link into this tab and wipes it from the address bar', () => {
		const { w, replaceState, sessionStorage } = win(`/chat/join/${ID}`, `#${SECRET}`, '?embed=1');
		expect(captureInvite(w)).toBe(true);
		expect(replaceState).toHaveBeenCalledWith({ i: 1 }, '', '/chat?embed=1');
		expect(heldInvite(sessionStorage)).toEqual({ id: ID, secret: SECRET });
		dropInvite(sessionStorage);
		expect(heldInvite(sessionStorage)).toBeNull();
	});

	it('a malformed link is still wiped, and nothing is kept', () => {
		const { w, replaceState, sessionStorage } = win(`/chat/join/${ID}`, '#nope');
		expect(captureInvite(w)).toBe(false);
		expect(replaceState).toHaveBeenCalledWith({ i: 1 }, '', '/chat');
		expect(heldInvite(sessionStorage)).toBeNull();
	});

	it('leaves every other page alone', () => {
		const { w, replaceState } = win('/chat/p/site', `#${SECRET}`);
		expect(captureInvite(w)).toBe(false);
		expect(replaceState).not.toHaveBeenCalled();
	});

	it('ignores tampered storage', () => {
		const { sessionStorage } = win('/chat');
		sessionStorage.setItem('torii.invite', JSON.stringify({ id: 'x', secret: SECRET }));
		expect(heldInvite(sessionStorage)).toBeNull();
		sessionStorage.setItem('torii.invite', '{bad');
		expect(heldInvite(sessionStorage)).toBeNull();
	});
});
