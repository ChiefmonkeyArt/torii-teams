import { expect, test } from 'vitest';
import { BUILTIN_THEMES } from '$lib/themes/builtin';
import { hexSaturation, shisaTint, SHISA_TINT } from './shisaTint';

test('saturation of hex colours', () => {
	expect(hexSaturation('#808080')).toBe(0);
	expect(hexSaturation('#f00')).toBeCloseTo(1);
	expect(hexSaturation('#1f3f7a')).toBeGreaterThan(0.5);
	expect(hexSaturation('#1f3f7aff')).toBeGreaterThan(0.5);
	expect(hexSaturation('navy')).toBeNull();
	expect(hexSaturation('#12345')).toBeNull();
});

test('ADR 0013: grey primaries get no wash, coloured ones get 35%', () => {
	const tint = Object.fromEntries(BUILTIN_THEMES.map((t) => [t.id, shisaTint(t.light.primary)]));
	expect(tint.classic).toBe(0);
	expect(tint.soft).toBe(0);
	for (const id of ['matrix', 'cypherpunk', 'navy', 'warm-paper', 'catppuccin', 'ostrich']) {
		expect(tint[id], id).toBe(SHISA_TINT);
	}
	expect(shisaTint('not a colour')).toBe(0);
});
