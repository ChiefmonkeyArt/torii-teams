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

function show(note = '') {
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(TeamChatHeader, {
		target,
		props: { slug: 'studio', members: ['a'.repeat(64), 'b'.repeat(64)], waiting: [], note }
	});
	flushSync();
	return target;
}

test("ADR 0021: framed, Continuum's strip is the header; only a note shows", () => {
	embedState.on = true;
	let el = show();
	expect(el.querySelector('header')).toBeNull();
	expect(el.querySelector('h1')).toBeNull();
	expect(el.querySelector('button[aria-label="Members"]')).toBeNull();
	expect(el.textContent?.trim()).toBe('');
	unmount(app!);
	el = show('1 not joined yet');
	expect(el.querySelector('[data-testid="chat-note"]')?.textContent).toBe('1 not joined yet');
});

test('standalone: name, members and the back link; Your computers is not in the header', () => {
	const el = show();
	expect(el.querySelector('h1')?.textContent).toBe('studio');
	expect(el.querySelector('button[aria-label="Members"]')).not.toBeNull();
	expect(el.querySelector('a[aria-label="Projects"]')).not.toBeNull();
	expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Your computers')).toBe(
		false
	);
});
