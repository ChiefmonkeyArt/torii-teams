/**
 * E2E: message editing stays honest across every send state.
 *
 * The real case, no harness: a real in-memory coordinator (../../cordn) on the
 * real ContextVM relay, two real accounts, a group created through the real
 * "New conversation" flow (B publishes a key package, A starts the chat), and
 * every scenario driven through the real composer and message-actions menu.
 *
 * History: this began as the behavior probe that pinned the "editing is acting
 * funny — a duplicate of the message I attempt to edit is made" report: the
 * Edit action was offered on queued/sending/failed bubbles where it silently
 * no-oped, so users retyped and sent the message twice. The probes are now
 * assertions over the fixed behavior:
 *   - Edit appears only once a message is actually sent (canEdit in
 *     ChatMessageItem) — never on queued/sending/failed bubbles.
 *   - Editing replaces the text in place (one row, "Edited" marker), and
 *     reply quotes follow the edit immediately (optimistic overlay).
 *
 * Run: node scripts/e2e-edit-flows.mjs   (exit 0 = pass)
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { PrivateKeySigner } from '@contextvm/sdk';
import { connectServer } from '../../cordn/packages/server/src/coordinatorServer.ts';

const RELAY = 'wss://relay.contextvm.org';
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;

const log = (...a) => console.log('[e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Coordinator identity.
const SERVER_SECRET = schnorr.utils.randomSecretKey();
const SERVER_KEY_HEX = bytesToHex(SERVER_SECRET);
const SERVER_PUB = bytesToHex(schnorr.getPublicKey(SERVER_SECRET));

// Two real accounts: B is the reachable peer whose key package A starts the
// chat from; A is the editing subject whose screen we assert on.
function makeAccount(id) {
	const priv = schnorr.utils.randomSecretKey();
	return {
		type: 'nsec',
		id,
		pubkey: bytesToHex(schnorr.getPublicKey(priv)),
		signer: { key: bytesToHex(priv) }
	};
}
const ACCOUNT_A = makeAccount('edit-flows-a');
const ACCOUNT_B = makeAccount('edit-flows-b');

// Stored coordinator entry as a real user would have it. relaysResolvedAt is
// fresh on purpose: the staleness sweep is relay-refresh's subject, not ours.
const COORDINATOR_ENTRY = {
	id: 'e2e-coordinator',
	pubkey: SERVER_PUB,
	label: 'E2E coordinator',
	relays: [RELAY],
	isDefault: true,
	createdAt: Date.now(),
	relaysResolvedAt: Date.now()
};

// ---------------------------------------------------------------------------
// Assertions + evidence log
// ---------------------------------------------------------------------------

const failures = [];
function assert(name, ok, detail) {
	if (!ok) failures.push({ name, detail });
	log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
}

function record(name, facts) {
	log(`[${name}]`, JSON.stringify(facts));
}

// ---------------------------------------------------------------------------
// Page helpers (real DOM only)
// ---------------------------------------------------------------------------

/** Rows whose BUBBLE BODY contains `text`. Reply-quote chips ("Replying to…")
 *  are stripped first so a quote of the text can't count as a second row. */
function readRows(page, text) {
	return page.evaluate((t) => {
		const byId = new Map();
		for (const el of document.querySelectorAll('[data-message-id]')) {
			const clone = el.cloneNode(true);
			for (const btn of clone.querySelectorAll('button')) {
				if (btn.textContent?.includes('Replying to')) btn.remove();
			}
			byId.set(el.getAttribute('data-message-id'), clone.textContent ?? '');
		}
		const rows = [...byId.entries()];
		const deliveryBadges = [];
		for (const label of ['Queued — will send when back online', 'Sending', 'Sent', 'Failed']) {
			if (document.querySelector(`[aria-label="${label}"]`)) deliveryBadges.push(label);
		}
		return {
			total: rows.length,
			matches: rows.filter(([, content]) => content.includes(t)).length,
			editedMarkers: document.querySelectorAll('[aria-label="Edited"]').length,
			deliveryBadges
		};
	}, text);
}

/** How many reply-quote chips show `text` (the quote body). */
function quoteShows(page, text) {
	return page.evaluate((t) => {
		let count = 0;
		for (const el of document.querySelectorAll('[data-message-id]')) {
			for (const btn of el.querySelectorAll('button')) {
				const content = btn.textContent ?? '';
				if (content.includes('Replying to') && content.includes(t)) count += 1;
			}
		}
		return count;
	}, text);
}

async function composer(page) {
	return page.locator('textarea[placeholder="Type a message…"]');
}

async function sendText(page, text) {
	const box = await composer(page);
	await box.click();
	await box.fill(text);
	await box.press('Enter');
	// enterSends is a setting: if Enter inserted a newline instead of sending,
	// fall back to the keyboard shortcut the composer documents.
	await sleep(300);
	if ((await box.inputValue()) !== '') {
		await box.press('Control+Enter');
	}
}

/** Open the row's message-actions menu, retrying through the outbox→confirmed
 *  row swap. Throws when the menu can't be opened at all — a guess here would
 *  silently pass "Edit not offered" assertions. Returns whether Edit is offered. */
async function openActionsMenu(page, text) {
	const row = page.locator('[data-message-id]', { hasText: text }).first();
	for (let attempt = 0; attempt < 4; attempt++) {
		await row.scrollIntoViewIfNeeded().catch(() => undefined);
		await row.hover().catch(() => undefined);
		await row
			.locator('[aria-label="Open message actions"]')
			.first()
			.click({ timeout: 2_000 })
			.catch(() => undefined);
		if ((await page.getByRole('menuitem').count()) > 0) {
			return (await page.getByRole('menuitem', { name: 'Edit' }).count()) > 0;
		}
		await sleep(500);
	}
	throw new Error(`message actions menu did not open for "${text}"`);
}

async function editOffered(page, text) {
	const offered = await openActionsMenu(page, text);
	await page.keyboard.press('Escape');
	await sleep(150);
	return offered;
}

/** Arm an edit on the first row containing `text`; returns whether the edit
 *  chip appeared (`aria-label="Cancel edit"`). */
async function tryEdit(page, text) {
	const offered = await openActionsMenu(page, text);
	if (!offered) return false;
	await page
		.getByRole('menuitem', { name: 'Edit' })
		.first()
		.click({ timeout: 3_000 })
		.catch(() => undefined);
	await sleep(250);
	return (await page.locator('[aria-label="Cancel edit"]').count()) > 0;
}

async function submitEdit(page, newText) {
	const box = await composer(page);
	await box.fill(newText);
	await box.press('Enter');
	await sleep(300);
	if ((await box.inputValue()) !== '') {
		await box.press('Control+Enter');
	}
}

/** Wait for delivery badges to clear (confirm landed) without throwing —
 *  offline scenarios legitimately keep a Queued badge. */
async function waitSettled(page, ms = 15_000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const { deliveryBadges } = await readRows(page, '');
		if (!deliveryBadges.some((b) => b === 'Sending' || b === 'Queued — will send when back online')) {
			return true;
		}
		await sleep(500);
	}
	return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	// Preflight: network-dependent test — fail fast and clearly.
	const ok = await fetch(RELAY.replace('wss://', 'https://'))
		.then((r) => r.ok)
		.catch(() => false);
	if (!ok) throw new Error(`relay not reachable: ${RELAY} — this test needs network access`);
	log('relay reachable');

	const coordinator = await connectServer({
		signer: new PrivateKeySigner(SERVER_KEY_HEX),
		relayHandler: [RELAY],
		serverInfo: { name: 'e2e edit flows' }
	});
	log('coordinator (in-memory storage) listening on', RELAY);

	const vite = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], {
		stdio: 'ignore',
		detached: true
	});
	let browser = null;
	const cleanup = async () => {
		try {
			process.kill(-vite.pid, 'SIGTERM');
		} catch {}
		try {
			await coordinator.close();
		} catch {}
		try {
			await coordinator.transport?.close?.();
		} catch {}
		await browser?.close().catch(() => undefined);
	};

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
		const initScript = ({ account, entry }) => {
			localStorage.setItem('accounts', JSON.stringify([account]));
			localStorage.setItem('active', account.id);
			localStorage.setItem('cordn-chat-coordinators', JSON.stringify({ coordinators: [entry] }));
		};
		const contextB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		await contextB.addInitScript(initScript, { account: ACCOUNT_B, entry: COORDINATOR_ENTRY });
		const contextA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		await contextA.addInitScript(initScript, { account: ACCOUNT_A, entry: COORDINATOR_ENTRY });
		const pageB = await contextB.newPage();
		const page = await contextA.newPage();
		page.on('pageerror', (e) => log('pageerror:', String(e).slice(0, 400)));

		// --- Setup: B creates + publishes a real key package (real page, real
		// button — the create form publishes to the given coordinator) ---
		await pageB.goto(`${BASE}/chat/config/key-packages`);
		await sleep(3_000);
		await pageB
			.locator('input[placeholder="Optional publish coordinator pubkey"]')
			.fill(SERVER_PUB);
		await pageB
			.getByRole('button', { name: 'Generate key package' })
			.first()
			.click({ timeout: 15_000 });
		let published = false;
		for (let i = 0; i < 30 && !published; i++) {
			published = (await pageB.getByText(/Published to/).count()) > 0;
			if (!published) await sleep(1_000);
		}
		if (!published) throw new Error('B never published a key package');
		log('B key package published');

		// --- Setup: A starts a chat with B through the real flow ---
		await page.goto(`${BASE}/chat`);
		await sleep(2_000);
		await page.locator('[aria-label="New conversation"]').first().click();
		let startBtn = null;
		for (let i = 0; i < 30 && !startBtn; i++) {
			startBtn = page.getByRole('button', { name: /^Start chat/ }).first();
			if ((await startBtn.count()) === 0) {
				startBtn = null;
				await sleep(1_000);
			}
		}
		if (!startBtn) throw new Error('no "Start chat" entry appeared in the directory');
		await startBtn.click();
		await page.waitForURL(/\/chat\/[^/]+/, { timeout: 60_000 });
		log('chat created:', page.url().split('/chat/')[1].split(/[?#]/)[0]);
		await sleep(3_000);

		// --- S1: editing a confirmed message replaces text in place ---
		await sendText(page, 'hello edit me');
		await waitSettled(page);
		assert('S1 Edit offered on a sent message', await editOffered(page, 'hello edit me'));
		const chip1 = await tryEdit(page, 'hello edit me');
		assert('S1 edit chip arms', chip1);
		if (chip1) await submitEdit(page, 'hello EDITED');
		await waitSettled(page);
		assert('S1 edited text is the only row', (await readRows(page, 'hello EDITED')).matches === 1, {
			detail: await readRows(page, 'hello EDITED')
		});
		assert('S1 old text gone', (await readRows(page, 'hello edit me')).matches === 0);
		assert('S1 "Edited" marker shows', (await readRows(page, 'hello EDITED')).editedMarkers >= 1);
		await page.reload();
		await sleep(2_500);
		assert('S1 survives reload', (await readRows(page, 'hello EDITED')).matches === 1);
		assert('S1 old text gone after reload', (await readRows(page, 'hello edit me')).matches === 0);

		// --- S2: no Edit on a QUEUED bubble (offline); Edit appears once sent ---
		await contextA.setOffline(true);
		await sendText(page, 'queued target');
		await sleep(2_000);
		assert('S2 queued bubble exists', (await readRows(page, 'queued target')).matches === 1);
		assert('S2 Edit NOT offered while queued', !(await editOffered(page, 'queued target')));
		await contextA.setOffline(false);
		await waitSettled(page);
		assert('S2 queued message sends as one row', (await readRows(page, 'queued target')).matches === 1);
		assert('S2 Edit offered once sent', await editOffered(page, 'queued target'));

		// --- S3: in-flight window (race — evidence only) ---
		await sendText(page, 'in flight target');
		record('S3 Edit offered in flight (race, evidence only)', {
			offered: await editOffered(page, 'in flight target')
		});
		await waitSettled(page);
		assert('S3 in-flight message is one row', (await readRows(page, 'in flight target')).matches === 1);

		// --- S4: no Edit on a FAILED bubble; retry keeps one row ---
		await contextA.setOffline(true);
		await sendText(page, 'failed target');
		await sleep(3_000);
		assert('S4 Edit NOT offered on failed bubble', !(await editOffered(page, 'failed target')));
		await contextA.setOffline(false);
		const retry = page.locator('[aria-label="Retry send"]').first();
		await retry.click({ timeout: 5_000 }).catch(() => log('no retry button on failed bubble'));
		await waitSettled(page);
		assert('S4 retry keeps one row', (await readRows(page, 'failed target')).matches === 1);
		assert('S4 Edit offered after retry lands', await editOffered(page, 'failed target'));

		// --- S5: editing twice leaves only the last text ---
		await sendText(page, 'double edit target');
		await waitSettled(page);
		assert('S5 first edit chip arms', await tryEdit(page, 'double edit target'));
		await submitEdit(page, 'double edit FIRST');
		await waitSettled(page);
		const chip5b = await tryEdit(page, 'double edit FIRST');
		assert('S5 second edit chip arms', chip5b);
		if (chip5b) await submitEdit(page, 'double edit SECOND');
		await waitSettled(page);
		assert('S5 final text is the only row', (await readRows(page, 'double edit SECOND')).matches === 1);
		assert('S5 intermediate text gone', (await readRows(page, 'double edit FIRST')).matches === 0);
		await page.reload();
		await sleep(2_500);
		assert('S5 survives reload', (await readRows(page, 'double edit SECOND')).matches === 1);

		// --- S6: editing a parent updates its reply quote immediately ---
		await sendText(page, 'parent message');
		await waitSettled(page);
		const row = page.locator('[data-message-id]', { hasText: 'parent message' }).first();
		await row.hover().catch(() => undefined);
		await row
			.locator('[aria-label="Reply to message"]')
			.first()
			.click({ timeout: 3_000 })
			.catch(() => log('reply button not found'));
		await sendText(page, 'child reply');
		await waitSettled(page);
		const chip6 = await tryEdit(page, 'parent message');
		assert('S6 parent edit chip arms', chip6);
		if (chip6) await submitEdit(page, 'parent EDITED');		await waitSettled(page);
		assert('S6 parent edited in place', (await readRows(page, 'parent EDITED')).matches === 1);
		assert('S6 parent old text gone', (await readRows(page, 'parent message')).matches === 0);
		assert('S6 quote follows the edit right away', (await quoteShows(page, 'parent EDITED')) >= 1, {
			quotes: await quoteShows(page, 'parent EDITED')
		});
		await page.reload();
		await sleep(2_500);
		assert('S6 parent survives reload', (await readRows(page, 'parent EDITED')).matches === 1);
		assert('S6 quote follows after reload', (await quoteShows(page, 'parent EDITED')) >= 1);

		// --- S7: offline enqueue → online drain → edit ---
		await contextA.setOffline(true);
		await sendText(page, 'stale hunt target');
		await sleep(2_000);
		await contextA.setOffline(false);
		await waitSettled(page);
		const chip7 = await tryEdit(page, 'stale hunt target');
		assert('S7 chip arms after drain', chip7);
		if (chip7) await submitEdit(page, 'stale hunt EDITED');
		await waitSettled(page);
		assert('S7 edited text is the only row', (await readRows(page, 'stale hunt EDITED')).matches === 1);
		assert('S7 old text gone', (await readRows(page, 'stale hunt target')).matches === 0);

		log('================ VERDICT ================');
		if (failures.length > 0) {
			log(`FAILED (${failures.length}):`, JSON.stringify(failures));
			throw new Error(`${failures.length} assertion(s) failed`);
		}
		log('all assertions passed');
	} finally {
		await cleanup();
	}
}

main().catch((error) => {
	console.error('[e2e] FAILED:', error);
	process.exit(1);
});
