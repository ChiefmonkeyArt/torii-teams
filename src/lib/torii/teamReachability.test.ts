import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_COORDINATOR_PUBKEY } from '$lib/constants/chat';
import {
	isSeededCordnCoordinator,
	shouldAutoCover,
	teamReachability,
	teamReadyAckKey
} from './teamReachability';

const NODE = 'a'.repeat(64);
const ME = 'b'.repeat(64);
const snap = (over: Partial<Parameters<typeof teamReachability>[2]> = {}) => ({
	checked: true,
	ownerPubkey: ME,
	uncoveredCoordinatorKeys: [] as string[],
	coveredCoordinatorKeys: [] as string[],
	...over
});

describe('teamReachability', () => {
	it('is ready only when the node coordinator verified a key package', () => {
		expect(teamReachability(NODE, ME, snap({ coveredCoordinatorKeys: [NODE] }))).toBe('ready');
	});
	it('is missing when the node coordinator verified none', () => {
		expect(teamReachability(NODE, ME, snap({ uncoveredCoordinatorKeys: [NODE] }))).toBe('missing');
	});
	it('stays checking when unverified, unchecked, another account or no node', () => {
		expect(teamReachability(NODE, ME, snap())).toBe('checking');
		expect(
			teamReachability(NODE, ME, snap({ checked: false, coveredCoordinatorKeys: [NODE] }))
		).toBe('checking');
		expect(
			teamReachability(
				NODE,
				ME,
				snap({ ownerPubkey: 'c'.repeat(64), coveredCoordinatorKeys: [NODE] })
			)
		).toBe('checking');
		expect(teamReachability('', ME, snap({ coveredCoordinatorKeys: [NODE] }))).toBe('checking');
		expect(teamReachability(NODE, '', snap({ coveredCoordinatorKeys: [NODE] }))).toBe('checking');
	});
	it('matches an upper-case node key', () => {
		expect(teamReachability(NODE.toUpperCase(), ME, snap({ coveredCoordinatorKeys: [NODE] }))).toBe(
			'ready'
		);
	});
	it('keys the dismissal per member', () => {
		expect(teamReadyAckKey(ME)).toBe(`torii.teamReadyAck:${ME}`);
	});
});

describe('isSeededCordnCoordinator', () => {
	const seed = {
		pubkey: DEFAULT_CHAT_COORDINATOR_PUBKEY,
		label: 'Default coordinator',
		isDefault: false
	};
	it('matches only the exact torii.2 seed', () => {
		expect(isSeededCordnCoordinator(seed)).toBe(true);
		expect(isSeededCordnCoordinator({ ...seed, label: 'My Cordn' })).toBe(false);
		expect(isSeededCordnCoordinator({ ...seed, isDefault: true })).toBe(false);
		expect(isSeededCordnCoordinator({ ...seed, pubkey: NODE })).toBe(false);
	});
});

describe('shouldAutoCover', () => {
	const cordn = DEFAULT_CHAT_COORDINATOR_PUBKEY;
	it('covers everything on upstream builds', () => {
		expect(shouldAutoCover(cordn, false, new Set())).toBe(true);
	});
	it('skips Cordn on node builds unless used on purpose', () => {
		expect(shouldAutoCover(cordn, true, new Set())).toBe(false);
		expect(shouldAutoCover(cordn, true, new Set([cordn]))).toBe(true);
		expect(shouldAutoCover(NODE, true, new Set())).toBe(true);
	});
});
