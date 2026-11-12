// ADR 0021: the project chat looks like Continuum.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	applyEmbedMode,
	embedModeFromUrl,
	membersReport,
	openComputersMessage,
	themeModeMessage
} from './embed';
import { BUILTIN_THEMES, CONTINUUM_THEME } from '$lib/themes/builtin';
import { themeCss } from '$lib/themes/appearance.svelte';

const parent = {} as Window;
const C = 'https://continuum.x';
const ev = (data: unknown, over: Partial<MessageEvent> = {}) =>
	({ origin: C, source: parent, data, ...over }) as never;

describe('embedModeFromUrl', () => {
	it('reads dark or light, only with embed=1', () => {
		expect(embedModeFromUrl(new URL('https://t.x/chat/p/a?embed=1&mode=dark'))).toBe('dark');
		expect(embedModeFromUrl(new URL('https://t.x/chat?embed=1&mode=light'))).toBe('light');
		expect(embedModeFromUrl(new URL('https://t.x/chat?embed=1'))).toBeNull();
		expect(embedModeFromUrl(new URL('https://t.x/chat?mode=dark'))).toBeNull();
		expect(embedModeFromUrl(new URL('https://t.x/chat?embed=1&mode=red'))).toBeNull();
	});
});

describe('torii:theme', () => {
	it('takes dark or light from Continuum', () => {
		expect(themeModeMessage(ev({ type: 'torii:theme', mode: 'dark' }), parent, C)).toBe('dark');
		expect(themeModeMessage(ev({ type: 'torii:theme', mode: 'light' }), parent, C)).toBe('light');
	});
	it('ignores other origins, windows, values and messages', () => {
		const ok = { type: 'torii:theme', mode: 'dark' };
		expect(themeModeMessage(ev(ok, { origin: 'https://evil.x' }), parent, C)).toBeNull();
		expect(themeModeMessage(ev(ok, { source: {} as Window }), parent, C)).toBeNull();
		expect(themeModeMessage(ev(ok), parent, undefined)).toBeNull();
		expect(themeModeMessage(ev(ok), null, C)).toBeNull();
		for (const mode of ['red', '', null, 1, { css: 'x' }])
			expect(themeModeMessage(ev({ type: 'torii:theme', mode }), parent, C)).toBeNull();
		expect(themeModeMessage(ev({ type: 'torii:navigate', mode: 'dark' }), parent, C)).toBeNull();
		expect(themeModeMessage(ev(null), parent, C)).toBeNull();
		expect(themeModeMessage(ev('torii:theme'), parent, C)).toBeNull();
	});
});

describe('torii:open-computers', () => {
	it('only from Continuum', () => {
		expect(openComputersMessage(ev({ type: 'torii:open-computers' }), parent, C)).toBe(true);
		const bad = { type: 'torii:open-computers' };
		expect(openComputersMessage(ev(bad, { origin: 'https://evil.x' }), parent, C)).toBe(false);
		expect(openComputersMessage(ev(bad, { source: {} as Window }), parent, C)).toBe(false);
		expect(openComputersMessage(ev({ type: 'torii:theme' }), parent, C)).toBe(false);
	});
});

describe('applyEmbedMode', () => {
	it('sets or clears .dark', () => {
		const set = new Set<string>();
		const root = {
			classList: { toggle: (c: string, on: boolean) => (on ? set.add(c) : set.delete(c)) }
		};
		applyEmbedMode(root as never, 'dark');
		expect(set.has('dark')).toBe(true);
		applyEmbedMode(root as never, 'light');
		expect(set.has('dark')).toBe(false);
	});
});

describe('membersReport', () => {
	it('counts only', () => {
		const r = membersReport('website', ['a'.repeat(64), 'b'.repeat(64)], ['c'.repeat(64)]);
		expect(r).toEqual({ type: 'torii:members', slug: 'website', joined: 2, waiting: 1 });
		expect(JSON.stringify(r)).not.toContain('aaaa');
	});
	it('refuses a bad slug', () => {
		expect(membersReport('../x', [], [])).toBeNull();
	});
});

describe('CONTINUUM_THEME', () => {
	it('copies Continuum theme.css (dark card, amber primary; light white card)', () => {
		expect(CONTINUUM_THEME.dark.background).toBe('#221f1c');
		expect(CONTINUUM_THEME.dark.primary).toBe('#f6ae31');
		expect(CONTINUUM_THEME.dark.border).toBe('#38332e');
		expect(CONTINUUM_THEME.light.background).toBe('#ffffff');
		expect(CONTINUUM_THEME.light.primary).toBe('#e18b09');
	});
	it('is not in the gallery', () => {
		expect(BUILTIN_THEMES.some((t) => t.id === 'continuum')).toBe(false);
	});
	it('app.html paints it first, inside Continuum only', () => {
		const html = readFileSync('src/app.html', 'utf8');
		expect(html).toContain(themeCss(CONTINUUM_THEME));
		expect(html).toMatch(/get\('embed'\) === '1'/);
	});
});
