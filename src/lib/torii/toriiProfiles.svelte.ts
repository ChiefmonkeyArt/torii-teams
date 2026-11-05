/**
 * Profiles and avatars through Continuum (ADR 0006).
 *
 * In Torii builds the browser never asks public relays for profiles and never
 * loads avatar URLs from arbitrary hosts. Kind-0 requests are batched to the
 * node agent (`GET /api/team/profiles`), which returns the signed events
 * unmodified; they go into the EventStore, which verifies the signatures as
 * usual. Avatars come from `GET /api/team/avatar/:hex` as blobs and are shown
 * through `blob:` URLs. Until a Continuum session exists, requests wait.
 */
import type { NostrEvent } from 'nostr-tools';
import { SvelteMap } from 'svelte/reactivity';

export interface ProfileSource {
	/** hex → signed kind-0 event, or null when none is known. */
	profiles(pubkeys: string[]): Promise<Record<string, NostrEvent | null>>;
	avatar(pubkey: string): Promise<Blob | null>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const BATCH_MS = 50;
const BATCH_MAX = 50;
const RETRY_MS = 10 * 60 * 1000;
const MAX_AVATARS = 300;

let source: ProfileSource | null = null;
let addEvent: (event: NostrEvent) => unknown = () => undefined;
const asked = new Map<string, number>(); // hex → ms of last successful ask
const pending = new Map<string, Array<() => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** hex → blob URL (reactive), or null when known-missing. */
const avatarUrls = new SvelteMap<string, string | null>();
const avatarInflight = new Set<string>();

/** Wire the Continuum client in (or out, with null) and flush waiting requests. */
export function setProfileSource(next: ProfileSource | null, add?: (event: NostrEvent) => unknown) {
	source = next;
	if (add) addEvent = add;
	if (!next) return;
	// A new session may see profiles a previous one could not; retry misses.
	for (const [k, url] of avatarUrls) if (url === null) avatarUrls.delete(k);
	schedule();
}

function schedule() {
	if (timer || !source || pending.size === 0) return;
	timer = setTimeout(flush, BATCH_MS);
}

async function flush() {
	timer = null;
	const src = source;
	if (!src) return;
	const batch = [...pending.keys()].slice(0, BATCH_MAX);
	const waiters = batch.flatMap((k) => pending.get(k) ?? []);
	for (const k of batch) pending.delete(k);
	try {
		const got = await src.profiles(batch);
		const t = Date.now();
		for (const k of batch) asked.set(k, t);
		for (const ev of Object.values(got)) if (ev) addEvent(ev);
	} catch {
		// Offline or session lost: forget the asks so a later request retries.
	} finally {
		for (const w of waiters) w();
		schedule();
	}
}

/** Request one profile; resolves when the batch it joined has settled. */
export function requestProfile(pubkey: string): Promise<void> {
	if (!HEX64.test(pubkey)) return Promise.resolve();
	const last = asked.get(pubkey);
	if (last !== undefined && Date.now() - last < RETRY_MS) return Promise.resolve();
	return new Promise((resolve) => {
		const list = pending.get(pubkey) ?? [];
		list.push(resolve);
		pending.set(pubkey, list);
		schedule();
	});
}

interface MiniObserver {
	next?: (value: NostrEvent) => void;
	error?: (err: unknown) => void;
	complete?: () => void;
}

/**
 * Observable-shaped stand-in for applesauce's address loader for kind 0:
 * events arrive through the EventStore, so it only signals completion.
 */
export function profileLoader(pubkey: string) {
	return {
		subscribe(observer?: MiniObserver | ((v: NostrEvent) => void)) {
			let closed = false;
			const complete = typeof observer === 'object' ? observer?.complete : undefined;
			requestProfile(pubkey).then(() => {
				if (!closed) complete?.();
			});
			return {
				unsubscribe() {
					closed = true;
				},
				get closed() {
					return closed;
				}
			};
		},
		pipe() {
			return this;
		}
	};
}

/**
 * Avatar `src` for a pubkey in Torii builds: a blob URL once Continuum has
 * served it, otherwise undefined (callers show their fallback). Reactive.
 */
export function toriiAvatarSrc(
	pubkey: string | undefined | null,
	picture: string | undefined | null
) {
	if (!pubkey || !picture || !HEX64.test(pubkey)) return undefined;
	const have = avatarUrls.get(pubkey);
	if (have !== undefined) return have ?? undefined;
	if (source && !avatarInflight.has(pubkey)) {
		avatarInflight.add(pubkey);
		const src = source;
		queueMicrotask(() => {
			src
				.avatar(pubkey)
				.then((blob) => {
					const url =
						blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
					avatarUrls.set(pubkey, url);
					while (avatarUrls.size > MAX_AVATARS) {
						const [k, v] = avatarUrls.entries().next().value as [string, string | null];
						if (v) URL.revokeObjectURL(v);
						avatarUrls.delete(k);
					}
				})
				.catch(() => avatarUrls.set(pubkey, null))
				.finally(() => avatarInflight.delete(pubkey));
		});
	}
	return undefined;
}

/** Test hook. */
export function _resetToriiProfiles() {
	source = null;
	addEvent = () => undefined;
	asked.clear();
	pending.clear();
	avatarUrls.clear();
	avatarInflight.clear();
	if (timer) clearTimeout(timer);
	timer = null;
}
