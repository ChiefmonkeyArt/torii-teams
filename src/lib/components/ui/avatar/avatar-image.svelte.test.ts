import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import AvatarImage from './avatar-image.svelte';
import { AVATAR_STATUS_KEY, type AvatarLoadingStatus } from './avatar-context.js';

/**
 * Warm-remount redraw: a warm src must report `loaded` on the first render and
 * skip the detached `new Image()` preload (duplicated fetch work), and warmth
 * must never expire — a bounded cache evicted older chats' avatars and
 * reintroduced the fallback flash on remount (the blink this exists to kill).
 */

const harness = vi.hoisted(() => {
	const constructed: Array<{ onload: (() => void) | null; onerror: (() => void) | null }> = [];
	return {
		constructed,
		ImageStub: class {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			set src(_value: string) {
				constructed.push(this);
			}
		}
	};
});

function mountImage(target: HTMLElement, src: string) {
	let status: AvatarLoadingStatus = 'loading';
	const context = new Map([
		[
			AVATAR_STATUS_KEY,
			{
				get status() {
					return status;
				},
				set: (next: AvatarLoadingStatus) => {
					status = next;
				}
			}
		]
	]);
	const instance = mount(AvatarImage, { target, props: { src }, context });
	return { instance, status: () => status };
}

afterEach(() => {
	harness.constructed.length = 0;
	vi.unstubAllGlobals();
});

test('a warm remount skips the preload and reports loaded on the first render', async () => {
	vi.stubGlobal('Image', harness.ImageStub);
	const target = document.createElement('div');
	document.body.append(target);
	const src = `https://img.example/avatar-${Math.random()}.png`;

	const first = mountImage(target, src);
	flushSync();
	expect(harness.constructed.length).toBe(1); // cold mount preloads once
	expect(first.status()).toBe('loading');
	harness.constructed[0].onload?.();
	await vi.waitFor(() => expect(first.status()).toBe('loaded'));
	await unmount(first.instance);

	// Remount (group open/close, chat list rebuild): no second preload and
	// loaded on the first render — the fallback circle never shows.
	const second = mountImage(target, src);
	flushSync();
	expect(harness.constructed.length).toBe(1);
	expect(second.status()).toBe('loaded');
	await unmount(second.instance);
	target.remove();
});

test('a warm src stays warm no matter how many other avatars load', async () => {
	vi.stubGlobal('Image', harness.ImageStub);
	const target = document.createElement('div');
	document.body.append(target);

	const first = `https://img.example/first-${Math.random()}.png`;
	const a = mountImage(target, first);
	flushSync();
	harness.constructed[0].onload?.();
	await vi.waitFor(() => expect(a.status()).toBe('loaded'));
	await unmount(a.instance);

	// Far beyond any plausible bound: warmth is a string set, so eviction
	// cannot reintroduce the fallback flash on the remount below.
	for (let i = 0; i < 64; i++) {
		const src = `https://img.example/other-${i}-${Math.random()}.png`;
		const other = mountImage(target, src);
		flushSync();
		harness.constructed.at(-1)!.onload?.();
		await vi.waitFor(() => expect(other.status()).toBe('loaded'));
		await unmount(other.instance);
	}
	const warmRemount = mountImage(target, first);
	flushSync();
	expect(warmRemount.status()).toBe('loaded');
	expect(harness.constructed.length).toBe(65); // 65 loads, zero re-probes
	await unmount(warmRemount.instance);
	target.remove();
});
