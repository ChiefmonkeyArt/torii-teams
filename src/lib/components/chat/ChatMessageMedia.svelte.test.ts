import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import ChatMessageMedia from './ChatMessageMedia.svelte';

/**
 * Broken-media blink loop: a permanently dead blob link used to re-fetch on
 * every virtualized-row remount and messages-array identity change — the
 * component's `failed` state died with the instance while successes were
 * remembered in module scope. The failure memory must make remounts settle on
 * the error card without a second fetch, and the retry tap must clear it.
 */
const harness = vi.hoisted(() => ({
	// A reactive set: the real failure memory is a SvelteSet, and the retry
	// path relies on `delete` re-running the component's resolve effect.
	failedHashes: null as unknown as {
		has(hash: string): boolean;
		add(hash: string): void;
		delete(hash: string): void;
	},
	resolveCalls: 0
}));

vi.mock('$lib/services/chatMediaStorage.svelte', async () => {
	const { SvelteSet } = await import('svelte/reactivity');
	const failedHashes = new SvelteSet<string>();
	harness.failedHashes = failedHashes;
	return {
		getMediaAutoLoad: () => true,
		isMessageMediaLoaded: () => false,
		markMessageMediaLoaded: () => {},
		cancelMediaUpload: () => {},
		mediaUploadProgress: {},
		resolveMessageMedia: () => {
			harness.resolveCalls++;
			return Promise.reject(new Error('blob gone'));
		},
		peekMessageMedia: () => ({
			url: 'https://store.example/blobs/ab',
			mime: 'image/png',
			filename: 'pic.png',
			plaintextHashHex: 'ab'.repeat(32),
			nonceHex: '00'.repeat(24),
			version: 1
		}),
		isMessageMediaFailed: (hash: string) => failedHashes.has(hash),
		markMessageMediaFailed: (hash: string) => failedHashes.add(hash),
		clearMessageMediaFailure: (hash: string) => failedHashes.delete(hash)
	};
});

const REF_HASH = 'ab'.repeat(32);

function message() {
	return {
		media: undefined,
		tags: [['imeta', `url https://store.example/blobs/ab`, 'm image/png', `x ${REF_HASH}`]],
		mediaKeyBase64: 'a2V5',
		deliveryState: 'sent' as const,
		eventId: 'evt-1'
	};
}

async function mountMedia() {
	const target = document.createElement('div');
	document.body.append(target);
	const component = mount(ChatMessageMedia, { target, props: { message: message() } });
	flushSync();
	// Let the rejected promise land and the effect continuation finish.
	await new Promise((resolve) => setTimeout(resolve, 0));
	return { target, component };
}

afterEach(() => {
	document.body.innerHTML = '';
});

test('a dead media link resolves once and settles on the error card', async () => {
	const { target, component } = await mountMedia();
	expect(harness.resolveCalls).toBe(1);
	expect(target.textContent).toContain("Couldn't load media");
	await unmount(component);
});

test('a remount reuses the remembered failure instead of re-fetching', async () => {
	const first = await mountMedia();
	expect(harness.resolveCalls).toBe(1);
	await unmount(first.component);

	const second = await mountMedia();
	expect(harness.resolveCalls).toBe(1); // the old behavior re-fetched here, forever
	expect(second.target.textContent).toContain("Couldn't load media");
	await unmount(second.component);
});

test('tapping the error card clears the failure and retries', async () => {
	const { target, component } = await mountMedia();
	target.querySelector<HTMLButtonElement>('button[title="Retry loading media"]')!.click();
	flushSync();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(harness.resolveCalls).toBe(2);
	expect(harness.failedHashes.has(REF_HASH)).toBe(true); // still dead → marked again
	await unmount(component);
});
