import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import AvatarImage from './avatar-image.svelte';
import { AVATAR_STATUS_KEY, type AvatarLoadingStatus } from './avatar-context.js';

/**
 * Warm-remount redraw: a src that loaded earlier this session must report
 * `loaded` on the first render of a remount (group open/close, chat list
 * rebuild) — never a fallback-circle flash while a cached re-fetch happens.
 * The detached re-preload on remount is allowed (it's the master pipeline);
 * only the no-flash guarantee is asserted.
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

test('a warm remount reports loaded on the first render (no fallback flash)', async () => {
	vi.stubGlobal('Image', harness.ImageStub);
	const target = document.createElement('div');
	document.body.append(target);
	const src = `https://img.example/avatar-${Math.random()}.png`;

	const first = mountImage(target, src);
	flushSync();
	expect(first.status()).toBe('loading');
	harness.constructed[0].onload?.();
	await vi.waitFor(() => expect(first.status()).toBe('loaded'));
	await unmount(first.instance);

	const second = mountImage(target, src);
	flushSync();
	expect(second.status()).toBe('loaded');
	await unmount(second.instance);
	target.remove();
});
