import { beforeEach, describe, expect, test, vi } from 'vitest';

const activePubkeyMock = vi.fn((): string | undefined => undefined);
const listChatGroupsMock = vi.fn((): { coordinatorKey: string }[] => []);

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/services/accountManager.svelte', () => ({
	manager: {
		getActive: () => {
			const pubkey = activePubkeyMock();
			return pubkey ? { pubkey } : undefined;
		},
		active: undefined
	}
}));
vi.mock('$lib/services/chatGroups.svelte', () => ({
	listChatGroups: () => listChatGroupsMock()
}));
vi.mock('$lib/services/chatKeyPackages.svelte', () => ({
	listChatKeyPackages: () => []
}));

import {
	getChatCoordinator,
	isAutoCoverageRetired,
	markCoordinatorRelaysChecked,
	markCoordinatorRelaysResolved,
	markCoordinatorUsed,
	retireAutoCoverage,
	upsertChatCoordinator
} from './chatCoordinators.svelte';

describe('markCoordinatorRelaysResolved (SDK-resolved persistence, fill-if-empty)', () => {
	const resolved = ['wss://discovered.example.com', 'wss://discovered2.example.com'];

	test('fills a known relay-less coordinator; never creates an unknown one', () => {
		const known = 'ee'.repeat(32);
		markCoordinatorUsed(known); // stored without relays
		markCoordinatorRelaysResolved(known, resolved);
		expect(getChatCoordinator(known)?.relays).toEqual(resolved);

		// Unknown coordinator (e.g. removed while its client was resolving): no entry.
		const unknown = 'ff'.repeat(32);
		markCoordinatorRelaysResolved(unknown, resolved);
		expect(getChatCoordinator(unknown)).toBeUndefined();
	});

	test('never overwrites user-set or hint-adopted relays; ignores empty results', () => {
		const key = 'ab'.repeat(32);
		const pinned = ['wss://pinned.example.com'];
		upsertChatCoordinator({ pubkey: key, relays: pinned });
		markCoordinatorRelaysResolved(key, resolved);
		expect(getChatCoordinator(key)?.relays).toEqual(pinned);

		const hintAdopted = 'cd'.repeat(32);
		markCoordinatorUsed(hintAdopted, resolved); // document hints adopted
		markCoordinatorRelaysResolved(hintAdopted, ['wss://other.example.com']);
		expect(getChatCoordinator(hintAdopted)?.relays).toEqual(resolved);

		const bare = 'ef'.repeat(32);
		markCoordinatorUsed(bare);
		markCoordinatorRelaysResolved(bare, []);
		expect(getChatCoordinator(bare)?.relays).toEqual([]);
	});
});

describe('markCoordinatorUsed relay-hint adoption (spec §4.1/§9)', () => {
	const hints = ['wss://relay.example.com', 'wss://backup.example.com'];

	test('document hints fill a brand-new coordinator entry', () => {
		const key = 'aa'.repeat(32);
		markCoordinatorUsed(key, hints);
		expect(getChatCoordinator(key)?.relays).toEqual(hints);
	});

	test('document hints fill an existing relay-less entry (adopted earlier without hints)', () => {
		const key = 'bb'.repeat(32);
		markCoordinatorUsed(key); // first adoption: no hints in the document
		expect(getChatCoordinator(key)?.relays).toEqual([]);
		markCoordinatorUsed(key, hints); // later fast-forward carries hints
		expect(getChatCoordinator(key)?.relays).toEqual(hints);
	});

	test('locally configured relays always win over document hints', () => {
		const key = 'cc'.repeat(32);
		const local = ['wss://manually-fixed.example.com'];
		upsertChatCoordinator({ pubkey: key, relays: local });
		markCoordinatorUsed(key, hints);
		expect(getChatCoordinator(key)?.relays).toEqual(local);
	});

	test('empty or absent hints are a no-op', () => {
		const key = 'dd'.repeat(32);
		markCoordinatorUsed(key, []);
		markCoordinatorUsed(key);
		expect(getChatCoordinator(key)?.relays).toEqual([]);
	});
});

describe('upsertChatCoordinator label semantics', () => {
	test('undefined label preserves a user-set label; blank label resets to the auto default', () => {
		const key = 'ab'.repeat(32);
		upsertChatCoordinator({ pubkey: key, label: 'My relay' });
		// Pubkey-only touch (profile start-chat, share-link registration) must not
		// clobber the user's label.
		upsertChatCoordinator({ pubkey: key });
		expect(getChatCoordinator(key)?.label).toBe('My relay');
		// Explicit blank (edit-form clear) falls back to the auto default so
		// getCoordinatorLabel can prefer the server-announced name again.
		upsertChatCoordinator({ pubkey: key, label: '   ' });
		expect(getChatCoordinator(key)?.label).toBe(`Coordinator ${key.slice(0, 8)}`);
	});
});

describe('relaysResolvedAt staleness marker', () => {
	test('stamped on relay writes, preserved on unrelated upserts, bumped by checks', () => {
		const key = '12'.repeat(32);
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
		// No relays → no marker (auto-resolving coordinators are never "stale").
		upsertChatCoordinator({ pubkey: key });
		expect(getChatCoordinator(key)?.relaysResolvedAt).toBeUndefined();
		// Relay write → stamped.
		upsertChatCoordinator({ pubkey: key, relays: ['wss://one.example.com'] });
		expect(getChatCoordinator(key)?.relaysResolvedAt).toBe(1000);
		// Unrelated label-only upsert must not silence the refresh sweep.
		nowSpy.mockReturnValue(2000);
		upsertChatCoordinator({ pubkey: key, label: 'Renamed' });
		expect(getChatCoordinator(key)?.relaysResolvedAt).toBe(1000);
		// A check bumps the marker without touching the relay set.
		nowSpy.mockReturnValue(3000);
		markCoordinatorRelaysChecked(key);
		expect(getChatCoordinator(key)?.relaysResolvedAt).toBe(3000);
		expect(getChatCoordinator(key)?.relays).toEqual(['wss://one.example.com']);
		// A fresh relay write re-stamps.
		nowSpy.mockReturnValue(4000);
		upsertChatCoordinator({ pubkey: key, relays: ['wss://two.example.com'] });
		expect(getChatCoordinator(key)?.relaysResolvedAt).toBe(4000);
		nowSpy.mockRestore();
	});

	test('markCoordinatorRelaysChecked is a no-op for unknown coordinators', () => {
		markCoordinatorRelaysChecked('34'.repeat(32));
		expect(getChatCoordinator('34'.repeat(32))).toBeUndefined();
	});
});

describe('automatic-coverage retirement (per owner, device-local)', () => {
	const OWNER_A = 'aa'.repeat(32);
	const OWNER_B = 'bb'.repeat(32);
	// Distinct coordinator keys per test: the in-memory store persists across
	// tests in this file, so each test's arrange must not depend on order.
	const COORD_1 = 'c1'.repeat(16);
	const COORD_2 = 'c2'.repeat(16);
	const COORD_3 = 'c3'.repeat(16);
	const COORD_4 = 'c4'.repeat(16);

	beforeEach(() => {
		activePubkeyMock.mockReturnValue(OWNER_A);
		listChatGroupsMock.mockReturnValue([]);
	});

	test('retirement is scoped to the owner that adopted the retraction', () => {
		markCoordinatorUsed(COORD_1); // creates the shared profile under A

		retireAutoCoverage(OWNER_A, [COORD_1]);

		expect(isAutoCoverageRetired(OWNER_A, COORD_1)).toBe(true);
		// Same browser, another identity: its coverage is untouched.
		expect(isAutoCoverageRetired(OWNER_B, COORD_1)).toBe(false);
	});

	test('usage re-arms only the acting owner; the other keeps its retirement', () => {
		markCoordinatorUsed(COORD_2); // profile under A
		activePubkeyMock.mockReturnValue(OWNER_B);
		markCoordinatorUsed(COORD_2); // B knows it too
		retireAutoCoverage(OWNER_A, [COORD_2]);
		retireAutoCoverage(OWNER_B, [COORD_2]);
		expect(isAutoCoverageRetired(OWNER_A, COORD_2)).toBe(true);
		expect(isAutoCoverageRetired(OWNER_B, COORD_2)).toBe(true);

		// B uses the coordinator (joins a group on it): only B re-arms.
		activePubkeyMock.mockReturnValue(OWNER_B);
		markCoordinatorUsed(COORD_2);
		expect(isAutoCoverageRetired(OWNER_B, COORD_2)).toBe(false);
		expect(isAutoCoverageRetired(OWNER_A, COORD_2)).toBe(true);
	});

	test('a live group on the coordinator blocks retirement (usage is the re-arm)', () => {
		markCoordinatorUsed(COORD_3);
		listChatGroupsMock.mockReturnValue([{ coordinatorKey: COORD_3 }]);

		retireAutoCoverage(OWNER_A, [COORD_3]);

		expect(isAutoCoverageRetired(OWNER_A, COORD_3)).toBe(false);
	});

	test('a coordinator without a saved profile is never retired', () => {
		retireAutoCoverage(OWNER_A, [COORD_4]);
		expect(isAutoCoverageRetired(OWNER_A, COORD_4)).toBe(false);
	});
});
