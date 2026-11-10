import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools';
import { ContinuumClient, ContinuumError } from './continuumApi';
import {
	DEVICE_KIND,
	DEVICE_TAG,
	checkNewDevice,
	deviceNoteTemplate,
	hostsLine,
	parseMyDevices,
	saveError
} from './devices';

const npub = (c: string) => nip19.npubEncode(c.repeat(64));
const D1 = npub('1');
const NODE = npub('e');

describe('devices helpers', () => {
	it('checks a new computer: FIPS name, duplicate, cap, name', () => {
		expect(checkNewDevice([], D1, 'Laptop')).toBe('');
		expect(checkNewDevice([], 'npub1abc', '')).toMatch(/not a FIPS name/);
		expect(checkNewDevice([], D1.slice(0, -1) + (D1.endsWith('q') ? 'p' : 'q'), '')).toMatch(
			/not a FIPS name/
		);
		expect(checkNewDevice([{ npub: D1, label: '' }], D1, '')).toMatch(/already/);
		const three = ['1', '2', '3'].map((c) => ({ npub: npub(c), label: '' }));
		expect(checkNewDevice(three, npub('4'), '')).toMatch(/Up to 3/);
		expect(checkNewDevice([], D1, 'x'.repeat(33))).toMatch(/32 plain/);
		expect(checkNewDevice([], D1, 'a\u0007b')).toMatch(/32 plain/);
	});

	it('builds the note Continuum and root expect', () => {
		const t = deviceNoteTemplate([{ npub: D1, label: 'Laptop' }], 1_700_000_000);
		expect(t.kind).toBe(DEVICE_KIND);
		expect(t.tags).toEqual([['t', DEVICE_TAG]]);
		expect(JSON.parse(t.content)).toEqual({ v: 1, devices: [{ npub: D1, label: 'Laptop' }] });
		expect(verifyEvent(finalizeEvent(t, generateSecretKey()))).toBe(true);
	});

	it('parses the reply, failing closed on bad entries', () => {
		const ok = parseMyDevices({
			devices: [{ npub: D1, label: 'L' }],
			listed: true,
			max: 3,
			node: { npub: NODE, git: 'torii-teams.fips:7334' }
		});
		expect(ok).toEqual({
			devices: [{ npub: D1, label: 'L' }],
			listed: true,
			max: 3,
			nodeNpub: NODE,
			git: 'torii-teams.fips:7334'
		});
		expect(parseMyDevices({ devices: [{ npub: 'x' }], listed: true })).toBeNull();
		expect(
			parseMyDevices({ devices: [], listed: true, node: { npub: 'fd00::1', git: 'evil host' } })
		).toMatchObject({ nodeNpub: null, git: 'torii-teams.fips:7334' });
		expect(parseMyDevices(null)).toBeNull();
	});

	it('hosts line and error text', () => {
		expect(hostsLine('torii-teams.fips:7334', NODE)).toBe(`torii-teams ${NODE}`);
		expect(saveError('stale', 409)).toMatch(/newer list/);
		expect(saveError(null, 403)).toMatch(/not on a project/);
		expect(saveError(null, 0)).toMatch(/reach your node/);
	});
});

describe('ContinuumClient devices', () => {
	const ORIGIN = 'https://continuum.example.com';
	const sk = generateSecretKey();
	const ME = getPublicKey(sk);
	const json = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	function rig(putStatus = 200) {
		const store = new Map<string, string>();
		const storage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		};
		const seen: { method: string; body: unknown }[] = [];
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url).pathname;
			if (path === '/api/auth/challenge') return json(200, { challenge: 'f'.repeat(32) });
			if (path === '/api/team/auth/verify')
				return json(200, { token: 'm2.abcdefghijklmnop.sig', expires_at: 2_000_000_000 });
			if (path === '/api/team/devices') {
				seen.push({
					method: init?.method ?? 'GET',
					body: init?.body ? JSON.parse(String(init.body)) : null
				});
				if (init?.method === 'PUT')
					return putStatus === 200 ? json(200, { ok: true }) : json(putStatus, { code: 'stale' });
				return json(200, {
					devices: [],
					listed: true,
					max: 3,
					node: { npub: NODE, git: 'torii-teams.fips:7334' }
				});
			}
			return json(404, {});
		});
		const c = new ContinuumClient(ORIGIN, {
			fetch: fetch as unknown as typeof globalThis.fetch,
			storage,
			now: () => 1_700_000_000
		});
		const signer = {
			signEvent: vi.fn(async (t: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(t, sk))
		};
		return { c, signer, seen };
	}

	it('reads, then signs and sends the full list', async () => {
		const { c, signer, seen } = rig();
		await c.signIn(signer, ME);
		expect((await c.devices()).nodeNpub).toBe(NODE);
		await c.putDevices(signer, ME, [{ npub: D1, label: 'Laptop' }]);
		const put = seen.find((s) => s.method === 'PUT')!.body as {
			event: { kind: number; pubkey: string; content: string };
		};
		expect(put.event.kind).toBe(DEVICE_KIND);
		expect(put.event.pubkey).toBe(ME);
		expect(JSON.parse(put.event.content).devices).toEqual([{ npub: D1, label: 'Laptop' }]);
	});

	it('refuses without a session or with a signer for another key; passes 409 through', async () => {
		const { c, signer } = rig(409);
		await expect(c.putDevices(signer, ME, [])).rejects.toMatchObject({ status: 401 });
		await c.signIn(signer, ME);
		const other = {
			signEvent: vi.fn(async (t: Parameters<typeof finalizeEvent>[0]) =>
				finalizeEvent(t, generateSecretKey())
			)
		};
		await expect(c.putDevices(other, ME, [])).rejects.toThrow(/another key/);
		const e = await c.putDevices(signer, ME, []).catch((x) => x);
		expect(e).toBeInstanceOf(ContinuumError);
		expect(e.code).toBe('stale');
	});
});
