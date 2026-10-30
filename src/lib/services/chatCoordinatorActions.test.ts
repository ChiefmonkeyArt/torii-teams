import { beforeEach, describe, expect, test, vi } from 'vitest';

const listChatGroupsMock = vi.fn();
const listChatKeyPackagesMock = vi.fn();
const isMultiDeviceActiveMock = vi.fn();
const onMetaStateChangeMock = vi.fn();
const softDeleteGroupsMock = vi.fn(async () => []);
const deleteChatGroupsForCoordinatorMock = vi.fn();
const purgeCoordinatorKeyPackagesMock = vi.fn();
const removeChatCoordinatorMock = vi.fn();
const stopWatchingGroupMock = vi.fn();
const disconnectCoordinatorClientMock = vi.fn(async () => {});

vi.mock('$app/environment', () => ({ browser: false }));

vi.mock('$lib/services/accountManager.svelte', () => ({
	manager: { getActive: () => ({ pubkey: 'aa'.repeat(32) }) }
}));

vi.mock('$lib/services/chatGroups.svelte', () => ({
	listChatGroups: () => listChatGroupsMock(),
	deleteChatGroupsForCoordinator: deleteChatGroupsForCoordinatorMock,
	chatGroupsStore: { groups: [] }
}));

vi.mock('$lib/services/chatKeyPackages.svelte', () => ({
	listChatKeyPackages: () => listChatKeyPackagesMock(),
	purgeCoordinatorKeyPackages: purgeCoordinatorKeyPackagesMock,
	chatKeyPackagesStore: { keyPackages: [] }
}));

vi.mock('$lib/services/chatCoordinators.svelte', () => ({
	removeChatCoordinator: removeChatCoordinatorMock
}));

vi.mock('$lib/services/chatWelcomeNotifications.svelte', () => ({
	chatWelcomeNotificationsStore: { entries: [] },
	deleteWelcomeNotificationsForCoordinator: vi.fn()
}));

vi.mock('$lib/services/chatRuntime', () => ({
	disconnectCoordinatorClient: disconnectCoordinatorClientMock
}));

vi.mock('$lib/services/chatGroupWatch.svelte', () => ({
	stopWatchingGroup: stopWatchingGroupMock
}));

vi.mock('$lib/services/multiDevice.svelte', () => ({
	isMultiDeviceActive: isMultiDeviceActiveMock,
	onMetaStateChange: onMetaStateChangeMock,
	softDeleteGroups: softDeleteGroupsMock
}));

vi.mock('$lib/query-client', () => ({
	queryClient: { removeQueries: vi.fn(), invalidateQueries: vi.fn() }
}));

vi.mock('$lib/queries/chatQueryKeys', () => ({
	chatQueryKeys: {
		coordinator: () => ['coordinator'],
		availableKeyPackages: () => ['availableKeyPackages']
	}
}));

const COORD_A = 'aa'.repeat(32);
const COORD_B = 'bb'.repeat(32);

function group(id: string, coordinatorKey: string, joinedWithKeyPackageRef?: string) {
	return { id, coordinatorKey, joinedWithKeyPackageRef };
}

function kp(ref: string, publishedCoordinatorKeys: string[]) {
	return { keyPackageRef: ref, publishedCoordinatorKeys };
}

// Warm the heavy module graph at file scope: vi.mock is hoisted above this,
// so mocks apply, and the first in-test `await import()` no longer pays the
// transform+eval cost against its 5s timeout (the parallel-load flake).
await import('./chatCoordinatorActions.svelte');

describe('computeKeyPackageDeletion()', () => {
	beforeEach(() => {
		listChatGroupsMock.mockReset();
		listChatKeyPackagesMock.mockReset();
	});

	test('flags consumed records and keeps records shared with another coordinator', async () => {
		const { computeKeyPackageDeletion } = await import('./chatCoordinatorActions.svelte');
		listChatGroupsMock.mockReturnValue([
			group('g1', COORD_A, 'kp-consumed-a'),
			group('g2', COORD_A, 'kp-shared'),
			group('g3', COORD_B, 'kp-shared')
		]);
		listChatKeyPackagesMock.mockReturnValue([
			kp('kp-consumed-a', []),
			kp('kp-shared', [COORD_A, COORD_B])
		]);

		const result = computeKeyPackageDeletion(COORD_A);

		expect(result.consumed).toEqual(['kp-consumed-a', 'kp-shared']);
		expect(result.willDelete).toEqual(['kp-consumed-a']);
		// kp-shared survives: still published to COORD_B and referenced by g3.
		expect(result.willDelete).not.toContain('kp-shared');
	});

	test('deletes a publish-only record that becomes an orphan on this coordinator', async () => {
		const mod = await import('./chatCoordinatorActions.svelte');
		listChatGroupsMock.mockReturnValue([]);
		listChatKeyPackagesMock.mockReturnValue([
			kp('kp-only-a', [COORD_A]),
			kp('kp-other', [COORD_B])
		]);

		const result = mod.computeKeyPackageDeletion(COORD_A);

		expect(result.published).toEqual(['kp-only-a']);
		expect(result.willDelete).toEqual(['kp-only-a']);
		expect(result.willDelete).not.toContain('kp-other');
	});

	test('keeps a record consumed by a group on this coordinator but still published elsewhere', async () => {
		const { computeKeyPackageDeletion } = await import('./chatCoordinatorActions.svelte');
		listChatGroupsMock.mockReturnValue([group('g1', COORD_A, 'kp-cross')]);
		listChatKeyPackagesMock.mockReturnValue([kp('kp-cross', [COORD_A, COORD_B])]);

		const result = computeKeyPackageDeletion(COORD_A);

		expect(result.consumed).toEqual(['kp-cross']);
		// Still published to COORD_B -> survives.
		expect(result.willDelete).toEqual([]);
	});
});

describe('purgeChatCoordinator() (multi-device purge propagation)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isMultiDeviceActiveMock.mockReturnValue(false);
		listChatGroupsMock.mockReturnValue([]);
		listChatKeyPackagesMock.mockReturnValue([]);
	});

	test('multi-device: soft-deletes the groups in one batch and retracts the meta claim', async () => {
		const { purgeChatCoordinator } = await import('./chatCoordinatorActions.svelte');
		isMultiDeviceActiveMock.mockReturnValue(true);
		listChatGroupsMock.mockReturnValue([
			group('g1', COORD_A),
			group('g2', COORD_A),
			group('g3', COORD_B)
		]);

		await purgeChatCoordinator(COORD_A);

		expect(stopWatchingGroupMock).toHaveBeenCalledTimes(2);
		expect(softDeleteGroupsMock).toHaveBeenCalledWith(['g1', 'g2']);
		expect(deleteChatGroupsForCoordinatorMock).not.toHaveBeenCalled();
		expect(purgeCoordinatorKeyPackagesMock).toHaveBeenCalledWith(COORD_A, []);
		expect(removeChatCoordinatorMock).toHaveBeenCalledWith(COORD_A);
		// The meta republish retracts the purged coordinator's claim (covers the
		// offline-coordinator path, where claims are pruned without RPCs).
		expect(onMetaStateChangeMock).toHaveBeenCalled();
	});

	test('single-device: hard-deletes the groups, no tombstones, no meta writes', async () => {
		const { purgeChatCoordinator } = await import('./chatCoordinatorActions.svelte');
		listChatGroupsMock.mockReturnValue([group('g1', COORD_A)]);

		await purgeChatCoordinator(COORD_A);

		expect(deleteChatGroupsForCoordinatorMock).toHaveBeenCalledWith(COORD_A);
		expect(softDeleteGroupsMock).not.toHaveBeenCalled();
	});
});

describe('getCoordinatorPurgeImpact()', () => {
	beforeEach(() => {
		listChatGroupsMock.mockReset();
		listChatKeyPackagesMock.mockReset();
	});

	test('surfaces published vs consumed counts separately', async () => {
		const { getCoordinatorPurgeImpact } = await import('./chatCoordinatorActions.svelte');
		listChatGroupsMock.mockReturnValue([
			group('g1', COORD_A, 'kp-used-1'),
			group('g2', COORD_A, 'kp-used-2')
		]);
		listChatKeyPackagesMock.mockReturnValue([
			kp('kp-used-1', []),
			kp('kp-used-2', []),
			kp('kp-published', [COORD_A]),
			kp('kp-other', [COORD_B])
		]);

		const impact = getCoordinatorPurgeImpact(COORD_A);

		expect(impact.groups).toBe(2);
		expect(impact.keyPackagesPublished).toBe(1); // kp-published
		expect(impact.keyPackagesLocal).toBe(2); // kp-used-1, kp-used-2
	});
});
