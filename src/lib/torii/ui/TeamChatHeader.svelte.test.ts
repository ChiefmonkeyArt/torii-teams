import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('./MemberName.svelte', async () => ({
	default: (await import('./__stubs__/NameStub.svelte')).default
}));
vi.mock('../projectChannels.svelte', () => ({
	loadMyDevices: vi.fn(async () => null),
	saveMyDevices: vi.fn()
}));

import TeamChatHeader from './TeamChatHeader.svelte';
import { embedState } from './embedState.svelte';

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	embedState.on = false;
	document.body.innerHTML = '';
});

function show() {
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(TeamChatHeader, {
		target,
		props: { slug: 'studio', members: ['a'.repeat(64), 'b'.repeat(64)], waiting: [] }
	});
	flushSync();
	return target;
}
const computers = (el: HTMLElement) =>
	[...el.querySelectorAll('button')].find((b) => b.textContent === 'Your computers');

test('ADR 0017: framed, no back link and Your computers opens from the header', async () => {
	embedState.on = true;
	const el = show();
	expect(el.querySelector('a[aria-label="Projects"]')).toBeNull();
	const button = computers(el)!;
	expect(button).toBeTruthy();
	button.click();
	flushSync();
	const panel = el.querySelector('[data-testid="device-panel"]') as HTMLElement;
	expect(panel.className).toContain('absolute');
	await vi.waitFor(() => expect(panel.textContent).toContain("Couldn't reach your node."));
});

test('standalone: the back link stays and Your computers is not in the header', () => {
	const el = show();
	expect(el.querySelector('a[aria-label="Projects"]')).not.toBeNull();
	expect(computers(el)).toBeUndefined();
});
