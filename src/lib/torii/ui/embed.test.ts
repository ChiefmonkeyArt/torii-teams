import { describe, expect, it } from 'vitest';
import { isEmbedded, navigateTarget, rosterChangedSlug, rosterSyncedAnswer } from './embed';

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

// ADR 0015: answering Continuum after a roster-changed pass.
describe('rosterChangedSlug', () => {
	const parent = {};
	const ok = {
		origin: 'https://c.example',
		source: parent,
		data: { type: 'torii:roster-changed', slug: 'studio' }
	};
	it('takes the slug only from the parent at the exact origin', () => {
		expect(rosterChangedSlug(ok as never, parent, 'https://c.example')).toBe('studio');
		expect(
			rosterChangedSlug(
				{ ...ok, origin: 'https://evil.example' } as never,
				parent,
				'https://c.example'
			)
		).toBeNull();
		expect(
			rosterChangedSlug({ ...ok, source: {} } as never, parent, 'https://c.example')
		).toBeNull();
		expect(rosterChangedSlug(ok as never, parent, undefined)).toBeNull();
	});
	it('ignores other messages and bad slugs', () => {
		for (const data of [
			{ type: 'torii:navigate', slug: 'studio' },
			{ type: 'torii:roster-changed', slug: null },
			{ type: 'torii:roster-changed', slug: '../x' },
			null
		])
			expect(rosterChangedSlug({ ...ok, data } as never, parent, 'https://c.example')).toBeNull();
	});
});

describe('rosterSyncedAnswer', () => {
	const me = 'a'.repeat(64);
	const bob = 'b'.repeat(64);
	const eve = 'e'.repeat(64);
	const base = { slug: 'studio', me, owner: me, roster: [me, bob], failed: false };
	it('counts people in the chat but off the list, never the owner', () => {
		expect(rosterSyncedAnswer({ ...base, groupMembers: [me, bob] })).toEqual({
			type: 'torii:roster-synced',
			slug: 'studio',
			left: 0,
			error: false
		});
		expect(rosterSyncedAnswer({ ...base, groupMembers: [me, bob, eve] }).left).toBe(1);
		expect(rosterSyncedAnswer({ ...base, roster: [bob], groupMembers: [me, bob] }).left).toBe(0);
	});
	it('reports an error for a failed pass, no chat here, or not the owner', () => {
		expect(rosterSyncedAnswer({ ...base, groupMembers: [me], failed: true }).error).toBe(true);
		expect(rosterSyncedAnswer({ ...base, groupMembers: null }).error).toBe(true);
		expect(rosterSyncedAnswer({ ...base, owner: bob, groupMembers: [me] }).error).toBe(true);
		expect(rosterSyncedAnswer({ ...base, me: '', groupMembers: [me] }).error).toBe(true);
	});
	it('carries no keys', () => {
		expect(
			JSON.stringify(rosterSyncedAnswer({ ...base, groupMembers: [me, bob, eve] }))
		).not.toMatch(/[0-9a-f]{64}/);
	});
});
