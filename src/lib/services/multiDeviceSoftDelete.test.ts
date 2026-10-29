import { describe, expect, test, vi } from 'vitest';

const { getChatGroupMock, deleteChatGroupMock, decodeStoredGroupStateMock } = vi.hoisted(() => ({
	getChatGroupMock: vi.fn(),
	deleteChatGroupMock: vi.fn(),
	decodeStoredGroupStateMock: vi.fn()
}));

vi.mock('$app/environment', () => ({ browser: false, dev: false }));
vi.mock('$lib/services/chatGroups.svelte', () => ({
	listChatGroups: vi.fn(() => []),
	getChatGroup: getChatGroupMock,
	persistGroup: vi.fn(),
	replaceGroup: vi.fn(),
	deleteChatGroup: deleteChatGroupMock,
	decodeStoredGroupState: decodeStoredGroupStateMock,
	runGroupOperation: vi.fn()
}));
vi.mock('$lib/services/chatGroupLifecycle.svelte', () => ({
	getProtocolGroupId: (state: { gid: string }) => state.gid
}));
vi.mock('$lib/services/chatKeyPackages.svelte', () => ({
	getLastResortKeyPackageEntry: vi.fn(),
	getLastResortKeyPackageRef: vi.fn(),
	loadLastResortKeyPackage: vi.fn(),
	repairLastResortAlignment: vi.fn(),
	setLastResortClaimBaseline: vi.fn()
}));

import { softDeleteGroups } from './multiDevice.svelte';

describe('softDeleteGroups()', () => {
	test('a decode failure leaves the whole batch locally intact', async () => {
		const good = { id: 'good' };
		const corrupt = { id: 'corrupt' };
		getChatGroupMock.mockImplementation((id: string) =>
			id === 'good' ? good : id === 'corrupt' ? corrupt : undefined
		);
		decodeStoredGroupStateMock.mockImplementation((group: { id: string }) => {
			if (group.id === 'corrupt') throw new Error('corrupt MLS state');
			return { gid: 'good', groupContext: { epoch: 5n } };
		});

		await expect(softDeleteGroups(['good', 'corrupt'])).rejects.toThrow('corrupt MLS state');

		expect(deleteChatGroupMock).not.toHaveBeenCalled();
	});
});
