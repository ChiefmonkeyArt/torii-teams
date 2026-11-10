import { mount, unmount, flushSync, tick } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$app/paths', () => ({
	resolve: (p: string, a?: { slug: string }) => (a ? p.replace('[slug]', a.slug) : p)
}));
vi.mock('../projectChannels.svelte', () => ({
	projectChannels: { projects: [{ slug: 'studio' }] }
}));

import TeamHome from './TeamHome.svelte';
import { embedState } from './embedState.svelte';

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	embedState.on = false;
	h.goto.mockReset();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

async function show() {
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(TeamHome, { target });
	flushSync();
	await tick();
	flushSync();
	return target;
}

test('ADR 0017 §2: framed at /chat, a quiet empty pane and no jump to a project', async () => {
	embedState.on = true;
	const el = await show();
	expect(h.goto).not.toHaveBeenCalled();
	expect(el.textContent?.trim()).toBe('');
});

test('standalone on a wide screen: the only project still opens', async () => {
	const mq = { matches: true, addEventListener: () => {}, removeEventListener: () => {} };
	vi.spyOn(window, 'matchMedia').mockReturnValue(mq as unknown as MediaQueryList);
	await show();
	await vi.waitFor(() =>
		expect(h.goto).toHaveBeenCalledWith('/chat/p/studio', { replaceState: true })
	);
});
