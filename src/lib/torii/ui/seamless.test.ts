// ADR 0023: the project chat feels like part of Continuum.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	canMarkRead,
	initialShown,
	projectPageState,
	readyReport,
	searchMessage,
	SETTLE_MS,
	settleDelay,
	unreadReport,
	visibleMessage
} from './embed';
import { BUILTIN_THEMES, CONTINUUM_THEME } from '$lib/themes/builtin';
import { themeCss } from '$lib/themes/appearance.svelte';

const parent = {} as Window;
const C = 'https://continuum.x';
const ev = (data: unknown, over: Partial<MessageEvent> = {}) =>
	({ origin: C, source: parent, data, ...over }) as never;

describe('torii:visible and torii:search', () => {
	it('reads on/off and search from Continuum only', () => {
		expect(visibleMessage(ev({ type: 'torii:visible', on: false }), parent, C)).toBe(false);
		expect(visibleMessage(ev({ type: 'torii:visible', on: true }), parent, C)).toBe(true);
		expect(visibleMessage(ev({ type: 'torii:visible', on: 'yes' }), parent, C)).toBeNull();
		expect(
			visibleMessage(ev({ type: 'torii:visible', on: false }, { origin: 'https://e.x' }), parent, C)
		).toBeNull();
		expect(searchMessage(ev({ type: 'torii:search' }), parent, C)).toBe(true);
		expect(searchMessage(ev({ type: 'torii:search' }, { source: {} as Window }), parent, C)).toBe(
			false
		);
		expect(searchMessage(ev({ type: 'torii:search' }), parent, undefined)).toBe(false);
	});
});

describe('read only while seen', () => {
	it('a frame Continuum has not shown yet starts hidden', () => {
		expect(initialShown(new URL('https://t.x/chat?embed=1&mode=dark&hidden=1'))).toBe(false);
		expect(initialShown(new URL('https://t.x/chat/p/a?embed=1&mode=dark'))).toBe(true);
		expect(initialShown(new URL('https://t.x/chat?hidden=1'))).toBe(true);
	});
	it('needs a visible page, and inside Continuum a shown frame', () => {
		expect(canMarkRead(true, false, false)).toBe(true);
		expect(canMarkRead(true, true, true)).toBe(true);
		expect(canMarkRead(true, true, false)).toBe(false);
		expect(canMarkRead(false, false, true)).toBe(false);
	});
});

describe('reports out', () => {
	it('unread: valid slugs, whole non-negative numbers only', () => {
		expect(unreadReport({ a: 2, 'b-c': 0, 'Bad slug': 3, d: -1, e: 1.7, f: NaN })).toEqual({
			type: 'torii:unread',
			counts: { a: 2, 'b-c': 0, d: 0, e: 1 }
		});
	});
	it('ready: the slug, or nothing', () => {
		expect(readyReport('proj')).toEqual({ type: 'torii:ready', slug: 'proj' });
		expect(readyReport('../x')).toBeNull();
	});
});

describe('no false states', () => {
	it('loading until the project list has loaded', () => {
		for (const s of ['off', 'signing-in', 'loading', 'signed-out', 'waiting'])
			expect(projectPageState(s, false)).toBe('loading');
		expect(projectPageState('ready', false)).toBe('missing');
		expect(projectPageState('error', false)).toBe('missing');
		expect(projectPageState('loading', true)).toBe('chat');
	});
	it('a new warning waits; hiding or changing is at once', () => {
		expect(SETTLE_MS).toBe(3000);
		expect(settleDelay('', '2 not joined yet')).toBe(SETTLE_MS);
		expect(settleDelay(false, true)).toBe(SETTLE_MS);
		expect(settleDelay('2 not joined yet', '')).toBe(0);
		expect(settleDelay('2 not joined yet', '1 not joined yet')).toBe(0);
	});
});

describe('Continuum font and assistant bar', () => {
	const css = themeCss(CONTINUUM_THEME);
	it('uses Continuum font stack, copied from its theme.css', () => {
		const cont = readFileSync('src/lib/themes/builtin.ts', 'utf8');
		expect(cont).toContain(CONTINUUM_THEME.fontFamily!);
		expect(css).toContain(`:root:root{font-family:${CONTINUUM_THEME.fontFamily}}`);
	});
	it('shapes the composer like the assistant bar', () => {
		expect(css).toContain('.chat-composer-expand{display:none}');
		expect(css).toContain('.chat-composer-send-label{display:inline}');
		expect(css).toContain('.chat-composer-send-icon{display:none}');
		expect(css).toMatch(/\.chat-composer-input\{min-height:40px!important;border-radius:10px\}/);
	});
	it('leaves every standalone theme alone', () => {
		for (const t of BUILTIN_THEMES) {
			expect(themeCss(t)).not.toContain('chat-composer');
			expect(themeCss(t)).not.toContain('font-family');
		}
	});
	it('refuses a font value that could break out of the rule', () => {
		expect(themeCss({ ...CONTINUUM_THEME, fontFamily: 'x}body{color:red' })).not.toContain(
			'font-family'
		);
	});
});

describe('components carry the hooks', () => {
	it('composer and + button are tagged; project chats get voice notes', () => {
		const composer = readFileSync('src/lib/components/chat/ChatComposer.svelte', 'utf8');
		for (const c of ['chat-composer-expand', 'chat-composer-input', 'chat-composer-send-label'])
			expect(composer).toContain(c);
		expect(composer).not.toMatch(/showMic = \$derived\(\s*!minimal/);
		expect(readFileSync('src/lib/components/chat/ChatComposerActions.svelte', 'utf8')).toContain(
			'chat-composer-plus'
		);
	});
	it('project chat opens at the latest, marker kept', () => {
		const shell = readFileSync('src/lib/components/chat/ChatShell.svelte', 'utf8');
		expect(shell).toContain('initialFocusCursor={openFocusCursor}');
		expect(shell).toContain('markerCursor={unreadMarkerCursor}');
		expect(shell).toMatch(/openFocusCursor = \$derived\(minimal \? 0 : initialFocusCursor\)/);
	});
});
