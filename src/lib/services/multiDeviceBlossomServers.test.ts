import { beforeEach, describe, expect, test, vi } from 'vitest';

const { OWNER, localStorageMock, values } = vi.hoisted(() => {
	const OWNER = '11'.repeat(32);
	const values = new Map<string, string>();
	const localStorageMock = {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value)),
		removeItem: vi.fn((key: string) => values.delete(key)),
		clear: vi.fn(() => values.clear())
	};
	vi.stubGlobal('localStorage', localStorageMock);
	return { OWNER, localStorageMock, values };
});

vi.mock('$app/environment', () => ({ browser: true, dev: false }));
vi.mock('$lib/services/accountManager.svelte', () => ({
	manager: { getActive: () => ({ pubkey: OWNER }) }
}));
vi.mock('$lib/services/chatGroups.svelte', () => ({
	listChatGroups: vi.fn(() => []),
	getChatGroup: vi.fn(),
	persistGroup: vi.fn(),
	replaceGroup: vi.fn(),
	deleteChatGroup: vi.fn(),
	decodeStoredGroupState: vi.fn(),
	runGroupOperation: vi.fn()
}));
vi.mock('$lib/services/chatKeyPackages.svelte', () => ({
	getLastResortKeyPackageEntry: vi.fn(),
	getLastResortKeyPackageRef: vi.fn(),
	loadLastResortKeyPackage: vi.fn(),
	repairLastResortAlignment: vi.fn(),
	setLastResortClaimBaseline: vi.fn()
}));

import { DEFAULT_BLOSSOM_SERVERS, setMultiDeviceBlossomServers } from './multiDevice.svelte';

describe('setMultiDeviceBlossomServers()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		values.set(
			'cordn.multiDevice',
			JSON.stringify({
				[OWNER]: {
					ownerPubkey: OWNER,
					dTag: 'test',
					blossomServers: [...DEFAULT_BLOSSOM_SERVERS]
				}
			})
		);
	});

	test('an unchanged normalized host list does not save or schedule a bulk publish', () => {
		setMultiDeviceBlossomServers(['', ...DEFAULT_BLOSSOM_SERVERS, DEFAULT_BLOSSOM_SERVERS[0]]);

		expect(localStorageMock.setItem).not.toHaveBeenCalled();
	});
});
