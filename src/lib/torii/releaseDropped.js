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

// Kept in the release but not precached (ADR 0014): the browser fetches the
// install icons itself when someone adds Teams to a home screen, so a first
// visit need not download them.
export const RELEASE_NOT_PRECACHED = ['/pwa/'];
