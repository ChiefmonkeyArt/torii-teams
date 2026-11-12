import { mount, unmount, flushSync, tick } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import { ContinuumError } from '../continuumApi';

const npub = (c: string) => nip19.npubEncode(c.repeat(64));
const NODE = npub('e');
const D1 = npub('1');
const D2 = npub('2');
const D3 = npub('3');

const h = vi.hoisted(() => ({
	mine: null as unknown,
	load: vi.fn(),
	save: vi.fn()
}));
vi.mock('../projectChannels.svelte', () => ({
	loadMyDevices: h.load,
	saveMyDevices: h.save
}));

import DevicePanel from './DevicePanel.svelte';

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	h.load.mockReset();
	h.save.mockReset();
});

const mineWith = (devices: { npub: string; label: string }[], over = {}) => ({
	devices,
	listed: true,
	max: 3,
	nodeNpub: NODE,
	git: 'torii-teams.fips:7334',
	...over
});

async function show(mine: unknown) {
	h.load.mockResolvedValue(mine);
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(DevicePanel, { target });
	flushSync();
	(target.querySelector('button') as HTMLButtonElement).click();
	await vi.waitFor(() => expect(h.load).toHaveBeenCalled());
	await tick();
	flushSync();
	return target;
}

const input = (el: HTMLElement, label: string, value: string) => {
	const i = el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
	i.value = value;
	i.dispatchEvent(new Event('input'));
};
const submit = async (el: HTMLElement) => {
	flushSync();
	(el.querySelector('form') as HTMLFormElement).requestSubmit();
	await vi.waitFor(() => flushSync());
	await tick();
	flushSync();
};

test('lists computers with Remove, and shows the git address and hosts line', async () => {
	const el = await show(mineWith([{ npub: D1, label: 'Laptop' }]));
	expect(el.textContent).toContain('Laptop');
	expect(el.textContent).toContain('Git: http://torii-teams.fips:7334');
	expect(el.querySelector('[data-testid="device-hosts"]')!.textContent).toBe(`torii-teams ${NODE}`);
	expect(el.textContent).not.toMatch(/fd[0-9a-f]{2}:/);
	h.save.mockResolvedValue(undefined);
	const rm = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!;
	rm.click();
	await vi.waitFor(() => expect(h.save).toHaveBeenCalledWith([]));
	await tick();
	flushSync();
	expect(el.textContent).not.toContain('Laptop');
});

test('adds a computer with a name; the full list is signed', async () => {
	const el = await show(mineWith([{ npub: D1, label: '' }]));
	h.save.mockResolvedValue(undefined);
	input(el, 'FIPS name', ` ${D2} `);
	input(el, 'Computer name', 'Desk');
	await submit(el);
	expect(h.save).toHaveBeenCalledWith([
		{ npub: D1, label: '' },
		{ npub: D2, label: 'Desk' }
	]);
	expect(el.textContent).toContain('Desk');
});

test('a bad FIPS name is refused before any signer prompt', async () => {
	const el = await show(mineWith([]));
	input(el, 'FIPS name', 'npub1nope');
	await submit(el);
	expect(h.save).not.toHaveBeenCalled();
	expect(el.querySelector('[role="alert"]')!.textContent).toMatch(/not a FIPS name/);
});

test('at 3 computers there is no form', async () => {
	const el = await show(mineWith([D1, D2, D3].map((n) => ({ npub: n, label: '' }))));
	expect(el.querySelector('form')).toBeNull();
	expect(el.textContent).toContain("That's the most: 3 computers.");
});

test('a refused save says why and keeps the list', async () => {
	const el = await show(mineWith([]));
	h.save.mockRejectedValue(new ContinuumError(409, 'stale', 'Continuum 409 stale'));
	input(el, 'FIPS name', D1);
	await submit(el);
	await vi.waitFor(() => expect(el.querySelector('[role="alert"]')).not.toBeNull());
	expect(el.querySelector('[role="alert"]')!.textContent).toMatch(/newer list/);
	expect(el.querySelector('ul')).toBeNull();
});

test('no FIPS on the node, or not on a project: one plain line, no form', async () => {
	let el = await show(mineWith([], { nodeNpub: null }));
	expect(el.querySelector('[data-testid="device-no-fips"]')).not.toBeNull();
	expect(el.querySelector('form')).toBeNull();
	unmount(app!);
	app = null;
	document.body.innerHTML = '';
	el = await show(mineWith([], { listed: false }));
	expect(el.querySelector('[data-testid="device-not-listed"]')).not.toBeNull();
	expect(el.querySelector('form')).toBeNull();
});

test('ADR 0021: inside Continuum, no button; its strip opens it and Close shuts it', async () => {
	const { embedState } = await import('./embedState.svelte');
	h.load.mockResolvedValue(mineWith([{ npub: D1, label: 'laptop' }]));
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(DevicePanel, { target, props: { variant: 'embed' } });
	flushSync();
	expect(target.querySelector('button')).toBeNull();
	expect(target.querySelector('[data-testid="device-panel"]')).toBeNull();
	embedState.computers = true;
	flushSync();
	await vi.waitFor(() => expect(h.load).toHaveBeenCalled());
	const panel = target.querySelector('[data-testid="device-panel"]') as HTMLElement;
	expect(panel.className).toContain('absolute');
	await vi.waitFor(() => expect(panel.textContent).toContain('laptop'));
	[...target.querySelectorAll('button')].find((b) => b.textContent === 'Close')!.click();
	flushSync();
	expect(embedState.computers).toBe(false);
	expect(target.querySelector('[data-testid="device-panel"]')).toBeNull();
});
