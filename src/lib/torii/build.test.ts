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
});
