import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
	channels: {
		status: 'signed-out',
		error: '',
		invite: null as null | {
			ownerName: string;
			projectName: string;
			personal?: boolean;
			straightIn?: boolean;
		}
	},
	signIn: vi.fn(async () => {}),
	account: null as null | { pubkey: string }
}));

vi.mock('../projectChannels.svelte', () => ({
	projectChannels: h.channels,
	signInToContinuum: h.signIn
}));
vi.mock('$lib/components/AccountLoginDialog.svelte', async () => ({
	default: (await import('./__stubs__/LoginStub.svelte')).default
}));
vi.mock('$lib/services/accountManager.svelte', () => ({
	activeAccount: {
		subscribe(run: (v: unknown) => void) {
			run(h.account);
			return () => {};
		}
	}
}));

import TeamSignIn from './TeamSignIn.svelte';

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	delete (window as { nostr?: unknown }).nostr;
	h.signIn.mockClear();
});

function show(props: { embedded?: boolean } = {}) {
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(TeamSignIn, { target, props });
	flushSync();
	return target;
}

test('consent card: says the signer asks once before any signer call', () => {
	h.account = null;
	h.channels.status = 'signed-out';
	const el = show();
	expect(el.textContent).toContain('Sign in to your team');
	expect(el.textContent).toContain('Your signer will ask once.');
	expect(el.querySelector('[data-testid="signer-hint"]')!.textContent).toMatch(/remote signer/);
	// Signed out of Nostr: the single button is the sign-in dialog trigger.
	expect(el.querySelectorAll('button').length).toBe(1);
	expect(el.querySelector('[data-testid="login-stub"]')!.textContent).toBe('Sign in');
	expect(h.signIn).not.toHaveBeenCalled();
});

test('consent card: extension hint, and the one button starts the Continuum sign-in', () => {
	(window as { nostr?: unknown }).nostr = {};
	h.account = { pubkey: 'a'.repeat(64) };
	h.channels.status = 'signed-out';
	const el = show();
	expect(el.querySelector('[data-testid="signer-hint"]')!.textContent).toMatch(/Always allow/);
	expect(h.signIn).not.toHaveBeenCalled();
	const buttons = el.querySelectorAll('button');
	expect(buttons.length).toBe(1);
	buttons[0].click();
	expect(h.signIn).toHaveBeenCalledTimes(1);
});

test('consent card: no button while signing in', () => {
	h.account = { pubkey: 'a'.repeat(64) };
	h.channels.status = 'signing-in';
	const el = show();
	expect(el.textContent).toContain('Signing in');
	expect(el.querySelector('button')).toBeNull();
});

test('invite: names the owner and project; the same one button claims it', () => {
	(window as { nostr?: unknown }).nostr = {};
	h.account = { pubkey: 'a'.repeat(64) };
	Object.assign(h.channels, {
		status: 'signed-out',
		invite: { ownerName: 'Olive', projectName: 'Studio' }
	});
	const el = show();
	expect(el.querySelector('[data-testid="invite-from"]')!.textContent).toBe(
		'Olive invited you to Studio'
	);
	expect(el.textContent).toContain('Your signer will ask once.');
	expect(el.querySelectorAll('button').length).toBe(1);
	(el.querySelector('button') as HTMLButtonElement).click();
	expect(h.signIn).toHaveBeenCalledTimes(1);
	Object.assign(h.channels, { invite: null });
});

test('invite: waiting shows who was asked and offers no signer button', () => {
	h.account = { pubkey: 'a'.repeat(64) };
	Object.assign(h.channels, {
		status: 'waiting',
		invite: { ownerName: '', projectName: 'Studio' }
	});
	const el = show();
	expect(el.querySelector('[data-testid="invite-waiting"]')!.textContent).toContain(
		'Asked the owner to let you in to Studio.'
	);
	expect(el.querySelectorAll('button').length).toBe(0);
	expect(h.signIn).not.toHaveBeenCalled();
	Object.assign(h.channels, { status: 'signed-out', invite: null });
});

test('invite: a dead or declined link shows one line and no button', () => {
	h.account = { pubkey: 'a'.repeat(64) };
	Object.assign(h.channels, {
		status: 'error',
		error: 'This invite no longer works. Ask for a new one.',
		invite: null
	});
	const el = show();
	expect(el.querySelector('[data-testid="invite-gone"]')!.textContent).toBe(
		'This invite no longer works. Ask for a new one.'
	);
	expect(el.querySelectorAll('button').length).toBe(0);
	Object.assign(h.channels, { status: 'signed-out', error: '' });
});

test('personal invite (ADR 0010): the shisa welcome, lively, and straight in', () => {
	h.account = { pubkey: 'a'.repeat(64) };
	Object.assign(h.channels, {
		status: 'signed-out',
		invite: { ownerName: 'Olive', projectName: 'Studio', personal: true, straightIn: true }
	});
	const el = show();
	const shisa = el.querySelector('[data-testid="shisa-welcome"]')!;
	expect(shisa.classList.contains('lively')).toBe(true);
	expect(shisa.getAttribute('aria-hidden')).toBe('true');
	expect(shisa.querySelector('img')!.getAttribute('alt')).toBe('');
	expect(el.querySelector('[data-testid="invite-how"]')!.textContent!.trim()).toBe(
		'Sign in and you are straight in.'
	);
	Object.assign(h.channels, { invite: null });
});

test('ask-first group link: the shisa sits still and the owner lets you in', () => {
	h.account = { pubkey: 'a'.repeat(64) };
	Object.assign(h.channels, {
		status: 'signed-out',
		invite: { ownerName: 'Olive', projectName: 'Studio', personal: false, straightIn: false }
	});
	const el = show();
	expect(el.querySelector('[data-testid="shisa-welcome"]')!.classList.contains('lively')).toBe(
		false
	);
	expect(el.querySelector('[data-testid="invite-how"]')!.textContent!.trim()).toBe(
		'Sign in, then Olive lets you in.'
	);
	Object.assign(h.channels, { invite: null });
});

test('no invite: no shisa', () => {
	h.account = null;
	Object.assign(h.channels, { status: 'signed-out', invite: null });
	const el = show();
	expect(el.querySelector('[data-testid="shisa-welcome"]')).toBeNull();
});

test('plain sign-in (ADR 0014): the painted logo above the name, decorative', () => {
	h.account = null;
	Object.assign(h.channels, { status: 'signed-out', invite: null });
	const el = show();
	const logo = el.querySelector('[data-testid="teams-logo"]') as HTMLImageElement;
	expect(logo.getAttribute('src')).toMatch(/shisa-logo.*\.webp/);
	expect(logo.getAttribute('alt')).toBe('');
	expect(logo.getAttribute('aria-hidden')).toBe('true');
	expect(el.querySelector('h1')!.textContent).toBe('Teams');
});

test('inside Continuum or with an invite: no logo', () => {
	h.account = null;
	Object.assign(h.channels, { status: 'signed-out', invite: null });
	let el = show({ embedded: true });
	expect(el.querySelector('[data-testid="teams-logo"]')).toBeNull();
	unmount(app!);
	app = null;
	Object.assign(h.channels, {
		invite: { ownerName: 'Olive', projectName: 'Studio', personal: true, straightIn: true }
	});
	el = show();
	expect(el.querySelector('[data-testid="teams-logo"]')).toBeNull();
	expect(el.querySelector('[data-testid="shisa-welcome"]')).not.toBeNull();
	Object.assign(h.channels, { invite: null });
});
