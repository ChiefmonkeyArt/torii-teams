import { describe, expect, it, vi } from 'vitest';

import {
	ContinuumClient,
	ContinuumError,
	matchProjectGroup,
	parseRosterOwner,
	parseRoster,
	parseTeamMe,
	parseRosterTeams,
	projectMarker,
	type GroupLike
} from './continuumApi';

const ME = 'a'.repeat(64);
const OWNER = 'b'.repeat(64);
const COORD = 'c'.repeat(64);
const ORIGIN = 'https://continuum.example.com';
const TOKEN = 'm1.abcdefghijklmnop.sig';

function memStore() {
	const m = new Map<string, string>();
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k),
		m
	};
}

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function server(over: Partial<Record<string, () => Response>> = {}) {
	return vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		if (over[path]) return over[path]!();
		if (path === '/api/auth/challenge')
			return json(200, { challenge: 'f'.repeat(32), expires_in: 300 });
		if (path === '/api/team/auth/verify') {
			const { event } = JSON.parse(String(init?.body));
			expect(event.kind).toBe(22242);
			expect(event.tags).toEqual([['challenge', 'f'.repeat(32)]]);
			return json(200, { token: TOKEN, expires_at: 2_000_000_000 });
		}
		if (path === '/api/team/me') {
			expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
			return json(200, {
				pubkey: ME,
				owner: false,
				projects: [{ slug: 'site', role: 'member', caps: [] }]
			});
		}
		if (path === '/api/projects/site/roster') return json(200, { roster: { owner: OWNER } });
		return json(404, { code: 'not_found' });
	});
}

const signer = (pubkey = ME) => ({
	signEvent: vi.fn(
		async (t: { kind: number; tags: string[][]; content: string; created_at: number }) => ({
			...t,
			pubkey,
			id: '0'.repeat(64),
			sig: '0'.repeat(128)
		})
	)
});

describe('ContinuumClient', () => {
	it('signs a challenge, stores a session and reads /api/team/me', async () => {
		const store = memStore();
		const f = server();
		const c = new ContinuumClient(ORIGIN, {
			fetch: f as never,
			storage: store,
			now: () => 1_900_000_000
		});
		await c.signIn(signer(), ME);
		expect(c.hasSession(ME)).toBe(true);
		expect(c.hasSession(OWNER)).toBe(false);
		const me = await c.me();
		expect(me.projects).toEqual([
			{ slug: 'site', role: 'member', caps: [], chat: false, added: false }
		]);
		expect(me.ready).toBeNull();
		expect(await c.rosterOwner('site')).toBe(OWNER);
		// never the owner admin route, never cookies
		for (const [url, init] of f.mock.calls) {
			expect(url).not.toContain('/api/auth/verify');
			expect((init as RequestInit).credentials).toBe('omit');
		}
		// a fresh client restores the session from storage
		const c2 = new ContinuumClient(ORIGIN, {
			fetch: f as never,
			storage: store,
			now: () => 1_900_000_000
		});
		expect(c2.hasSession(ME)).toBe(true);
	});

	it('rejects a signer that answers with another key', async () => {
		const c = new ContinuumClient(ORIGIN, { fetch: server() as never, storage: memStore() });
		await expect(c.signIn(signer(OWNER), ME)).rejects.toThrow(/another key/);
	});

	it('surfaces use_owner_login and not_member codes', async () => {
		const c = new ContinuumClient(ORIGIN, {
			fetch: server({
				'/api/team/auth/verify': () => json(403, { code: 'use_owner_login' })
			}) as never,
			storage: memStore()
		});
		await expect(c.signIn(signer(), ME)).rejects.toMatchObject({
			status: 403,
			code: 'use_owner_login'
		});
	});

	it('drops the session on 401 and on a reply for another pubkey', async () => {
		const store = memStore();
		let meReply = () => json(401, { code: 'expired' });
		const f = server({ '/api/team/me': () => meReply() });
		const c = new ContinuumClient(ORIGIN, {
			fetch: f as never,
			storage: store,
			now: () => 1_900_000_000
		});
		await c.signIn(signer(), ME);
		await expect(c.me()).rejects.toBeInstanceOf(ContinuumError);
		expect(c.hasSession(ME)).toBe(false);
		expect(store.m.size).toBe(0);
		await c.signIn(signer(), ME);
		meReply = () => json(200, { pubkey: OWNER, projects: [] });
		await expect(c.me()).rejects.toMatchObject({ status: 401 });
		expect(c.hasSession(ME)).toBe(false);
	});

	it('treats an unreadable roster as no owner (fail closed)', async () => {
		const c = new ContinuumClient(ORIGIN, {
			fetch: server({
				'/api/projects/site/roster': () => json(403, { code: 'forbidden' })
			}) as never,
			storage: memStore()
		});
		await c.signIn(signer(), ME);
		expect(await c.rosterOwner('site')).toBeNull();
		expect(await c.rosterOwner('../admin')).toBeNull();
	});

	it('ignores an expired or malformed stored session', () => {
		const store = memStore();
		store.setItem(
			`torii.continuumSession:${ORIGIN}`,
			JSON.stringify({ token: TOKEN, pubkey: ME, expiresAt: 10 })
		);
		expect(
			new ContinuumClient(ORIGIN, { fetch: server() as never, storage: store }).hasSession(ME)
		).toBe(false);
		store.setItem(`torii.continuumSession:${ORIGIN}`, '{bad');
		expect(
			new ContinuumClient(ORIGIN, { fetch: server() as never, storage: store }).hasSession(ME)
		).toBe(false);
	});
});

describe('parsers', () => {
	it('keeps only well-formed projects', () => {
		expect(
			parseTeamMe({
				pubkey: ME,
				projects: [
					{ slug: 'ok', role: 'member' },
					{ slug: 'Bad Slug', role: 'x' },
					null,
					{ slug: 'x' }
				]
			})?.projects
		).toEqual([{ slug: 'ok', role: 'member', caps: [], chat: false, added: false }]);
		expect(parseTeamMe({ pubkey: 'zz', projects: [] })).toBeNull();
		expect(parseRosterOwner({ roster: { owner: 'npub1…' } })).toBeNull();
	});

	it('parses roster members, owner first, junk dropped, no list = null members', () => {
		const A = 'a'.repeat(64);
		expect(
			parseRoster({
				roster: {
					owner: OWNER,
					members: [{ pubkey: A }, { pubkey: A }, { pubkey: 'npub1x' }, null, { pubkey: OWNER }]
				}
			})
		).toEqual({ owner: OWNER, members: [OWNER, A], teams: null });
		expect(parseRoster({ roster: { owner: OWNER } })).toEqual({
			owner: OWNER,
			members: null,
			teams: null
		});
		expect(parseRoster({ roster: null })).toBeNull();
	});
});

describe('matchProjectGroup', () => {
	const base: GroupLike = {
		id: 'g1',
		coordinatorKey: COORD,
		description: `Website work ${projectMarker('site')}`,
		adminPubkeys: [OWNER],
		memberPubkeys: [OWNER, ME]
	};
	it('matches the group on the node coordinator, owned by the project owner, with the marker', () => {
		expect(matchProjectGroup('site', OWNER, COORD, [base])?.id).toBe('g1');
	});
	it.each([
		['no owner known', {}, null],
		['another coordinator', { coordinatorKey: 'd'.repeat(64) }, OWNER],
		['owner not admin', { adminPubkeys: [ME] }, OWNER],
		['owner not a member', { memberPubkeys: [ME], adminPubkeys: null }, OWNER],
		['marker missing', { description: 'site' }, OWNER],
		['marker for a longer slug', { description: projectMarker('site-2') }, OWNER],
		['removed group', { status: 'removed' }, OWNER]
	])('fails closed: %s', (_label, patch, owner) => {
		expect(
			matchProjectGroup('site', owner as string | null, COORD, [{ ...base, ...patch }])
		).toBeNull();
	});
	it('shows nothing when two groups claim the project', () => {
		expect(matchProjectGroup('site', OWNER, COORD, [base, { ...base, id: 'g2' }])).toBeNull();
	});
	it('accepts an all-admin group that includes the owner', () => {
		expect(matchProjectGroup('site', OWNER, COORD, [{ ...base, adminPubkeys: null }])?.id).toBe(
			'g1'
		);
	});
});

describe('membership signals (ADR 0006)', () => {
	it('parses ready / chat / added from /api/team/me and the roster', () => {
		const me = parseTeamMe({
			pubkey: ME,
			ready: true,
			projects: [{ slug: 'site', role: 'viewer', caps: [], chat: true, added: true }]
		});
		expect(me?.ready).toBe(true);
		expect(me?.projects[0]).toMatchObject({ chat: true, added: true });
		expect(parseTeamMe({ pubkey: ME, ready: 'yes', projects: [] })?.ready).toBeNull();
		expect(
			parseRosterTeams({
				chat: { group_id: 'grp-1', claimed: false },
				ready: [ME, ME, 'junk'],
				added: [OWNER]
			})
		).toEqual({ chatGroupId: 'grp-1', claimed: false, ready: [ME], added: [OWNER] });
		expect(parseRosterTeams({ chat: { group_id: 'bad id!' } })?.chatGroupId).toBeNull();
		expect(parseRosterTeams(null)).toBeNull();
	});

	it('posts ready, chat ops and members with the bearer token; 409 codes surface', async () => {
		const posts: Array<[string, unknown]> = [];
		const f = vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url).pathname;
			if (path === '/api/auth/challenge') return json(200, { challenge: 'f'.repeat(32) });
			if (path === '/api/team/auth/verify')
				return json(200, { token: TOKEN, expires_at: 2_000_000_000 });
			expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
			if (init?.method === 'POST') posts.push([path, JSON.parse(String(init.body))]);
			if (path === '/api/projects/site/teams/chat') return json(409, { error: 'claimed' });
			return json(200, { ok: true });
		});
		const c = new ContinuumClient(ORIGIN, {
			fetch: f as never,
			storage: memStore(),
			now: () => 1_900_000_000
		});
		await c.signIn(signer(), ME);
		await c.markReady();
		await c.markMembers('site', [ME, 'junk'], [OWNER]);
		await expect(c.chatOp('site', 'claim')).rejects.toMatchObject({ status: 409, code: 'claimed' });
		await expect(c.chatOp('site', 'set', 'bad id!')).rejects.toThrow(/bad group id/);
		await expect(c.chatOp('../x', 'claim')).rejects.toThrow(/bad slug/);
		expect(posts).toEqual([
			['/api/team/ready', {}],
			['/api/projects/site/teams/members', { added: [ME], removed: [OWNER] }],
			['/api/projects/site/teams/chat', { op: 'claim' }]
		]);
	});

	it('profiles keep only kind-0 events by the asked pubkey; avatars only raster blobs', async () => {
		const ev = { kind: 0, pubkey: ME, content: '{}', tags: [], created_at: 1, id: 'x', sig: 'y' };
		const f = vi.fn(async (url: string) => {
			const u = new URL(url);
			if (u.pathname === '/api/auth/challenge') return json(200, { challenge: 'f'.repeat(32) });
			if (u.pathname === '/api/team/auth/verify')
				return json(200, { token: TOKEN, expires_at: 2_000_000_000 });
			if (u.pathname === '/api/team/profiles') {
				expect(u.searchParams.get('p')).toBe(`${ME},${OWNER}`);
				return json(200, {
					profiles: { [ME]: { event: ev }, [OWNER]: { event: { ...ev, pubkey: ME } } }
				});
			}
			if (u.pathname === `/api/team/avatar/${ME}`)
				return new Response(new Blob([new Uint8Array(16)], { type: 'image/png' }));
			if (u.pathname === `/api/team/avatar/${OWNER}`)
				return new Response(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
			return json(404, {});
		});
		const c = new ContinuumClient(ORIGIN, {
			fetch: f as never,
			storage: memStore(),
			now: () => 1_900_000_000
		});
		expect(await c.avatar(ME)).toBeNull(); // no session yet
		await c.signIn(signer(), ME);
		expect(await c.profiles([ME, OWNER, 'junk'])).toEqual({ [ME]: ev, [OWNER]: null });
		expect((await c.avatar(ME))?.type).toBe('image/png');
		expect(await c.avatar(OWNER)).toBeNull();
	});

	it('a recorded chat id settles two look-alike groups', () => {
		const g = (id: string): GroupLike => ({
			id,
			coordinatorKey: COORD,
			description: projectMarker('site'),
			adminPubkeys: [OWNER],
			memberPubkeys: [OWNER]
		});
		expect(matchProjectGroup('site', OWNER, COORD, [g('a'), g('b')])).toBeNull();
		expect(matchProjectGroup('site', OWNER, COORD, [g('a'), g('b')], 'b')?.id).toBe('b');
		expect(matchProjectGroup('site', OWNER, COORD, [g('a'), g('b')], 'zz')).toBeNull();
	});
});
