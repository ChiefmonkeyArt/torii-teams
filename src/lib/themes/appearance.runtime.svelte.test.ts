import { describe, it, expect, vi } from 'vitest';
import {
	initAppearance,
	setTheme,
	appearance,
	forkTheme,
	saveCustomTheme,
	deleteCustomTheme,
	importTheme
} from './appearance.svelte';
import { CLASSIC_THEME } from './builtin';

/**
 * Runtime mechanics verified in a real browser: localStorage, the injected
 * #cordn-theme style element, cascade specificity over layout.css defaults,
 * and the light/dark pair behavior. Runs as one ordered scenario because
 * initAppearance() is module-guarded (single boot per page).
 */
describe('appearance runtime', () => {
	it('boots, switches, previews, saves, deletes, and imports themes', async () => {
		localStorage.clear();
		document.getElementById('cordn-theme')?.remove();
		// "Fresh profile" also means no chat database: the one-time migration
		// treats any existing Cordn database as a pre-theming install and keeps
		// Classic. The storage contract tests share this origin and leave that
		// database behind, which made this boot depend on file order — simulate
		// the one side of "fresh" the test cannot arrange for real.
		vi.stubGlobal('indexedDB', { databases: async () => [] });

		// Fresh profile → lower-contrast Soft default, applied as CSS vars.
		await initAppearance();
		expect(appearance.activeThemeId).toBe('soft');
		expect(cssVar('--background')).toBe('#f5f5f2');
		expect(document.getElementById('cordn-theme')).toBeTruthy();
		expect(localStorage.getItem('cordn.theme')).toBe('soft');
		vi.unstubAllGlobals();

		// Switching to Classic repaints and persists.
		setTheme(CLASSIC_THEME.id);
		expect(cssVar('--background')).toBe('#ffffff');
		expect(localStorage.getItem('cordn.theme')).toBe('classic');

		// The dark variant must win the cascade when mode-watcher adds .dark.
		document.documentElement.classList.add('dark');
		expect(cssVar('--background')).toBe('#0a0a0a');
		document.documentElement.classList.remove('dark');
		expect(cssVar('--background')).toBe('#ffffff');

		// Fork a built-in into a custom theme, edit, and it round-trips through storage.
		const fork = forkTheme(CLASSIC_THEME);
		fork.light.background = '#101010';
		saveCustomTheme(fork);
		expect(appearance.activeThemeId).toBe(fork.id);
		expect(cssVar('--background')).toBe('#101010');
		const stored = JSON.parse(localStorage.getItem('cordn.customThemes') ?? '[]');
		expect(stored).toHaveLength(1);
		expect(stored[0].light.background).toBe('#101010');

		// Deleting the active custom theme falls back to the Soft default.
		deleteCustomTheme(fork.id);
		expect(appearance.activeThemeId).toBe('soft');
		expect(cssVar('--background')).toBe('#f5f5f2');

		// Import: valid payload is sanitized and activated; garbage is rejected.
		const json = JSON.stringify({
			format: 'cordn-theme',
			version: 1,
			name: 'Imported',
			light: { background: '#123456', foreground: 'javascript:' },
			dark: {}
		});
		const imported = importTheme(json);
		expect(imported).not.toBeNull();
		expect(imported!.light.background).toBe('#123456');
		expect(imported!.light.foreground).toBe('#41413d'); // invalid value fell back
		expect(cssVar('--background')).toBe('#123456');
		expect(importTheme('not json')).toBeNull();
	});
});

function cssVar(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
