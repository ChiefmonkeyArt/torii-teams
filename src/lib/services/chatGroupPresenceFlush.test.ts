/**
 * Presence persistence flush (chatGroupPresence): read marks ride a trailing
 * debounce, and Android backgrounds the WebView without firing pagehide — if
 * the pending write isn't flushed on visibilitychange → hidden, a killed
 * process loses the reading session's marks and the next notification-tap open
 * lands at a stale "first unread" instead of the new messages.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, test, vi } from 'vitest';

type Listener = () => void;

const harness = vi.hoisted(() => ({
	windowListeners: new Map<string, Listener>(),
	writes: [] as string[],
	visibility: 'visible'
}));

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/services/nativeBridge', () => ({
	clearShownNotifications: () => Promise.resolve()
}));

vi.mock('$lib/services/accountManager.svelte', () => ({
	manager: { active: { pubkey: 'ee'.repeat(32) } }
}));

vi.mock('$lib/services/chatGroups.svelte', () => ({
	getChatGroup: (id: string) => ({ id, lastCursor: 10, messages: [] }),
	listChatGroups: () => [],
	areChatGroupsLoaded: () => true,
	listChatGroupMessages: () => []
}));

type PresenceModule = typeof import('./chatGroupPresence.svelte');
let presence: PresenceModule;

// 30s: the cold import below compiles a heavy module graph, which can exceed
// the default 10s hook budget when the parallel full-suite run saturates the
// CPU (observed flake on both slow and busy machines).
beforeAll(async () => {
	// Fake timers so the trailing debounce never fires mid-suite; the tests
	// drive the flush explicitly.
	vi.useFakeTimers();
	vi.stubGlobal('addEventListener', (type: string, fn: Listener) => {
		harness.windowListeners.set(type, fn);
	});
	vi.stubGlobal('document', {
		get visibilityState() {
			return harness.visibility;
		},
		addEventListener: (type: string, fn: Listener) => {
			harness.windowListeners.set(type, fn);
		}
	});
	vi.stubGlobal('localStorage', {
		setItem: (_key: string, value: string) => harness.writes.push(value)
	});
	presence = await import('./chatGroupPresence.svelte');
}, 30_000);

afterAll(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

beforeEach(() => {
	harness.writes.length = 0;
	harness.visibility = 'visible';
});

describe('presence persistence flush', () => {
	test('hiding the page flushes pending read marks', () => {
		presence.markChatGroupRead('group-a', 5);
		expect(harness.writes).toHaveLength(0); // still inside the trailing debounce

		harness.visibility = 'hidden';
		harness.windowListeners.get('visibilitychange')?.();

		expect(harness.writes).toHaveLength(1);
		expect(JSON.parse(harness.writes[0]).groups['group-a'].lastReadCursor).toBe(5);
	});

	test('staying visible leaves the debounce in charge', () => {
		presence.markChatGroupRead('group-b', 7);
		harness.windowListeners.get('visibilitychange')?.();

		expect(harness.writes).toHaveLength(0);
	});
});
