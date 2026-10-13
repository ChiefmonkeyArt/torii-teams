import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import MediaLightbox from './MediaLightbox.svelte';
import { closeMediaLightbox, openMediaLightbox } from '$lib/services/chatMediaLightbox.svelte';

// 1×1 transparent GIF as a data URL — decodes without any network round trip.
const PICTURE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// Synthetic events carry no active pointer, so pointer capture is stubbed and the click it
// would retarget is replayed by hand: after capture, real browsers deliver the click AT THE
// CAPTURE ELEMENT (the backdrop) even for presses on buttons and the image.
function openLightbox() {
	const target = document.createElement('div');
	document.body.append(target);
	const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
	openMediaLightbox({ url: PICTURE, filename: 'pic.gif', mime: 'image/gif' });
	const component = mount(MediaLightbox, { target });
	flushSync();
	const backdrop = target.querySelector<HTMLElement>('[role="dialog"]')!;
	return { target, component, backdrop, captureSpy };
}

function press(element: Element) {
	element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
}

afterEach(() => {
	closeMediaLightbox();
	vi.restoreAllMocks();
});

test('a toolbar press must not close the lightbox when the captured click retargets to the backdrop', async () => {
	const { target, component, backdrop, captureSpy } = openLightbox();
	press(target.querySelector('[aria-label="Zoom in"]')!);
	backdrop.click(); // the post-capture retargeted click
	flushSync();
	// Toolbar presses skip the gesture capture entirely — that capture is what made every
	// toolbar click land on the backdrop and read as "clicked outside".
	expect(captureSpy).not.toHaveBeenCalled();
	expect(target.querySelector('[role="dialog"]')).not.toBeNull();
	await unmount(component);
	target.remove();
});

test('toolbar buttons receive their own clicks, so zoom actually applies', async () => {
	const { target, component, backdrop } = openLightbox();
	expect(backdrop.textContent).toContain('100%');
	const zoomIn = target.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!;
	press(zoomIn);
	zoomIn.click();
	flushSync();
	expect(backdrop.textContent).toContain('150%');
	expect(target.querySelector('[role="dialog"]')).not.toBeNull();
	await unmount(component);
	target.remove();
});

test('only a press that starts on the backdrop closes the lightbox', async () => {
	const { target, component, backdrop } = openLightbox();
	press(target.querySelector('img')!);
	backdrop.click(); // retargeted click from a captured image press — must not close
	flushSync();
	expect(target.querySelector('[role="dialog"]')).not.toBeNull();

	press(backdrop);
	backdrop.click();
	flushSync();
	expect(target.querySelector('[role="dialog"]')).toBeNull();
	await unmount(component);
	target.remove();
});
