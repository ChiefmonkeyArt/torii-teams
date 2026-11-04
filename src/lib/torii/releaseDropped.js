// Torii releases delete these paths from the build (torii-release.yml,
// scripts/torii-brand.mjs). The service worker must not precache them, or its
// install fails. Plain JS so the Node release script can import it too.
export const RELEASE_DROPPED_PREFIXES = [
	'/.well-known/',
	'/_headers',
	'/_redirects',
	'/cordn-logo',
	'/get-it-on-'
];
