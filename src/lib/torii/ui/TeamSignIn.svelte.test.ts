import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
	channels: { status: 'signed-out', error: '' },
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

function show() {
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(TeamSignIn, { target, props: {} });
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
