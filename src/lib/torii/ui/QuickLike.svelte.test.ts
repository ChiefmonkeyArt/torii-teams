import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import QuickLike from './QuickLike.svelte';

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

function show(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.append(target);
	app = mount(QuickLike, { target, props: props as never });
	flushSync();
	return target.querySelector<HTMLButtonElement>('[data-testid="quick-like"]')!;
}

const press = (el: Element, type: string, init: PointerEventInit = {}) =>
	el.dispatchEvent(
		new PointerEvent(type, { bubbles: true, button: 0, pointerType: 'touch', ...init })
	);

test('one tap likes; it does not open the emoji row', () => {
	vi.useFakeTimers();
	const onLike = vi.fn();
	const onHold = vi.fn();
	const el = show({ onLike, onHold });
	press(el, 'pointerdown');
	vi.advanceTimersByTime(100);
	press(el, 'pointerup');
	el.click();
	vi.advanceTimersByTime(1000);
	expect(onLike).toHaveBeenCalledTimes(1);
	expect(onHold).not.toHaveBeenCalled();
	expect(el.getAttribute('aria-pressed')).toBe('false');
	expect(el.getAttribute('aria-label')).toBe('Thumbs up. Press and hold for more');
});

test('press and hold opens the emoji row and does not like', () => {
	vi.useFakeTimers();
	const onLike = vi.fn();
	const onHold = vi.fn();
	const el = show({ onLike, onHold });
	press(el, 'pointerdown');
	vi.advanceTimersByTime(460);
	// Opens on release, so the release can't close it again.
	expect(onHold).not.toHaveBeenCalled();
	press(el, 'pointerup');
	expect(onHold).toHaveBeenCalledWith(true);
	el.click();
	expect(onLike).not.toHaveBeenCalled();
	// The next plain tap likes again.
	el.click();
	expect(onLike).toHaveBeenCalledTimes(1);
});

test('a mouse hold opens the menu, moving away cancels the hold', () => {
	vi.useFakeTimers();
	const onHold = vi.fn();
	const el = show({ onLike: vi.fn(), onHold });
	press(el, 'pointerdown', { pointerType: 'mouse' });
	vi.advanceTimersByTime(460);
	press(el, 'pointerup', { pointerType: 'mouse' });
	expect(onHold).toHaveBeenCalledWith(false);
	press(el, 'pointerdown', { clientX: 0, clientY: 0 });
	press(el, 'pointermove', { clientX: 30, clientY: 0 });
	vi.advanceTimersByTime(1000);
	expect(onHold).toHaveBeenCalledTimes(1);
});

test('right-click opens the emoji row; liked shows as pressed', () => {
	const onHold = vi.fn();
	const el = show({ onLike: vi.fn(), onHold, active: true });
	el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
	expect(onHold).toHaveBeenCalledWith(false);
	expect(el.getAttribute('aria-pressed')).toBe('true');
	expect(el.getAttribute('aria-label')).toBe('Remove your thumbs up');
});

test('the press does not reach the bubble (no long-press sheet or swipe)', () => {
	const outer = vi.fn();
	const el = show({ onLike: vi.fn(), onHold: vi.fn() });
	document.body.addEventListener('pointerdown', outer);
	press(el, 'pointerdown');
	document.body.removeEventListener('pointerdown', outer);
	expect(outer).not.toHaveBeenCalled();
});

test('a touch long-press that ends in contextmenu opens the row once', () => {
	vi.useFakeTimers();
	const onHold = vi.fn();
	const onLike = vi.fn();
	const el = show({ onLike, onHold });
	press(el, 'pointerdown');
	vi.advanceTimersByTime(460);
	el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
	press(el, 'pointercancel');
	expect(onHold).toHaveBeenCalledTimes(1);
	expect(onHold).toHaveBeenCalledWith(true);
	expect(onLike).not.toHaveBeenCalled();
});
