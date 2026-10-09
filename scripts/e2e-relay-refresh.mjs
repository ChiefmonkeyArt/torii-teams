/**
 * E2E smoke: coordinator relay auto-refresh (kind:10002 staleness sweep).
 *
 * The real case, no harness: a user's coordinator entry points at relay1; the
 * coordinator goes down and moves to relay2, republishing its NIP-65 relay
 * list. Without any manual action the page must fetch the new list, adopt the
 * verified set, and show the new relays — while a healthy setup whose
 * announcement is unchanged must be left completely alone.
 *
 * Runs the REAL coordinator (../../cordn, default in-memory storage) against the
 * real ContextVM public relays, so this is a network-dependent smoke test.
 * The coordinator announces nothing itself (no SDK announcements, no
 * third-party relay noise): the kind:10002 events are signed with its key and
 * published to its relays exactly as a real operator's move would leave them.
 *
 * Phase 1 (non-intrusive): stale entry + unchanged announcement → relays
 *   untouched, staleness stamp bumped ("checked, kept").
 * Phase 2 (the move): coordinator down → relay list swapped to relay2 →
 *   entry ages past the TTL (reload stands for time passing) → the page
 *   adopts relay2 on its own via the heartbeat sweep.
 *
 * Run: node scripts/e2e-relay-refresh.mjs   (exit 0 = pass)
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { PrivateKeySigner } from '@contextvm/sdk';
import { connectServer } from '../../cordn/packages/server/src/coordinatorServer.ts';

const RELAY1 = 'wss://relay.contextvm.org';
const RELAY2 = 'wss://relay2.contextvm.org';
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
/** Heartbeat sweep runs at most 60s after the tick warms; give it headroom. */
const SWEEP_WAIT_MS = 120_000;
/** The move gets extra headroom: reload + re-warm + sweep. */
const HEAL_WAIT_MS = 150_000;

const log = (...a) => console.log('[e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Coordinator identity: the server signs its traffic with this key, and its
// relay-list (kind:10002) events must carry the same pubkey.
const SERVER_SECRET = generateSecretKey();
const SERVER_KEY_HEX = bytesToHex(SERVER_SECRET);
const SERVER_PUB = getPublicKey(SERVER_SECRET);

// App account (same shape as e2e-wedged-send).
const ACCOUNT_PRIV = schnorr.utils.randomSecretKey();
const ACCOUNT = {
	type: 'nsec',
	id: 'relay-refresh-account',
	pubkey: bytesToHex(schnorr.getPublicKey(ACCOUNT_PRIV)),
	signer: { key: bytesToHex(ACCOUNT_PRIV) }
};

// The stored coordinator entry as a real user would have it, stale on purpose
// (relaysResolvedAt: 0 → "checked long ago").
const COORDINATOR_ENTRY = {
	id: 'e2e-coordinator',
	pubkey: SERVER_PUB,
	label: 'E2E coordinator',
	relays: [RELAY1],
	isDefault: false,
	createdAt: Date.now(),
	relaysResolvedAt: 0
};

/** Replaceable events tie on second granularity — keep created_at strictly increasing. */
let lastCreatedAt = 0;
function relayListEvent(announcedRelays) {
	const createdAt = Math.max(Math.floor(Date.now() / 1000), lastCreatedAt + 1);
	lastCreatedAt = createdAt;
	return finalizeEvent(
		{
			kind: 10002,
			created_at: createdAt,
			tags: announcedRelays.map((url) => ['r', url]),
			content: ''
		},
		SERVER_SECRET
	);
}

/** Publish one signed event to a relay and wait for its OK (real Nostr, over WS). */
function publishEvent(relayUrl, event) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(relayUrl);
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error(`publish to ${relayUrl} timed out`));
		}, 15_000);
		ws.addEventListener('message', (msg) => {
			let data;
			try {
				data = JSON.parse(msg.data);
			} catch {
				return;
			}
			if (data[0] !== 'OK' || data[1] !== event.id) return;
			clearTimeout(timer);
			ws.close();
			if (data[2]) resolve();
			else reject(new Error(`relay ${relayUrl} rejected event: ${data[3] ?? ''}`));
		});
		ws.addEventListener('error', () => {
			clearTimeout(timer);
			reject(new Error(`websocket error on ${relayUrl}`));
		});
		ws.addEventListener('open', () => ws.send(JSON.stringify(['EVENT', event])));
	});
}

async function publishRelayList(announcedRelays) {
	const event = relayListEvent(announcedRelays);
	// Publish to both of the coordinator's relays: the list travels with the
	// server's presence, so either relay can answer a discovery query.
	await Promise.all([publishEvent(RELAY1, event), publishEvent(RELAY2, event)]);
	log(`kind:10002 published announcing ${announcedRelays.join(', ')}`);
}

async function closeCoordinator(instance) {
	try {
		instance.close();
	} catch {}
	try {
		await instance.transport.close();
	} catch {}
}

async function startCoordinator(relayUrl) {
	const instance = await connectServer({
		signer: new PrivateKeySigner(SERVER_KEY_HEX),
		relayHandler: [relayUrl],
		serverInfo: { name: 'e2e coordinator' }
	});
	log(`coordinator (in-memory storage) listening on ${relayUrl}`);
	return instance;
}

async function waitFor(readState, predicate, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		last = await readState();
		if (predicate(last)) return last;
		await sleep(5_000);
	}
	throw new Error(`${label}: timed out after ${timeoutMs}ms (last state: ${JSON.stringify(last)})`);
}

async function main() {
	// Preflight: this smoke test is network-dependent — fail fast and clearly.
	for (const relayUrl of [RELAY1, RELAY2]) {
		const ok = await fetch(relayUrl.replace('wss://', 'https://'))
			.then((r) => r.ok)
			.catch(() => false);
		if (!ok) throw new Error(`relay not reachable: ${relayUrl} — this smoke test needs network access`);
	}
	log('relays reachable');

	let coordinator = await startCoordinator(RELAY1);
	await publishRelayList([RELAY1]);

	log('starting dev server…');
	const vite = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], {
		stdio: 'ignore',
		detached: true
	});
	let browser = null;
	let page = null;
	const cleanup = async () => {
		try {
			process.kill(-vite.pid, 'SIGTERM');
		} catch {}
		await closeCoordinator(coordinator);
		await browser?.close().catch(() => undefined);
	};

	let failed = null;
	try {
		let up = false;
		for (let i = 0; i < 60 && !up; i++) {
			await sleep(500);
			up = await fetch(BASE)
				.then((r) => r.ok)
				.catch(() => false);
		}
		if (!up) throw new Error('dev server did not come up');
		log('dev server up');

		browser = await chromium.launch();
		const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		// Real user state: an active account and one saved coordinator whose
		// relay set is stale (checked "long ago").
		await context.addInitScript(
			({ account, entry }) => {
				localStorage.setItem('accounts', JSON.stringify([account]));
				localStorage.setItem('active', account.id);
				localStorage.setItem('cordn-chat-coordinators', JSON.stringify({ coordinators: [entry] }));
			},
			{ account: ACCOUNT, entry: COORDINATOR_ENTRY }
		);
		page = await context.newPage();
		page.on('pageerror', (e) => log('pageerror:', String(e).slice(0, 600)));

		await page.goto(`${BASE}/chat/coordinators/${SERVER_PUB}`);
		log('coordinator page open, waiting for the staleness sweep');

		const readEntry = () =>
			page.evaluate(() => {
				try {
					return JSON.parse(localStorage.getItem('cordn-chat-coordinators') ?? '{}')
						.coordinators?.[0];
				} catch {
					return null;
				}
			});

		// Phase 1 — non-intrusive: the announcement matches the stored set, so
		// the sweep must only bump the staleness stamp and leave relays alone.
		const checked = await waitFor(
			readEntry,
			(e) => Boolean(e && e.relaysResolvedAt > 0),
			SWEEP_WAIT_MS,
			'phase 1: staleness sweep'
		);
		log(`phase 1: sweep ran (relaysResolvedAt=${checked.relaysResolvedAt})`);
		if (JSON.stringify(checked.relays) !== JSON.stringify([RELAY1])) {
			throw new Error(
				`phase 1: relays changed without a relay-list change: ${JSON.stringify(checked.relays)}`
			);
		}
		log('phase 1 PASS: unchanged announcement — relays untouched');

		// Phase 2 — the move: coordinator down, relay list swapped to relay2,
		// coordinator back up there. The entry was checked in phase 1, so age
		// its marker past the TTL and reload (stands for time passing); the
		// gate logic itself is unit-tested.
		log('switching the coordinator down and over to', RELAY2);
		await closeCoordinator(coordinator);
		await publishRelayList([RELAY2]);
		coordinator = await startCoordinator(RELAY2);
		await page.evaluate(() => {
			const raw = localStorage.getItem('cordn-chat-coordinators');
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (parsed.coordinators?.[0]) parsed.coordinators[0].relaysResolvedAt = 0;
			localStorage.setItem('cordn-chat-coordinators', JSON.stringify(parsed));
		});
		await page.reload();
		log('waiting for the page to adopt the new relays');

		const healed = await waitFor(
			readEntry,
			(e) => Boolean(e?.relays?.includes(RELAY2)),
			HEAL_WAIT_MS,
			'phase 2: relay adoption'
		);
		log(`phase 2: stored relays now ${JSON.stringify(healed.relays)}`);

		const text = await page.locator('body').innerText();
		if (!text.includes(RELAY2)) {
			throw new Error('phase 2: adopted relays not visible on the coordinator page');
		}
		log('phase 2 PASS: moved coordinator healed — relay list followed automatically');
		log('PASS: coordinator relay auto-refresh behaves as specified');
	} catch (e) {
		failed = e;
	} finally {
		await cleanup();
	}
	if (failed) {
		console.error('[e2e] FAIL:', failed.message);
		process.exit(1);
	}
	process.exit(0);
}

main().catch((e) => {
	console.error('[e2e] FAIL:', e);
	process.exit(1);
});
