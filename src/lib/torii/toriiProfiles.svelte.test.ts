import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	_resetToriiProfiles,
	profileLoader,
	requestProfile,
	setProfileSource,
	toriiAvatarSrc
} from './toriiProfiles.svelte';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ev = (pubkey: string) => ({
	kind: 0,
	pubkey,
	content: '{}',
	tags: [],
	created_at: 1,
	id: pubkey,
	sig: 's'
});

afterEach(() => _resetToriiProfiles());

describe('toriiProfiles (ADR 0006)', () => {
	it('waits for a Continuum session, then batches requests and adds events to the store', async () => {
		const done = requestProfile(A);
		const done2 = requestProfile(B);
		const profiles = vi.fn(async (pks: string[]) => Object.fromEntries(pks.map((p) => [p, ev(p)])));
		const added: string[] = [];
		setProfileSource({ profiles, avatar: async () => null }, (e) => added.push(e.pubkey));
		await Promise.all([done, done2]);
		expect(profiles).toHaveBeenCalledTimes(1);
		expect(profiles.mock.calls[0][0]).toEqual([A, B]);
		expect(added).toEqual([A, B]);
		// Asked recently: no second request.
		await requestProfile(A);
		expect(profiles).toHaveBeenCalledTimes(1);
		await requestProfile('junk');
		expect(profiles).toHaveBeenCalledTimes(1);
	});

	it('the loader stand-in completes and can be unsubscribed', async () => {
		setProfileSource({ profiles: async () => ({}), avatar: async () => null });
		const complete = vi.fn();
		profileLoader(A).subscribe({ complete });
		const sub = profileLoader(B).subscribe({ complete });
		sub.unsubscribe();
		await new Promise((r) => setTimeout(r, 80));
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it('a failed batch is retried on the next request', async () => {
		let fail = true;
		const profiles = vi.fn(async () => {
			if (fail) throw new Error('offline');
			return {};
		});
		setProfileSource({ profiles, avatar: async () => null });
		await requestProfile(A);
		fail = false;
		await requestProfile(A);
		expect(profiles).toHaveBeenCalledTimes(2);
	});

	it('avatars: nothing without a picture or source; blob URL once served', async () => {
		vi.stubGlobal(
			'URL',
			Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
		);
		expect(toriiAvatarSrc(A, 'https://img.example/a.png')).toBeUndefined(); // no source yet
		const avatar = vi.fn(async () => new Blob([new Uint8Array(4)], { type: 'image/png' }));
		setProfileSource({ profiles: async () => ({}), avatar });
		expect(toriiAvatarSrc(A, '')).toBeUndefined();
		expect(toriiAvatarSrc(A, 'https://img.example/a.png')).toBeUndefined();
		await new Promise((r) => setTimeout(r, 5));
		expect(toriiAvatarSrc(A, 'https://img.example/a.png')).toBe('blob:x');
		expect(avatar).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});
});
