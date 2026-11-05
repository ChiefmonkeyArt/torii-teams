import { describe, expect, it } from 'vitest';
import {
	INVITE_RETRY_MS,
	PACE_MAX_MS,
	PACE_MIN_MS,
	coordinatorDue,
	needsWelcomeCheck,
	nextPace,
	autoAcceptProject,
	markerSlugs,
	planRosterSync,
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
