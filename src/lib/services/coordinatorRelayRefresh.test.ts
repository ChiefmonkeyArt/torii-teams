import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/services/accountManager.svelte', () => ({
	manager: { getActive: () => undefined, active: undefined }
}));
vi.mock('$lib/services/chatGroups.svelte', () => ({ listChatGroups: () => [] }));
vi.mock('$lib/services/chatKeyPackages.svelte', () => ({ listChatKeyPackages: () => [] }));
vi.mock('$lib/services/chatRuntime', () => ({
	fetchAnnouncedCoordinatorRelays: vi.fn(),
	verifyCoordinatorRelays: vi.fn()
}));

import {
	fetchAnnouncedCoordinatorRelays,
	verifyCoordinatorRelays
} from '$lib/services/chatRuntime';
import { getChatCoordinator, upsertChatCoordinator } from './chatCoordinators.svelte';
import {
	maybeRefreshCoordinatorRelaysOnOutage,
	sweepStaleCoordinatorRelays
} from './coordinatorRelayRefresh';

const COORDINATOR = 'a'.repeat(64);
const OTHER_COORDINATOR = 'b'.repeat(64);
const OLD = ['wss://old.example.com'];
const NEW = ['wss://new.example.com'];
const T0 = 1_000_000;
const HOUR = 60 * 60 * 1000;

function announce(relays: string[]) {
	vi.mocked(fetchAnnouncedCoordinatorRelays).mockResolvedValue(relays);
}

function seedCoordinator(pubkey: string, relays: string[]) {
	upsertChatCoordinator({ pubkey, relays });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Date, 'now').mockReturnValue(T0);
	vi.mocked(fetchAnnouncedCoordinatorRelays).mockResolvedValue([]);
	vi.mocked(verifyCoordinatorRelays).mockResolvedValue(true);
});

describe('sweepStaleCoordinatorRelays', () => {
	test('no announcement: keeps relays, bumps the staleness stamp', async () => {
		seedCoordinator(COORDINATOR, OLD);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(OLD);
		expect(getChatCoordinator(COORDINATOR)?.relaysResolvedAt).toBe(T0 + 25 * HOUR);
		expect(verifyCoordinatorRelays).not.toHaveBeenCalled();
	});

	test('unchanged announcement (order-insensitive): keeps relays, no verify', async () => {
		seedCoordinator(COORDINATOR, ['wss://a.example.com', 'wss://b.example.com']);
		announce(['wss://b.example.com', 'wss://a.example.com']);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual([
			'wss://a.example.com',
			'wss://b.example.com'
		]);
		expect(getChatCoordinator(COORDINATOR)?.relaysResolvedAt).toBe(T0 + 25 * HOUR);
		expect(verifyCoordinatorRelays).not.toHaveBeenCalled();
	});

	test('changed announcement + verified: adopts the announced set verbatim', async () => {
		seedCoordinator(COORDINATOR, OLD);
		announce(NEW);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(NEW);
		expect(verifyCoordinatorRelays).toHaveBeenCalledWith(COORDINATOR, NEW);
	});

	test('changed announcement but no MCP answer on it: keeps relays', async () => {
		seedCoordinator(COORDINATOR, OLD);
		announce(NEW);
		vi.mocked(verifyCoordinatorRelays).mockResolvedValue(false);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(OLD);
		expect(getChatCoordinator(COORDINATOR)?.relaysResolvedAt).toBe(T0 + 25 * HOUR);
	});

	test('announcement read failure: keeps relays, bumps stamp, no throw', async () => {
		seedCoordinator(COORDINATOR, OLD);
		vi.mocked(fetchAnnouncedCoordinatorRelays).mockRejectedValue(new Error('boom'));
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

		expect(fetchAnnouncedCoordinatorRelays).not.toHaveBeenCalled();
	});

	test('one broken coordinator never blocks the others', async () => {
		seedCoordinator(COORDINATOR, OLD);
		seedCoordinator(OTHER_COORDINATOR, OLD);
		vi.mocked(fetchAnnouncedCoordinatorRelays).mockImplementation(async (key) => {
			if (key === COORDINATOR) throw new Error('boom');
			return NEW;
		});
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await sweepStaleCoordinatorRelays();

		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(OLD);
		expect(getChatCoordinator(OTHER_COORDINATOR)?.relays).toEqual(NEW);
	});

	test('concurrent sweeps share one in-flight refresh per coordinator', async () => {
		seedCoordinator(COORDINATOR, OLD);
		announce(NEW);
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);

		await Promise.all([sweepStaleCoordinatorRelays(), sweepStaleCoordinatorRelays()]);

		expect(fetchAnnouncedCoordinatorRelays).toHaveBeenCalledTimes(1);
	});
});

describe('maybeRefreshCoordinatorRelaysOnOutage', () => {
	test('min-interval gate, then adopt; next attempt gated by the new stamp', async () => {
		seedCoordinator(COORDINATOR, OLD); // stamped T0
		announce(NEW);

		vi.spyOn(Date, 'now').mockReturnValue(T0 + 5 * 60 * 1000);
		await expect(maybeRefreshCoordinatorRelaysOnOutage(COORDINATOR)).resolves.toBe(false);
		expect(fetchAnnouncedCoordinatorRelays).not.toHaveBeenCalled();

		vi.spyOn(Date, 'now').mockReturnValue(T0 + 16 * 60 * 1000);
		await expect(maybeRefreshCoordinatorRelaysOnOutage(COORDINATOR)).resolves.toBe(true);
		expect(getChatCoordinator(COORDINATOR)?.relays).toEqual(NEW);

		vi.spyOn(Date, 'now').mockReturnValue(T0 + 20 * 60 * 1000);
		await expect(maybeRefreshCoordinatorRelaysOnOutage(COORDINATOR)).resolves.toBe(false);
		expect(fetchAnnouncedCoordinatorRelays).toHaveBeenCalledTimes(1);
	});

	test('unknown coordinator and empty-relay coordinators: false, no work', async () => {
		await expect(maybeRefreshCoordinatorRelaysOnOutage(OTHER_COORDINATOR)).resolves.toBe(false);
		upsertChatCoordinator({ pubkey: OTHER_COORDINATOR });
		vi.spyOn(Date, 'now').mockReturnValue(T0 + 25 * HOUR);
		await expect(maybeRefreshCoordinatorRelaysOnOutage(OTHER_COORDINATOR)).resolves.toBe(false);
		expect(fetchAnnouncedCoordinatorRelays).not.toHaveBeenCalled();
	});
});
