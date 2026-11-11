import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHAT_COORDINATOR_PUBKEY } from '$lib/constants/chat';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe('Torii node build switch', () => {
	it('keeps the upstream fallback when unset', async () => {
		vi.stubEnv('VITE_TORII_NODE_BUILD', '');
		const m = await import('./build');
		expect(m.TORII_NODE_BUILD).toBe(false);
		expect(m.upstreamFallbackCoordinator()).toBe(DEFAULT_CHAT_COORDINATOR_PUBKEY);
	});
	it('drops Cordn’s coordinator on a node build', async () => {
		vi.stubEnv('VITE_TORII_NODE_BUILD', '1');
		const m = await import('./build');
		expect(m.TORII_NODE_BUILD).toBe(true);
		expect(m.upstreamFallbackCoordinator()).toBe('');
	});
	it('a node build does not poll welcomes; upstream still does (ADR 0018 §2)', async () => {
		vi.stubEnv('VITE_TORII_NODE_BUILD', '1');
		expect((await import('./build')).POLL_WELCOMES).toBe(false);
		vi.resetModules();
		vi.stubEnv('VITE_TORII_NODE_BUILD', '');
		expect((await import('./build')).POLL_WELCOMES).toBe(true);
	});
	it('the startup load and the notifications poll are gated on POLL_WELCOMES', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(
			new URL('../components/chat/NotificationsDialog.svelte', import.meta.url),
			'utf8'
		);
		expect(src).toMatch(
			/POLL_WELCOMES\s*\?\s*queryClient\.fetchQuery\(welcomeNotificationsQueryOptions/
		);
		const layout = readFileSync(
			new URL('../../routes/chat/+layout.svelte', import.meta.url),
			'utf8'
		);
		const start = layout.indexOf('await loadWelcomeNotificationsAction()');
		expect(start).toBeGreaterThan(0);
		expect(layout.lastIndexOf('if (!POLL_WELCOMES) return;', start)).toBeGreaterThan(0);
	});
});
