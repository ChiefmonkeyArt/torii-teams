import { mount, tick, unmount } from 'svelte';
import { describe, expect, test, vi } from 'vitest';

// The profile store delivers a profile on the first subscription only.
vi.mock('$lib/services/eventStore', () => {
	const delivered = new Set<string>();
	return {
		eventStore: {
			model: (pubkey: string) => ({
				subscribe: (callback: (profile: unknown) => void) => {
					if (!delivered.has(pubkey)) {
						delivered.add(pubkey);
						callback({ name: 'warm-name' });
					}
					return { unsubscribe: () => {} };
				}
			})
		}
	};
});
vi.mock('$lib/queries/chatProfileQueries', () => ({ ensureProfileLoaded: vi.fn() }));

import Probe from './useProfileHints.probe.svelte';

describe('useProfileHints', () => {
	test('mounts around later-declared deriveds and shows delivered profiles', async () => {
		// Guard: callers write the pubkey closure to run inside an effect and it
		// may read deriveds declared later in their script. Anything that invokes
		// it during init (e.g. a synchronous warm-cache seed) throws a TDZ
		// ReferenceError and blanks the whole app — that regression shipped once.
		const component = mount(Probe, { target: document.body });
		await tick();
		expect(document.body.textContent).toContain('warm-name');
		await unmount(component);
	});
});
