import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ADR 0012 §3: libraries only some screens need are loaded when used, so they
// stay out of what every visit downloads first. A static import brings them back.
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const staticImport = (source: string, pkg: string) =>
	new RegExp(`^\\s*import\\s+(?!type\\b)[^;]*from\\s+['"]${pkg}['"]`, 'm').test(source);

describe('start-up bundle (ADR 0012 §3)', () => {
	it('loads the QR scanner only when a scan starts', () => {
		const src = read('src/lib/components/QrScanner.svelte');
		expect(staticImport(src, 'qr-scanner')).toBe(false);
		expect(src).toContain("await import('qr-scanner')");
	});

	it('loads the camera web components after first paint', () => {
		const src = read('src/routes/+layout.svelte');
		expect(staticImport(src, '@ionic/pwa-elements/loader')).toBe(false);
		expect(src).toContain("import('@ionic/pwa-elements/loader')");
	});

	it('the check itself spots a static import', () => {
		expect(staticImport("\timport QrScanner from 'qr-scanner';", 'qr-scanner')).toBe(true);
		expect(staticImport("\timport type QrScanner from 'qr-scanner';", 'qr-scanner')).toBe(false);
	});
});
