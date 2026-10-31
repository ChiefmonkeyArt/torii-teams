import { describe, expect, it } from 'vitest';

import {
	NODE_CONFIG_MAX_BYTES,
	applyNodeConfig,
	fetchNodeConfig,
	parseNodeConfig,
	type CoordinatorStoreLike
} from './nodeConfig';

const KEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const good = { version: 1, coordinator: KEY, relays: ['wss://relay.example.com'] };

describe('parseNodeConfig', () => {
	it('accepts the file the Suite writes', () => {
		expect(
			parseNodeConfig({
				...good,
				coordinator: KEY.toUpperCase(),
				name: 'example.com team',
				git: 'http://torii-teams.fips:7334'
			})
		).toEqual({
			version: 1,
			coordinator: KEY,
			relays: ['wss://relay.example.com'],
			name: 'example.com team',
			git: 'http://torii-teams.fips:7334/'
		});
	});
	it('allows plain ws:// only on loopback and the FIPS mesh', () => {
		expect(parseNodeConfig({ ...good, relays: ['ws://torii-teams.fips:10547'] })).not.toBeNull();
		expect(parseNodeConfig({ ...good, relays: ['ws://127.0.0.1:7777'] })).not.toBeNull();
		expect(parseNodeConfig({ ...good, relays: ['ws://relay.example.com'] })).toBeNull();
		expect(parseNodeConfig({ ...good, relays: ['https://relay.example.com'] })).toBeNull();
		expect(parseNodeConfig({ ...good, relays: ['wss://user:pw@relay.example.com'] })).toBeNull();
	});
	it('rejects anything malformed', () => {
		expect(parseNodeConfig(null)).toBeNull();
		expect(parseNodeConfig([good])).toBeNull();
		expect(parseNodeConfig({ ...good, version: 2 })).toBeNull();
		expect(parseNodeConfig({ ...good, coordinator: 'npub1xyz' })).toBeNull();
		expect(parseNodeConfig({ ...good, relays: [] })).toBeNull();
		expect(parseNodeConfig({ ...good, relays: Array(9).fill('wss://r.example') })).toBeNull();
		expect(parseNodeConfig({ ...good, name: 5 })).toBeNull();
	});
	it('cleans names and ignores a bad git URL', () => {
		const parsed = parseNodeConfig({ ...good, name: ' a\u0007b '.padEnd(200, 'x'), git: 'nope' })!;
		expect(parsed.name!.startsWith('ab')).toBe(true);
		expect(parsed.name!.length).toBe(64);
		expect(parsed.git).toBeUndefined();
	});
});

function response(body: string, headers: Record<string, string> = {}, status = 200) {
	return new Response(body, {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});
}

describe('fetchNodeConfig', () => {
	it('reads same-origin with no cookies and no redirects', async () => {
		let seen: [RequestInfo | URL, RequestInit | undefined] | null = null;
		const config = await fetchNodeConfig((async (input: RequestInfo | URL, init?: RequestInit) => {
			seen = [input, init];
			return response(JSON.stringify(good));
		}) as typeof fetch);
		expect(config?.coordinator).toBe(KEY);
		expect(seen![0]).toBe('/torii-node.json');
		expect(seen![1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
	});
	it('is null off a node, on HTML fallbacks, oversize files and network errors', async () => {
		const f = (r: Response | Error) =>
			(async () => {
				if (r instanceof Error) throw r;
				return r;
			}) as unknown as typeof fetch;
		expect(await fetchNodeConfig(f(response('', {}, 404)))).toBeNull();
		expect(
			await fetchNodeConfig(f(response('<html>', { 'content-type': 'text/html' })))
		).toBeNull();
		expect(
			await fetchNodeConfig(f(response(' '.repeat(NODE_CONFIG_MAX_BYTES + 1) + '{}')))
		).toBeNull();
		expect(await fetchNodeConfig(f(response('{bad json')))).toBeNull();
		expect(await fetchNodeConfig(f(new Error('offline')))).toBeNull();
	});
});

function memoryStore(
	initial: { pubkey: string; label: string; relays: string[]; isDefault: boolean }[]
) {
	const list = initial.map((c) => ({ ...c }));
	const calls: unknown[] = [];
	const store: CoordinatorStoreLike = {
		get: (pubkey) => list.find((c) => c.pubkey === pubkey),
		getDefault: () => list.find((c) => c.isDefault),
		upsert: (input) => {
			calls.push(input);
			let entry = list.find((c) => c.pubkey === input.pubkey);
			if (!entry) {
				entry = { pubkey: input.pubkey, label: input.label ?? '', relays: [], isDefault: false };
				list.push(entry);
			}
			if (input.label !== undefined) entry.label = input.label;
			if (input.relays) entry.relays = input.relays;
			if (input.isDefault) for (const c of list) c.isDefault = c.pubkey === input.pubkey;
		}
	};
	return { store, list, calls };
}

function memoryKv() {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v)
	};
}

describe('applyNodeConfig', () => {
	const config = parseNodeConfig({ ...good, name: 'example.com team' })!;

	it('adds the node coordinator as default on a fresh device', () => {
		const { store, list } = memoryStore([]);
		expect(applyNodeConfig(config, store, memoryKv(), 'fallback')).toBe('added');
		expect(list).toEqual([
			{
				pubkey: KEY,
				label: 'example.com team',
				relays: ['wss://relay.example.com'],
				isDefault: true
			}
		]);
	});

	it('never takes over a default the member chose', () => {
		const { store, list } = memoryStore([
			{ pubkey: OTHER, label: 'mine', relays: ['wss://r.example'], isDefault: true }
		]);
		expect(applyNodeConfig(config, store, memoryKv(), 'fallback')).toBe('added');
		expect(list.find((c) => c.isDefault)?.pubkey).toBe(OTHER);
	});

	it('is quiet on reload and keeps a label the member set', () => {
		const { store, list, calls } = memoryStore([]);
		const kv = memoryKv();
		applyNodeConfig(config, store, kv, 'fallback');
		list[0].label = 'Our team';
		expect(applyNodeConfig(config, store, kv, 'fallback')).toBe('unchanged');
		expect(calls).toHaveLength(1);
		expect(list[0].label).toBe('Our team');
	});

	it('merges new node relays into existing ones', () => {
		const { store, list } = memoryStore([
			{ pubkey: KEY, label: 'x', relays: ['wss://old.example'], isDefault: true }
		]);
		expect(applyNodeConfig(config, store, memoryKv(), 'fallback')).toBe('updated');
		expect(list[0].relays).toEqual(['wss://relay.example.com', 'wss://old.example']);
	});

	it('follows a coordinator key rotation when the old default came from the node', () => {
		const { store, list } = memoryStore([]);
		const kv = memoryKv();
		applyNodeConfig(config, store, kv, 'fallback');
		const rotated = { ...config, coordinator: OTHER };
		expect(applyNodeConfig(rotated, store, kv, 'fallback')).toBe('added');
		expect(list.find((c) => c.isDefault)?.pubkey).toBe(OTHER);
	});

	it('uses the fallback name when the node gives none', () => {
		const { store, list } = memoryStore([]);
		applyNodeConfig({ ...config, name: undefined }, store, memoryKv(), 'example.com team');
		expect(list[0].label).toBe('example.com team');
	});
});
