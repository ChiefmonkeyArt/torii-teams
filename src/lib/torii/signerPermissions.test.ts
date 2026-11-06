import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CTXVM_MESSAGES_KIND } from '@contextvm/sdk';
import {
	TEAM_SIGNED_KINDS,
	TEAM_SIGNER_PERMISSIONS,
	detectSigner,
	signerHint
} from './signerPermissions';

// Every place the Torii build asks the user's signer to sign, and the kind it
// signs. A new call site fails this test until its kind is in the constant.
const SIGNING_SITES: Record<string, number> = {
	'src/lib/torii/continuumApi.ts': 22242,
	'src/lib/services/coordinatorClient.ts': CTXVM_MESSAGES_KIND,
	'src/lib/services/multiDevice.svelte.ts': 30078,
	// Upstream Cordn routes and helpers the Torii build never reaches or that
	// sign with a local key, not the user's signer.
	'src/routes/p/[identifier]/+page.svelte': -1,
	'src/lib/services/donations/donationFlow.svelte.ts': -1,
	'src/lib/services/chatBlossomClient.ts': -1,
	'src/lib/components/AccountLoginDialog.svelte': -1
};

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
	}
	return out;
}

describe('signer permissions (ADR 0008)', () => {
	it('asks for every kind the Torii build signs, plus key and NIP-44', () => {
		expect([...TEAM_SIGNED_KINDS].sort()).toEqual([22242, 25910, 30078]);
		expect(TEAM_SIGNED_KINDS).toContain(CTXVM_MESSAGES_KIND);
		for (const k of Object.values(SIGNING_SITES).filter((k) => k > 0)) {
			expect(TEAM_SIGNER_PERMISSIONS).toContain(`sign_event:${k}`);
		}
		for (const p of ['get_public_key', 'nip44_encrypt', 'nip44_decrypt']) {
			expect(TEAM_SIGNER_PERMISSIONS).toContain(p);
		}
	});

	it('knows every signing call site in the source', () => {
		const sites = walk('src')
			.filter((f) => /\bsignEvent\(/.test(readFileSync(f, 'utf8')))
			.map((f) => f.replaceAll('\\', '/'));
		for (const f of sites) expect(Object.keys(SIGNING_SITES), `${f} signs`).toContain(f);
	});

	it('matches the multi-device tip kind it claims', async () => {
		const md = readFileSync('src/lib/services/multiDevice.svelte.ts', 'utf8');
		expect(md).toMatch(/export const MULTI_DEVICE_TIP_KIND = 30078;/);
	});

	it('picks the hint for the signer in use', () => {
		expect(detectSigner({ nostr: {} })).toBe('extension');
		expect(detectSigner({})).toBe('remote');
		expect(detectSigner(undefined)).toBe('none');
		expect(signerHint('extension')).toMatch(/Always allow/);
		expect(signerHint('remote')).toMatch(/once/);
	});
});
