import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('./MemberName.svelte', async () => ({
	default: (await import('./__stubs__/NameStub.svelte')).default
}));
const ensureProfileLoaded = vi.hoisted(() => vi.fn());
vi.mock('$lib/queries/chatProfileQueries', () => ({ ensureProfileLoaded }));
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
	ensureProfileLoaded.mockClear();
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

test('torii.23: framed, the header still loads every member profile so names show', () => {
	embedState.on = true;
	show();
	expect(ensureProfileLoaded.mock.calls.map((c) => c[0])).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
});

test('torii.23: standalone, MemberName loads profiles; the header does not', () => {
	show();
	expect(ensureProfileLoaded).not.toHaveBeenCalled();
});
