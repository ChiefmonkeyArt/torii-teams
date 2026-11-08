import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELEASE_DROPPED_PREFIXES, RELEASE_NOT_PRECACHED } from './releaseDropped.js';

const SCRIPT = join(process.cwd(), 'scripts/torii-brand.mjs');

const ART = join(process.cwd(), 'scripts/torii-brand');

function fixture(swFiles: string[], notPrecached = RELEASE_NOT_PRECACHED) {
	const dir = mkdtempSync(join(tmpdir(), 'brand-'));
	mkdirSync(join(dir, 'pwa'));
	mkdirSync(join(dir, '.well-known'));
	writeFileSync(join(dir, '.well-known/nostr.json'), '{}');
	writeFileSync(join(dir, 'cordn-logo.svg'), '<svg/>');
	writeFileSync(join(dir, 'robots.txt'), '');
	writeFileSync(
		join(dir, 'index.html'),
		'<meta name="apple-mobile-web-app-title" content="Cordn" />'
	);
	writeFileSync(
		join(dir, 'manifest.webmanifest'),
		JSON.stringify({ name: 'Cordn', short_name: 'Cordn', share_target: {} })
	);
	const list = swFiles.map((f) => `\`${f}\``).join(',');
	const drop = [...RELEASE_DROPPED_PREFIXES, ...notPrecached].map((p) => `\`${p}\``).join(',');
	writeFileSync(join(dir, 'service-worker.js'), `const a=[${list}],c=[${drop}];`);
	return dir;
}

function run(dir: string) {
	try {
		execFileSync(process.execPath, [SCRIPT, dir], { stdio: 'pipe' });
		return 0;
	} catch (error) {
		return (error as { status: number }).status;
	}
}

describe('torii-brand release step', () => {
	it('renames, swaps icons and drops Cordn files', () => {
		const dir = fixture(['/robots.txt', '/cordn-logo.svg', '/.well-known/nostr.json']);
		expect(run(dir)).toBe(0);
		const manifest = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'));
		expect(manifest.name).toBe('Teams');
		expect(manifest.share_target).toBeUndefined();
		expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('content="Teams"');
		expect(existsSync(join(dir, 'cordn-logo.svg'))).toBe(false);
		expect(existsSync(join(dir, '.well-known'))).toBe(false);
		const png = readFileSync(join(dir, 'pwa/icon-512.png'));
		expect(png.subarray(1, 4).toString()).toBe('PNG');
		expect(png.readUInt32BE(16)).toBe(512);
	});

	it('ships the painted shisa icons (ADR 0014)', () => {
		const dir = fixture(['/robots.txt']);
		expect(run(dir)).toBe(0);
		for (const [file, size] of [
			['icon-192.png', 192],
			['icon-512.png', 512],
			['maskable-icon-512.png', 512],
			['apple-touch-icon.png', 180]
		] as const) {
			const png = readFileSync(join(dir, 'pwa', file));
			expect(png.equals(readFileSync(join(ART, file)))).toBe(true);
			expect(png.readUInt32BE(16)).toBe(size);
		}
		const svg = readFileSync(join(dir, 'favicon.svg'), 'utf8');
		const fav = readFileSync(join(ART, 'favicon.png'));
		expect(svg).toContain(`data:image/png;base64,${fav.toString('base64')}`);
		expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/); // nothing outside
		expect(svg.length).toBeLessThan(5000);
		const manifest = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'));
		expect(manifest.background_color).toBe('#0d0a1d');
		expect(manifest.theme_color).toBe('#0d0a1d');
	});

	it('fails when the service worker would precache the install icons', () => {
		expect(run(fixture(['/robots.txt'], []))).toBe(1);
	});

	it('fails when the service worker precaches a missing file', () => {
		expect(run(fixture(['/robots.txt', '/gone.png']))).toBe(1);
	});
});
