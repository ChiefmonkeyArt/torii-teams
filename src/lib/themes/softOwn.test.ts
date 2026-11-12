// ADR 0022: inside Continuum, own messages are a soft amber tint.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mixHex, OWN_TINT, themeCss } from './appearance.svelte';
import { BUILTIN_THEMES, CONTINUUM_THEME } from './builtin';
import { contrastRatio } from './contrast';

describe('mixHex', () => {
	it('mixes two colours', () => {
		expect(mixHex('#ffffff', '#000000', 0)).toBe('#000000');
		expect(mixHex('#ffffff', '#000000', 1)).toBe('#ffffff');
		expect(mixHex('#ff0000', '#0000ff', 0.5)).toBe('#800080');
	});
});

describe('soft own bubbles', () => {
	it('only the Continuum theme has them; standalone themes keep solid primary', () => {
		expect(themeCss(CONTINUUM_THEME)).toContain('.chat-own{');
		for (const t of BUILTIN_THEMES) expect(themeCss(t)).not.toContain('.chat-own');
	});

	it('text on the tint passes AA (4.5:1) in light and dark', () => {
		for (const set of [CONTINUUM_THEME.light, CONTINUUM_THEME.dark]) {
			const tint = mixHex(set.primary, set.background, OWN_TINT);
			expect(contrastRatio(set.foreground, tint)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('own bubbles carry the chat-own hook, failed sends do not', () => {
		const src = readFileSync('src/lib/components/chat/ChatMessageItem.svelte', 'utf8');
		expect(src).toContain("'chat-own border-primary bg-primary text-primary-foreground'");
		expect(src).toContain("'border-destructive/40 bg-primary text-primary-foreground'");
	});
});
