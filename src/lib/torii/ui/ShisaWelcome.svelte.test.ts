import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({ primary: '#45443f' }));
vi.mock('$lib/themes/appearance.svelte', () => ({
	activeTheme: () => ({ light: { primary: h.primary } })
}));

import ShisaWelcome from './ShisaWelcome.svelte';

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
});

function render(props: Record<string, unknown> = {}) {
	app = mount(ShisaWelcome, { target: document.body, props });
	flushSync();
	return document.body.querySelector('[data-testid="shisa-welcome"]')!;
}

test('the pair (AI left, mouth closed; human right, laughing) is decorative and bundled', () => {
	const el = render();
	const img = el.querySelector('img')!;
	expect(el.getAttribute('aria-hidden')).toBe('true');
	expect(img.getAttribute('alt')).toBe('');
	expect(img.getAttribute('src')).not.toMatch(/^https?:/);
	expect(img.getAttribute('width')).toBe('480');
	expect(img.getAttribute('height')).toBe('319');
});

test('ADR 0013: a grey theme shows the pair in its own colours', () => {
	h.primary = '#45443f';
	expect(render().querySelector('[data-testid="shisa-tint"]')).toBeNull();
});

test('ADR 0013: a coloured theme washes the pair in its primary', () => {
	h.primary = '#1f3f7a';
	const tint = render().querySelector<HTMLElement>('[data-testid="shisa-tint"]')!;
	expect(tint).not.toBeNull();
	expect(tint.style.getPropertyValue('--shisa-tint')).toBe('0.35');
	expect(tint.style.getPropertyValue('--shisa-mask')).toMatch(/^url\(/);
});
