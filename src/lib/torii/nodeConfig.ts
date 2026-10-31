/**
 * Torii Teams — node settings (TEAMS-2c a).
 *
 * When the app is served by a Torii node, the Suite installer writes
 * `/torii-node.json` next to it: the node's Cordn coordinator pubkey (from
 * `/etc/torii/teams/coord.pub`) and the public relay (`wss://relay.<domain>`).
 * On start we read it once and add that coordinator, so members can create
 * and join team groups without typing keys. Standalone builds (cordn.net,
 * the APK) get a 404 and behave exactly like upstream.
 *
 * The file is untrusted input: strictly parsed, size-capped, same-origin only.
 */

export const NODE_CONFIG_PATH = '/torii-node.json';
export const NODE_CONFIG_MAX_BYTES = 4096;
const NODE_COORDINATOR_KEY = 'torii.nodeCoordinator';
const MAX_RELAYS = 8;
const MAX_NAME = 64;

export interface ToriiNodeConfig {
	version: 1;
	/** Display name for the coordinator, e.g. "example.com team". */
	name?: string;
	/** Coordinator pubkey, 64-char lowercase hex. */
	coordinator: string;
	/** Relays the coordinator listens on (wss://, or ws:// on a mesh/loopback host). */
	relays: string[];
	/** Private git base URL, mesh-only (shown to members, never fetched here). */
	git?: string;
	/** Continuum origin on this node, for member sign-in (absent if not installed). */
	continuum?: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** ws:// only where TLS isn't available but the path is private: loopback and FIPS mesh names. */
function isAllowedRelay(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	if (url.protocol === 'wss:') return true;
	if (url.protocol !== 'ws:') return false;
	const host = url.hostname;
	return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.fips');
}

/** Strict parse; null on anything unexpected. */
export function parseNodeConfig(raw: unknown): ToriiNodeConfig | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const input = raw as Record<string, unknown>;
	if (input.version !== 1) return null;
	const coordinator =
		typeof input.coordinator === 'string' ? input.coordinator.trim().toLowerCase() : '';
	if (!HEX64.test(coordinator)) return null;
	if (!Array.isArray(input.relays) || input.relays.length === 0) return null;
	if (input.relays.length > MAX_RELAYS) return null;
	const relays: string[] = [];
	for (const relay of input.relays) {
		if (typeof relay !== 'string' || !isAllowedRelay(relay.trim())) return null;
		if (!relays.includes(relay.trim())) relays.push(relay.trim());
	}
	const config: ToriiNodeConfig = { version: 1, coordinator, relays };
	if (input.name !== undefined) {
		if (typeof input.name !== 'string') return null;
		const name = input.name.replace(/\p{Cc}/gu, '').trim();
		if (name) config.name = name.slice(0, MAX_NAME);
	}
	if (input.git !== undefined) {
		if (typeof input.git !== 'string') return null;
		try {
			const git = new URL(input.git);
			if ((git.protocol === 'http:' || git.protocol === 'https:') && !git.username) {
				config.git = git.toString();
			}
		} catch {
			// Optional field: ignore a bad git URL rather than reject the coordinator.
		}
	}
	if (input.continuum !== undefined) {
		if (typeof input.continuum !== 'string') return null;
		const continuum = parseOrigin(input.continuum);
		if (continuum) config.continuum = continuum;
	}
	return config;
}

/** An https origin (http only for loopback); null otherwise. Paths are dropped. */
function parseOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.username || url.password) return null;
		if (url.protocol === 'https:') return url.origin;
		if (
			url.protocol === 'http:' &&
			(url.hostname === 'localhost' || url.hostname === '127.0.0.1')
		) {
			return url.origin;
		}
	} catch {
		// fall through
	}
	return null;
}

/**
 * Relays a browser page can actually open. An https page cannot open ws://
 * (mixed content), so mesh/loopback relays are for native clients and the CLI
 * there; wss:// relay.<domain> is the in-browser chat path.
 */
export function browserRelays(relays: string[], pageProtocol: string): string[] {
	return pageProtocol === 'https:' ? relays.filter((relay) => relay.startsWith('wss://')) : relays;
}

/** Fetch the node file from this origin; null when absent or invalid. */
export async function fetchNodeConfig(
	fetchFn: typeof fetch = fetch
): Promise<ToriiNodeConfig | null> {
	let response: Response;
	try {
		response = await fetchFn(NODE_CONFIG_PATH, {
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error'
		});
	} catch {
		return null;
	}
	if (!response.ok) return null;
	const type = response.headers.get('content-type') ?? '';
	if (!type.includes('application/json')) return null;
	const declared = Number(response.headers.get('content-length') ?? '0');
	if (declared > NODE_CONFIG_MAX_BYTES) return null;
	const text = await response.text();
	if (text.length > NODE_CONFIG_MAX_BYTES) return null;
	try {
		return parseNodeConfig(JSON.parse(text));
	} catch {
		return null;
	}
}

/** What the app's coordinator store must offer (keeps this module testable). */
export interface CoordinatorStoreLike {
	get(pubkey: string): { pubkey: string; label: string; relays: string[] } | undefined;
	getDefault(): { pubkey: string } | undefined;
	upsert(input: { pubkey: string; label?: string; relays?: string[]; isDefault?: boolean }): void;
}

export interface KeyValueLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export type NodeApplyResult = 'added' | 'updated' | 'unchanged';

/**
 * Add or refresh the node's coordinator.
 * - New: added with the node's name and relays.
 * - Existing: relays from the node are merged in; a label the member set is kept.
 * - Default: becomes the default when there is none, or when the current default
 *   is the node coordinator we seeded last time (so a key rotation follows the
 *   node). A coordinator the member picked themselves is never overridden.
 */
export function applyNodeConfig(
	config: ToriiNodeConfig,
	store: CoordinatorStoreLike,
	storage: KeyValueLike,
	fallbackName: string
): NodeApplyResult {
	const previousNode = storage.getItem(NODE_COORDINATOR_KEY);
	const currentDefault = store.getDefault()?.pubkey;
	const makeDefault = !currentDefault || currentDefault === previousNode;
	const existing = store.get(config.coordinator);
	storage.setItem(NODE_COORDINATOR_KEY, config.coordinator);

	if (!existing) {
		store.upsert({
			pubkey: config.coordinator,
			label: config.name ?? fallbackName,
			relays: config.relays,
			isDefault: makeDefault
		});
		return 'added';
	}
	const relays = [...new Set([...config.relays, ...existing.relays])];
	const relaysChanged = relays.length !== existing.relays.length;
	const defaultChanged = makeDefault && currentDefault !== config.coordinator;
	if (!relaysChanged && !defaultChanged) return 'unchanged';
	store.upsert({
		pubkey: config.coordinator,
		relays: relaysChanged ? relays : undefined,
		isDefault: makeDefault ? true : undefined
	});
	return 'updated';
}

let started = false;

/** Read the node file once per page load and seed the coordinator. */
export async function initToriiNode(): Promise<ToriiNodeConfig | null> {
	if (started || typeof window === 'undefined') return null;
	started = true;
	const config = await fetchNodeConfig();
	if (!config) return null;
	const relays = browserRelays(config.relays, location.protocol);
	if (relays.length === 0) return null;
	const coordinators = await import('$lib/services/chatCoordinators.svelte');
	applyNodeConfig(
		{ ...config, relays },
		{
			get: coordinators.getChatCoordinator,
			getDefault: coordinators.getDefaultChatCoordinator,
			upsert: (input) => {
				coordinators.upsertChatCoordinator(input);
			}
		},
		localStorage,
		`${location.hostname} team`
	);
	return config;
}
