/**
 * Torii Teams — the node's own file server (ADR 0007).
 *
 * When `/torii-node.json` names `files` (https://<teams host>/files), a Torii
 * build stores and loads every encrypted blob there and nowhere else: chat
 * media, and multi-device documents. Uploads and deletes carry the member's
 * Continuum session as `Authorization: Bearer`, so no Nostr auth event is
 * signed (no signer prompt). Without a node file server nothing changes.
 */

let base: string | null = null;
let bearer: () => string | null = () => null;

/** Set (or clear, with null) the node file server and its session source. */
export function setNodeFiles(url: string | null, auth?: () => string | null): void {
	base = url ? url.replace(/\/+$/, '') : null;
	bearer = auth ?? (() => null);
}

/** The node file server base URL, or null when files use public Blossom servers. */
export function nodeFilesUrl(): string | null {
	return base;
}

const norm = (url: string) => url.replace(/\/+$/, '');

/** True when `url` is the node file server or a blob on it. */
export function isNodeFileUrl(url: string): boolean {
	if (!base) return false;
	const u = norm(url);
	return u === base || u.startsWith(`${base}/`);
}

/**
 * Auth for a Blossom request to `serverUrl`:
 * - `undefined`: not the node; the caller signs a Nostr auth event as usual.
 * - `string`: the Bearer token to send.
 * - `null`: the node, but no Continuum session (the caller must not fall back
 *   to a Nostr event, which the node would refuse anyway).
 */
export function nodeFilesAuth(serverUrl: string): string | null | undefined {
	if (!base || norm(serverUrl) !== base) return undefined;
	return bearer();
}

/** The hosts to use: only the node when it has a file server, else `servers`. */
export function nodeServers(servers: readonly string[]): string[] {
	return base ? [base] : [...servers];
}

/** Media whose blob lives off the node (sent before torii.7, or by another app). */
export class ForeignMediaError extends Error {
	constructor(readonly url: string) {
		super('Stored outside this node');
		this.name = 'ForeignMediaError';
	}
}

/** Throw before fetching a blob that is not on the node (when the node has files). */
export function assertNodeFetch(url: string): void {
	if (base && !isNodeFileUrl(url)) throw new ForeignMediaError(url);
}
