#!/usr/bin/env node
// Torii release step (ADR 0005): white-label the built app in place.
// Usage: node scripts/torii-brand.mjs <build-dir>
// - manifest: name "Teams", no share target (the Torii UI has no share screen)
// - index.html: app title "Teams"
// - icons: a plain "T" mark (SVG + PNGs generated here, no dependencies)
// - drops Cordn's logos and store badges (only upstream routes use them)
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { RELEASE_DROPPED_PREFIXES } from '../src/lib/torii/releaseDropped.js';

const NAME = 'Teams';
const BG = [17, 24, 39]; // #111827
const FG = [255, 255, 255];

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, 'index.html'))) {
	console.error('usage: torii-brand.mjs <build-dir>');
	process.exit(2);
}

// --- PNG (RGB, filter 0) -------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c;
});
function crc32(buf) {
	let c = -1;
	for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}
/** A size×size icon: background, a centred "T" covering `scale` of the side. */
export function iconPng(size, scale = 0.56) {
	const t = Math.round(size * scale);
	const x0 = Math.round((size - t) / 2);
	const y0 = x0;
	const bar = Math.max(1, Math.round(t * 0.2));
	const stemX = Math.round(size / 2 - bar / 2);
	const raw = Buffer.alloc((size * 3 + 1) * size);
	for (let y = 0; y < size; y++) {
		const row = y * (size * 3 + 1);
		raw[row] = 0;
		for (let x = 0; x < size; x++) {
			const top = y >= y0 && y < y0 + bar && x >= x0 && x < x0 + t;
			const stem = y >= y0 && y < y0 + t && x >= stemX && x < stemX + bar;
			const c = top || stem ? FG : BG;
			raw.set(c, row + 1 + x * 3);
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // RGB
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#111827"/><path fill="#fff" d="M18 18h28v7H35.5v21h-7V25H18z"/></svg>\n`;

// --- apply --------------------------------------------------------------
const manifestPath = join(dir, 'manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.name = NAME;
manifest.short_name = NAME;
manifest.description = 'Private team chat.';
manifest.background_color = '#111827';
manifest.theme_color = '#111827';
delete manifest.share_target;
delete manifest.categories;
writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');

const indexPath = join(dir, 'index.html');
const html = readFileSync(indexPath, 'utf8').replace(
	/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/,
	`$1${NAME}$2`
);
writeFileSync(indexPath, html);

writeFileSync(join(dir, 'favicon.svg'), SVG);
const icons = {
	'pwa/icon-192.png': [192, 0.56],
	'pwa/icon-512.png': [512, 0.56],
	'pwa/maskable-icon-512.png': [512, 0.4], // inside the maskable safe zone
	'pwa/apple-touch-icon.png': [180, 0.56]
};
for (const [file, [size, scale]] of Object.entries(icons)) {
	writeFileSync(join(dir, file), iconPng(size, scale));
}

for (const name of readdirSync(dir)) {
	if (RELEASE_DROPPED_PREFIXES.some((p) => `/${name}`.startsWith(p) || `/${name}/`.startsWith(p))) {
		rmSync(join(dir, name), { recursive: true, force: true });
	}
}

const left = readFileSync(indexPath, 'utf8').match(/Cordn/g)?.length ?? 0;
if (left) {
	console.error(`torii-brand: index.html still mentions Cordn ${left}×`);
	process.exit(1);
}
// Every file the service worker precaches must exist, or its install fails.
const sw = readFileSync(join(dir, 'service-worker.js'), 'utf8');
const missing = [...sw.matchAll(/`(\/[^`$]+\.[a-z0-9]+)`/gi)]
	.map((m) => m[1])
	.filter((f) => !['/index.html', '/200.html'].includes(f))
	.filter((f) => !RELEASE_DROPPED_PREFIXES.some((p) => f.startsWith(p)))
	.filter((f) => !existsSync(join(dir, f)));
if (!RELEASE_DROPPED_PREFIXES.every((p) => sw.includes(`\`${p}\``))) {
	console.error('torii-brand: service worker was not built with the release drop list');
	process.exit(1);
}
if (missing.length) {
	console.error(`torii-brand: service worker precaches missing files: ${missing.join(', ')}`);
	process.exit(1);
}
console.log('torii-brand: done');
