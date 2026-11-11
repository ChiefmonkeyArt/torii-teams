import { describe, expect, it } from 'vitest';
import {
	OWNER_QUICK_FOR_MS,
	OWNER_QUICK_MS,
	ownerQuickCheckDue,
	waitingKey,
	INVITE_RETRY_MS,
	PACE_MAX_MS,
	PACE_MIN_MS,
	coordinatorDue,
	needsWelcomeCheck,
	nextPace,
	autoAcceptProject,
	markerSlugs,
	planRosterSync,
	planOwnerSignals,
	nextWelcomePace,
	welcomeDue,
	WELCOME_MIN_MS,
	WELCOME_MAX_MS,
	waitingMembers
} from './rosterPlan';

const O = 'a'.repeat(64);
const A = 'b'.repeat(64);
const B = 'c'.repeat(64);
const C = 'd'.repeat(64);
const X = 'e'.repeat(64);
const N = 'f'.repeat(64);

describe('planRosterSync', () => {
	const base = { me: O, owner: O, roster: [O, A, B], available: new Set([A]) };

	it('does nothing on a non-owner client or an unreadable roster', () => {
		expect(planRosterSync({ ...base, me: A, groupMembers: null }).create).toBe(false);
		expect(planRosterSync({ ...base, owner: null, groupMembers: null }).create).toBe(false);
		expect(planRosterSync({ ...base, roster: undefined, groupMembers: [O] })).toEqual({
			create: false,
			invite: [],
			remove: [],
			waiting: []
		});
		expect(planRosterSync({ ...base, roster: [A, B], groupMembers: [O] }).invite).toEqual([]);
	});

	it('creates the chat when there is none', () => {
		const p = planRosterSync({ ...base, groupMembers: null });
		expect(p.create).toBe(true);
		expect(p.invite).toEqual([]);
		expect(p.waiting).toEqual([A, B]);
	});

	it('invites members with key packages and lists the rest as waiting', () => {
		const p = planRosterSync({ ...base, groupMembers: [O] });
		expect(p).toEqual({ create: false, invite: [A], remove: [], waiting: [B] });
	});

	it('skips members already in the chat', () => {
		expect(planRosterSync({ ...base, groupMembers: [O, A] }).invite).toEqual([]);
	});

	it('backs off a failed invite for 10 minutes', () => {
		const now = 1_000_000_000;
		const recent = planRosterSync({
			...base,
			groupMembers: [O],
			failedAt: { [A]: now - 1000 },
			now
		});
		expect(recent.invite).toEqual([]);
		expect(recent.waiting).toContain(A);
		const later = planRosterSync({
			...base,
			groupMembers: [O],
			failedAt: { [A]: now - INVITE_RETRY_MS },
			now
		});
		expect(later.invite).toEqual([A]);
	});

	it('removes people who left the roster, never the owner', () => {
		const p = planRosterSync({ ...base, groupMembers: [O, A, B, X] });
		expect(p.remove).toEqual([X]);
	});

	it('never removes more than half the chat at once', () => {
		const p = planRosterSync({ ...base, roster: [O], groupMembers: [O, A, B, X] });
		expect(p.remove).toEqual([]);
		const half = planRosterSync({ ...base, roster: [O, A], groupMembers: [O, A, B, X] });
		expect(half.remove).toEqual([B, X]);
	});
});

describe('waitingMembers', () => {
	it('lists roster members not in the chat', () => {
		expect(waitingMembers([O, A, B], [O, A])).toEqual([B]);
		expect(waitingMembers(undefined, [O])).toEqual([]);
	});
});

describe('markerSlugs', () => {
	it('reads exact markers only', () => {
		expect(markerSlugs('Site torii:project=site')).toEqual(['site']);
		expect(markerSlugs('torii:project=Site torii:project=-x xtorii:project=a')).toEqual([]);
		expect(markerSlugs(undefined)).toEqual([]);
		expect(markerSlugs('torii:project=a torii:project=b')).toEqual(['a', 'b']);
	});
});

describe('autoAcceptProject', () => {
	const ctx = {
		nodeCoordinator: N,
		projects: new Set(['site']),
		owners: { site: O },
		rosters: { site: [O, A, B] }
	};
	const ok = { coordinatorKey: N, description: 'torii:project=site', memberPubkeys: [O, A] };

	it('accepts a welcome that matches every rule', () => {
		expect(autoAcceptProject(ok, ctx)).toBe('site');
	});

	it('rejects anything else', () => {
		expect(autoAcceptProject({ ...ok, coordinatorKey: X }, ctx)).toBeNull();
		expect(autoAcceptProject({ ...ok, description: 'hello' }, ctx)).toBeNull();
		expect(
			autoAcceptProject({ ...ok, description: 'torii:project=site torii:project=other' }, ctx)
		).toBeNull();
		expect(autoAcceptProject({ ...ok, description: 'torii:project=other' }, ctx)).toBeNull();
		expect(autoAcceptProject({ ...ok, memberPubkeys: [A, B] }, ctx)).toBeNull();
		expect(autoAcceptProject({ ...ok, memberPubkeys: [O, A, C] }, ctx)).toBeNull();
		expect(autoAcceptProject(ok, { ...ctx, rosters: {} })).toBeNull();
		expect(autoAcceptProject(ok, { ...ctx, owners: { site: null } })).toBeNull();
		expect(autoAcceptProject(ok, { ...ctx, nodeCoordinator: '' })).toBeNull();
	});
});

describe('signer pacing', () => {
	it('doubles while idle, caps, and resets on progress', () => {
		expect(nextPace(PACE_MIN_MS, false)).toBe(PACE_MIN_MS * 2);
		expect(nextPace(PACE_MAX_MS, false)).toBe(PACE_MAX_MS);
		expect(nextPace(PACE_MAX_MS, true)).toBe(PACE_MIN_MS);
	});
	it('is due on the first pass and after the pace only', () => {
		expect(coordinatorDue(1000, null, PACE_MIN_MS)).toBe(true);
		expect(coordinatorDue(PACE_MIN_MS - 1, 0, PACE_MIN_MS)).toBe(false);
		expect(coordinatorDue(PACE_MIN_MS, 0, PACE_MIN_MS)).toBe(true);
	});
	it('checks welcomes only for a project of someone else with no chat here', () => {
		const owners = { a: 'me', b: 'boss' };
		expect(needsWelcomeCheck(['a'], owners, 'me', () => false)).toBe(false);
		expect(needsWelcomeCheck(['a', 'b'], owners, 'me', (s) => s === 'b')).toBe(false);
		expect(needsWelcomeCheck(['a', 'b'], owners, 'me', () => false)).toBe(true);
	});
});

describe('planOwnerSignals (ADR 0006)', () => {
	const teams = (over = {}) => ({
		chatGroupId: null,
		claimed: false,
		ready: [],
		added: [],
		...over
	});
	const base = { me: O, owner: O, roster: [O, A, B], slug: 'site', now: 1_000_000_000 };

	it('only the owner acts, on a readable roster', () => {
		expect(planOwnerSignals({ ...base, me: A, localGroup: null, teams: teams() }).chat).toBe(
			'wait'
		);
		expect(
			planOwnerSignals({ ...base, roster: undefined, localGroup: null, teams: teams() }).chat
		).toBe('wait');
	});

	it('creates a chat nobody has claimed, once per retry window', () => {
		expect(planOwnerSignals({ ...base, localGroup: null, teams: teams() }).chat).toBe('create');
		expect(
			planOwnerSignals({
				...base,
				localGroup: null,
				teams: teams(),
				attemptedAt: { 'chat:site': base.now - 1000 }
			}).chat
		).toBe('wait');
	});

	it('never duplicates a chat claimed or recorded by another device', () => {
		expect(
			planOwnerSignals({ ...base, localGroup: null, teams: teams({ claimed: true }) }).chat
		).toBe('elsewhere');
		expect(
			planOwnerSignals({ ...base, localGroup: null, teams: teams({ chatGroupId: 'g' }) }).chat
		).toBe('elsewhere');
		expect(
			planOwnerSignals({
				...base,
				localGroup: { id: 'other', memberPubkeys: [O] },
				teams: teams({ chatGroupId: 'g' })
			}).chat
		).toBe('elsewhere');
	});

	it('records an existing local chat (torii.4/5 migration)', () => {
		const p = planOwnerSignals({
			...base,
			localGroup: { id: 'g', memberPubkeys: [O, A] },
			teams: teams()
		});
		expect(p.chat).toBe('record');
		expect(p.markAdded).toEqual([A]);
	});

	it('invites only ready members, each at most once per retry window', () => {
		const localGroup = { id: 'g', memberPubkeys: [O] };
		const t = teams({ chatGroupId: 'g', ready: [A] });
		const p = planOwnerSignals({ ...base, localGroup, teams: t });
		expect(p).toMatchObject({ chat: 'ok', invite: [A], waiting: [B], remove: [] });
		const again = planOwnerSignals({
			...base,
			localGroup,
			teams: t,
			attemptedAt: { [A]: base.now - 60_000 }
		});
		expect(again.invite).toEqual([]);
		expect(again.waiting).toEqual([A, B]);
		expect(
			planOwnerSignals({
				...base,
				localGroup,
				teams: t,
				attemptedAt: { [A]: base.now - INVITE_RETRY_MS }
			}).invite
		).toEqual([A]);
	});

	it('removes people taken off the roster (never more than half) and reports both ways', () => {
		const p = planOwnerSignals({
			...base,
			roster: [O, A],
			localGroup: { id: 'g', memberPubkeys: [O, A, X] },
			teams: teams({ chatGroupId: 'g', added: [A, X, B] })
		});
		expect(p.remove).toEqual([X]);
		expect(p.markAdded).toEqual([]);
		expect(p.markRemoved).toEqual([B]);
		const many = planOwnerSignals({
			...base,
			roster: [O],
			localGroup: { id: 'g', memberPubkeys: [O, A, B] },
			teams: teams({ chatGroupId: 'g' })
		});
		expect(many.remove).toEqual([]);
	});

	it('member welcome checks: only projects the owner added us to, backing off to 30 min', () => {
		const projects = [
			{ slug: 'a', added: true },
			{ slug: 'b', added: false },
			{ slug: 'c', added: true },
			{ slug: 'mine', added: true }
		];
		expect(welcomeDue(projects, { a: O, b: O, c: O, mine: A }, A, (s) => s === 'c')).toEqual(['a']);
		let pace = WELCOME_MIN_MS;
		const seen = [pace];
		for (let i = 0; i < 8; i++) seen.push((pace = nextWelcomePace(pace)));
		expect(seen.slice(0, 5)).toEqual([60_000, 120_000, 240_000, 480_000, 960_000]);
		expect(seen.at(-1)).toBe(WELCOME_MAX_MS);
	});
});

describe('owner quick check (ADR 0019)', () => {
	it('keys the waiting list stably and skips empty projects', () => {
		expect(waitingKey({ b: ['y'], a: ['x', 'z'], c: [] })).toBe('a:x,a:z,b:y');
		expect(waitingKey({ a: [], b: undefined })).toBe('');
	});

	it('is due every 15 s while someone waits, for 15 minutes', () => {
		const base = { key: 'a:x', since: 0, lastAt: 0 };
		expect(ownerQuickCheckDue({ ...base, now: OWNER_QUICK_MS - 1 })).toBe(false);
		expect(ownerQuickCheckDue({ ...base, now: OWNER_QUICK_MS })).toBe(true);
		expect(ownerQuickCheckDue({ ...base, lastAt: 600_000, now: 615_000 })).toBe(true);
		expect(ownerQuickCheckDue({ ...base, lastAt: 885_000, now: OWNER_QUICK_FOR_MS })).toBe(false);
	});

	it('never runs with nobody waiting', () => {
		expect(ownerQuickCheckDue({ key: '', since: 0, lastAt: 0, now: 20_000 })).toBe(false);
	});
});
