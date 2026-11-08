#!/usr/bin/env node
// Torii release step (ADR 0005): white-label the built app in place.
// Usage: node scripts/torii-brand.mjs <build-dir>
// - manifest: name "Teams", no share target (the Torii UI has no share screen)
// - index.html: app title "Teams"
// - icons: the painted shisa pair (ADR 0014), copied from scripts/torii-brand/
// - drops Cordn's logos and store badges (only upstream routes use them)
import {
	copyFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	RELEASE_DROPPED_PREFIXES,
	RELEASE_NOT_PRECACHED
} from '../src/lib/torii/releaseDropped.js';

const NAME = 'Teams';

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, 'index.html'))) {
	console.error('usage: torii-brand.mjs <build-dir>');
	process.exit(2);
}

// Painted shisa icons (ADR 0014), kept beside this script. The favicon is
// an SVG so the app's /favicon.svg links and notification icon stay as they
// are: a 48 px PNG (sharp up to 24 px on a 2x screen) in a rounded clip, about 4 KB.
const ART = join(dirname(fileURLToPath(import.meta.url)), 'torii-brand');
const ICONS = ['icon-192.png', 'icon-512.png', 'maskable-icon-512.png', 'apple-touch-icon.png'];
const BG = '#0d0a1d'; // the icons' own background, for the install splash
function faviconSvg(png) {
	return (
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
		'<clipPath id="r"><rect width="32" height="32" rx="6"/></clipPath>' +
		`<image clip-path="url(#r)" width="32" height="32" href="data:image/png;base64,${png.toString('base64')}"/>` +
		'</svg>\n'
	);
}

// --- apply --------------------------------------------------------------
const manifestPath = join(dir, 'manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.name = NAME;
manifest.short_name = NAME;
manifest.description = 'Private team chat.';
manifest.background_color = BG;
manifest.theme_color = BG;
delete manifest.share_target;
delete manifest.categories;
writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');

const indexPath = join(dir, 'index.html');
const html = readFileSync(indexPath, 'utf8').replace(
	/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/,
	`$1${NAME}$2`
);
writeFileSync(indexPath, html);

writeFileSync(join(dir, 'favicon.svg'), faviconSvg(readFileSync(join(ART, 'favicon.png'))));
for (const file of ICONS) copyFileSync(join(ART, file), join(dir, 'pwa', file));

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
if (
	![...RELEASE_DROPPED_PREFIXES, ...RELEASE_NOT_PRECACHED].every((p) => sw.includes(`\`${p}\``))
) {
	console.error('torii-brand: service worker was not built with the release drop list');
	process.exit(1);
}
if (missing.length) {
	console.error(`torii-brand: service worker precaches missing files: ${missing.join(', ')}`);
	process.exit(1);
}
console.log('torii-brand: done');
