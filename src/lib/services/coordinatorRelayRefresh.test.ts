import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/services/accountManager.svelte', () => ({
	manager: { getActive: () => undefined, active: undefined }
}));
vi.mock('$lib/services/chatGroups.svelte', () => ({ listChatGroups: () => [] }));
vi.mock('$lib/services/chatKeyPackages.svelte', () => ({ listChatKeyPackages: () => [] }));
vi.mock('$lib/services/eventStore', () => ({
	eventStore: {
		getReplaceable: vi.fn(),
		model: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => undefined }) }))
	}
}));
vi.mock('$lib/services/loaders.svelte', () => ({
	addressLoader: vi.fn(),
	createUserRelayListByPubkeyLoader: vi.fn(
		() =>
			({
				subscribe: (handlers?: { complete?: () => void }) => {
					handlers?.complete?.();
					return { unsubscribe: () => undefined };
				}
			}) as unknown as ReturnType<typeof createUserRelayListByPubkeyLoader>
	)
}));
vi.mock('$lib/services/chatRuntime', () => ({
	resolveCoordinatorRelaysFromNetwork: vi.fn()
}));

import { eventStore } from '$lib/services/eventStore';
import { createUserRelayListByPubkeyLoader } from '$lib/services/loaders.svelte';
import { resolveCoordinatorRelaysFromNetwork } from '$lib/services/chatRuntime';
import { getChatCoordinator, upsertChatCoordinator } from './chatCoordinators.svelte';
import {
	maybeRefreshCoordinatorRelaysOnOutage,
	sweepStaleCoordinatorRelays
} from './coordinatorRelayRefresh';

const COORDINATOR = 'a'.repeat(64);
const OTHER_COORDINATOR = 'b'.repeat(64);
const OLD = ['wss://old.example.com'];
const T0 = 1_000_000;
const HOUR = 60 * 60 * 1000;

function announce(tags: string[][]) {
	vi.mocked(eventStore.getReplaceable).mockReturnValue({
		tags
	} as unknown as ReturnType<typeof eventStore.getReplaceable>);
}

function seedCoordinator(pubkey: string, relays: string[]) {
	upsertChatCoordinator({ pubkey, relays });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Date, 'now').mockReturnValue(T0);
	vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined);
	vi.mocked(resolveCoordinatorRelaysFromNetwork).mockResolvedValue([]);
});

describe('sweepStaleCoordinatorRelays', () => {
	test('no announcement: keeps relays, bumps the staleness stamp', async () => {
		seedCoordinator(COORDINATOR, OLD);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(OLD);
		expect(getChatCoordinator(COORDINATOR)?.relaysResolvedAt).toBe(T0 + 25 * HOUR);
		expect(resolveCoordinatorRelaysFromNetwork).not.toHaveBeenCalled();
	});

	test('unchanged announcement (order-insensitive): keeps relays, no resolve', async () => {
		seedCoordinator(COORDINATOR, ['wss://a.example.com', 'wss://b.example.com']);
		announce([
			['r', 'wss://b.example.com'],
			['r', 'wss://a.example.com']
		]);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual([
			'wss://a.example.com',
			'wss://b.example.com'
		]);
		expect(getChatCoordinator(COORDINATOR)?.relaysResolvedAt).toBe(T0 + 25 * HOUR);
		expect(resolveCoordinatorRelaysFromNetwork).not.toHaveBeenCalled();
	});

	test('changed announcement + verified subset: adopts the resolved set', async () => {
		seedCoordinator(COORDINATOR, OLD);
		announce([
			['r', 'wss://new.example.com'],
			['r', 'wss://new.example.com', 'write']
		]);
		vi.mocked(resolveCoordinatorRelaysFromNetwork).mockResolvedValue(['wss://new.example.com']);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(['wss://new.example.com']);
		expect(resolveCoordinatorRelaysFromNetwork).toHaveBeenCalledWith(COORDINATOR, {
			discoveryRelayUrls: expect.arrayContaining(OLD)
		});
	});

	test('changed announcement + fallback answer outside the announcement: keeps relays', async () => {
		seedCoordinator(COORDINATOR, OLD);
		announce([['r', 'wss://new.example.com']]);
		// SDK fallback set — reachable, but no evidence about this coordinator.
		vi.mocked(resolveCoordinatorRelaysFromNetwork).mockResolvedValue(['wss://relay.contextvm.org']);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(OLD);
		expect(getChatCoordinator(COORDINATOR)?.relaysResolvedAt).toBe(T0 + 25 * HOUR);
	});

	test('resolve failure: keeps relays, bumps stamp, no throw', async () => {
		seedCoordinator(COORDINATOR, OLD);
		announce([['r', 'wss://new.example.com']]);
		vi.mocked(resolveCoordinatorRelaysFromNetwork).mockRejectedValue(new Error('boom'));
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await expect(sweepStaleCoordinatorRelays()).resolves.toBeUndefined();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(OLD);
		expect(getChatCoordinator(COORDINATOR)?.relaysResolvedAt).toBe(T0 + 25 * HOUR);
	});

	test('skips fresh stamps and empty-relay coordinators', async () => {
		seedCoordinator(COORDINATOR, OLD); // stamped T0
		upsertChatCoordinator({ pubkey: OTHER_COORDINATOR }); // no relays → auto mode
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 1 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(createUserRelayListByPubkeyLoader).not.toHaveBeenCalled();
	});

	test('one broken coordinator never blocks the others', async () => {
		seedCoordinator(COORDINATOR, OLD);
		seedCoordinator(OTHER_COORDINATOR, OLD);
		announce([['r', 'wss://new.example.com']]);
		vi.mocked(resolveCoordinatorRelaysFromNetwork).mockImplementation(async (key) => {
			if (key === COORDINATOR) throw new Error('boom');
			return ['wss://new.example.com'];
		});
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(OLD);
		expect(getChatCoordinator(OTHER_COORDINATOR)?.relays).toEqual(['wss://new.example.com']);
	});

	test('concurrent sweeps share one in-flight refresh per coordinator', async () => {
		seedCoordinator(COORDINATOR, OLD);
		announce([['r', 'wss://new.example.com']]);
		vi.mocked(resolveCoordinatorRelaysFromNetwork).mockResolvedValue(['wss://new.example.com']);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await Promise.all([sweepStaleCoordinatorRelays(), sweepStaleCoordinatorRelays()]);

		expect(createUserRelayListByPubkeyLoader).toHaveBeenCalledTimes(1);
	});
});

describe('maybeRefreshCoordinatorRelaysOnOutage', () => {
	test('min-interval gate, then adopt; next attempt gated by the new stamp', async () => {
		seedCoordinator(COORDINATOR, OLD); // stamped T0
		announce([['r', 'wss://new.example.com']]);
		vi.mocked(resolveCoordinatorRelaysFromNetwork).mockResolvedValue(['wss://new.example.com']);

		vi.spyOn(Date, 'now').mockReturnValue(T0 + 5 * 60 * 1000);
		await expect(maybeRefreshCoordinatorRelaysOnOutage(COORDINATOR)).resolves.toBe(false);
		expect(resolveCoordinatorRelaysFromNetwork).not.toHaveBeenCalled();

		vi.spyOn(Date, 'now').mockReturnValue(T0 + 16 * 60 * 1000);
		await expect(maybeRefreshCoordinatorRelaysOnOutage(COORDINATOR)).resolves.toBe(true);
		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(['wss://new.example.com']);

		vi.spyOn(Date, 'now').mockReturnValue(T0 + 20 * 60 * 1000);
		await expect(maybeRefreshCoordinatorRelaysOnOutage(COORDINATOR)).resolves.toBe(false);
		expect(resolveCoordinatorRelaysFromNetwork).toHaveBeenCalledTimes(1);
	});

	test('unknown coordinator and empty-relay coordinators: false, no work', async () => {
		await expect(maybeRefreshCoordinatorRelaysOnOutage(OTHER_COORDINATOR)).resolves.toBe(false);
		upsertChatCoordinator({ pubkey: OTHER_COORDINATOR });
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);
		await expect(maybeRefreshCoordinatorRelaysOnOutage(OTHER_COORDINATOR)).resolves.toBe(false);
		expect(createUserRelayListByPubkeyLoader).not.toHaveBeenCalled();
	});
});
