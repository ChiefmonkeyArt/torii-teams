import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import AvatarImage from './avatar-image.svelte';
import { AVATAR_STATUS_KEY, type AvatarLoadingStatus } from './avatar-context.js';

/**
 * Warm-remount redraw: every mount of a warm src used to run a detached
 * `new Image()` preload (duplicated fetch/decode work) and decode the bitmap
 * asynchronously, so the avatar painted an empty circle and popped the picture
 * in on every in/out navigation. A warm remount must skip the preload, report
 * `loaded` on the first render, and decode synchronously with the paint.
 */

const harness = vi.hoisted(() => {
	const constructed: Array<{ onload: (() => void) | null; onerror: (() => void) | null }> = [];
	return {
		constructed,
		ImageStub: class {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			decode = () => Promise.resolve();
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
	vi.unstubAllGlobals();
});

test('a warm remount skips the preload, reports loaded immediately and decodes sync', async () => {
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

	// Remount (group open/close, list rebuild): no second preload, loaded on
	// the first render, and the visible img decodes synchronously with paint.
	const second = mountImage(target, src);
	flushSync();
	expect(harness.constructed.length).toBe(1);
	expect(second.status()).toBe('loaded');
	const img = target.querySelector('img')!;
	expect(img.getAttribute('decoding')).toBe('sync');
	await unmount(second.instance);
	target.remove();
});
