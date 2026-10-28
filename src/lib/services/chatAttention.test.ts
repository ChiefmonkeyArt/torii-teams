/**
 * Tab-title ownership (chatAttention): syncChatAttention is the single writer —
 * route heads must not set <title> or the unread badge flips between writers.
 * The label table below replaced 16 route-local titles; these tests pin it and
 * the write-on-change guard (the caller effect re-runs per ingested batch).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { syncChatAttention } from './chatAttention.svelte';

const harness = vi.hoisted(() => ({
	title: '' as string,
	titleWrites: 0,
	pathname: '/chat',
	searchParams: new URLSearchParams()
}));

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return { pathname: harness.pathname, searchParams: harness.searchParams };
		}
	}
}));

vi.stubGlobal('document', {
	get title() {
		return harness.title;
	},
	set title(value: string) {
		harness.title = value;
		harness.titleWrites++;
	},
	querySelector: () => ({ getAttribute: () => '/favicon.svg', href: '' }),
	createElement: () => ({ href: '' }),
	head: { append: () => undefined }
});

vi.mock('$lib/services/nativeBridge', () => ({
	clearShownNotifications: () => Promise.resolve(),
	ensureNotificationPermission: vi.fn(),
	isNativePlatform: () => false,
	showLocalNotification: vi.fn()
}));

vi.mock('$lib/services/accountManager.svelte', () => ({
	manager: { active: { pubkey: 'aa'.repeat(32) } }
}));

vi.mock('$lib/services/chatGroupPresence.svelte', () => ({
	getChatGroupLastReadCursor: () => 0,
	getUnreadChatGroupMessageCount: (id: string) => (id === 'g1' ? 2 : 0),
	getUnreadChatGroupReferenceCount: () => 0
}));

vi.mock('$lib/services/chatWelcomeNotifications.svelte', () => ({
	getUnreadWelcomeNotificationCount: () => 0
}));

vi.mock('$lib/services/chatJoinRequests.svelte', () => ({
	getUnreadJoinRequestCount: () => 0
}));

vi.mock('$lib/news/newsReadState.svelte', () => ({
	getUnreadNewsCount: () => 0
}));

vi.mock('$lib/services/chatGroups.svelte', () => ({
	getChatGroup: (id: string) =>
		id === 'g1' ? { id: 'g1', metadata: { name: 'Besao' } } : undefined,
	listChatGroups: () => [{ id: 'g1' }, { id: 'g2' }],
	listChatGroupMembers: () => []
}));

vi.mock('$lib/services/chatCoordinators.svelte', () => ({
	getCoordinatorLabel: (key: string) => (key === 'ck1' ? 'Coordinator One' : key)
}));

vi.mock('$lib/utils/groupShareLink', () => ({
	// Bare-gid passthrough: enough to drive getChatGroup lookups per route.
	resolveGroupLocator: (id: string) => ({
		gid: id,
		coordinatorKey: 'cc'.repeat(32),
		coordinatorProvided: false,
		coordinatorError: '',
		shareMetadata: null
	})
}));

vi.mock('$lib/services/eventStore', () => ({ eventStore: {} }));
vi.mock('applesauce-core/observable', () => ({ firstValueFrom: vi.fn() }));
vi.mock('applesauce-core/models', () => ({ ProfileModel: class {} }));

beforeEach(() => {
	harness.title = '';
	harness.titleWrites = 0;
	harness.pathname = '/chat';
});

describe('chat page title', () => {
	test('one label table, badged from the same unread sources', () => {
		const expectTitle = (pathname: string, title: string) => {
			harness.pathname = pathname;
			syncChatAttention();
			expect(harness.title).toBe(title);
		};

		expectTitle('/chat', '(2) Chats | Cordn');
		expectTitle('/chat/news', '(2) News & updates | Cordn');
		expectTitle('/chat/config', '(2) Settings | Cordn');
		expectTitle('/chat/config/key-packages', '(2) Key packages | Cordn');
		expectTitle('/chat/coordinators', '(2) Coordinators | Cordn');
		expectTitle('/chat/coordinators/ck1', '(2) Coordinator One | Cordn');
		expectTitle('/chat/g1', '(2) Besao | Cordn');
		expectTitle('/chat/g1/info', '(2) Besao | Cordn');
		expectTitle('/chat/g1/e/abc', '(2) Message | Besao | Cordn');
		expectTitle('/chat/g2', '(2) Chat | Cordn');
	});

	test('writes the title only when it changes', () => {
		syncChatAttention();
		const writes = harness.titleWrites;
		syncChatAttention();
		syncChatAttention();
		expect(harness.titleWrites).toBe(writes);
	});
});
