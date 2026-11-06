// Torii Teams: the sidebar on a Torii node is one channel per Continuum
// project the member is on (owner decision 2026-11-04: the project is the only
// unit of access; no lobby, no team-wide group, no other groups shown).

import { TORII_NODE_BUILD } from './build';
import { setNodeFiles } from './nodeFiles';
import { listChatGroupMembers, listChatGroups } from '$lib/services/chatGroups.svelte';
import { manager } from '$lib/services/accountManager.svelte';
import { eventStore } from '$lib/services/eventStore';
import { setProfileSource } from './toriiProfiles.svelte';
import { safeNormalizePubKey as normalizePubKey } from '$lib/utils';
import type { ToriiNodeConfig } from './nodeConfig';
import {
	ContinuumClient,
	ContinuumError,
	INVITE_GONE,
	acceptsHandoff,
	matchProjectGroup,
	type GroupLike,
	type InviteLink,
	type RosterTeams,
	type TeamProject
} from './continuumApi';
import { dropInvite, heldInvite } from './inviteLink';

export type ChannelsStatus =
	| 'off'
	| 'signed-out'
	| 'signing-in'
	| 'loading'
	| 'ready'
	| 'error'
	/** Used an open invite; the owner has not let us in yet (ADR 0009). */
	| 'waiting';

/** The invite this tab carries, as the link describes itself (names only). */
export interface InviteView {
	projectName: string;
	ownerName: string;
}

export const projectChannels = $state<{
	status: ChannelsStatus;
	error: string;
	owner: boolean;
	projects: TeamProject[];
	owners: Record<string, string | null>;
	/** Roster pubkeys per project; absent when the roster was unreadable. */
	rosters: Record<string, string[]>;
	/** Membership signals per project (ADR 0006); absent on an older Continuum. */
	teams: Record<string, RosterTeams>;
	/** Continuum knows we opened Teams; null on an older Continuum. */
	ready: boolean | null;
	coordinator: string;
	relays: string[];
	/** An invite link opened in this tab, or the one we are waiting on. */
	invite: InviteView | null;
}>({
	status: 'off',
	error: '',
	owner: false,
	projects: [],
	owners: {},
	rosters: {},
	teams: {},
	ready: null,
	coordinator: '',
	relays: [],
	invite: null
});

let client: ContinuumClient | null = null;
// One load per account: every sidebar instance (desktop + phone sheet) asks,
// but only the first call for a pubkey reaches Continuum.
let inflight: Promise<void> | null = null;
let loadedFor = '';
let link: InviteLink | null = null;
/** The link in this tab no longer works: say so instead of a plain sign-in. */
let inviteGone = false;
const tabStorage = () => (typeof sessionStorage === 'undefined' ? null : sessionStorage);

/** Called once with the node file; turns project mode on only when Continuum is set. */
export function startProjectChannels(config: ToriiNodeConfig, relays: string[]): void {
	if (!config.continuum || typeof window === 'undefined') return;
	client = new ContinuumClient(config.continuum, {
		fetch: fetch.bind(window),
		// One sign-in (ADR 0008): survives reloads and new tabs. Cleared on
		// sign-out, a 401, a key change and expiry.
		storage: localStorage
	});
	const files = client;
	if (TORII_NODE_BUILD && config.files) setNodeFiles(config.files, () => files.bearer());
	projectChannels.coordinator = config.coordinator;
	projectChannels.relays = relays;
	// 'loading', not 'signed-out': the stored session is checked first, so a
	// reload or new tab never races into a fresh challenge (ADR 0008).
	projectChannels.status = 'loading';
	void readInvite().finally(() => void refreshProjectChannels());
}

/** Read the invite this tab carries (captured at startup) without signing in. */
async function readInvite(): Promise<void> {
	link = heldInvite(tabStorage());
	if (!client || !link) return;
	try {
		const peek = await client.peekInvite(link);
		if (peek) {
			projectChannels.invite = { projectName: peek.projectName, ownerName: peek.ownerName };
			return;
		}
	} catch {
		// Offline: keep the link; the claim answers for real.
		return;
	}
	forgetInvite();
	inviteGone = true;
}

function forgetInvite(): void {
	link = null;
	dropInvite(tabStorage());
}

export function projectModeOn(): boolean {
	return projectChannels.status !== 'off';
}

function explain(error: unknown): string {
	if (error instanceof ContinuumError) {
		if (error.code === 'not_member') return "You're not on any project on this node yet.";
		if (error.code === 'use_owner_login')
			return 'Owner sign-in to Teams arrives with Continuum v0.2.194-alpha.';
		if (error.status === 0 && /fetch|network/i.test(error.message)) return "Can't reach Continuum.";
		return error.message;
	}
	if (error instanceof TypeError) return "Can't reach Continuum on this node.";
	return error instanceof Error ? error.message : String(error);
}

/**
 * Load projects with a stored session; never prompts the signer. `quiet` is
 * the background refresh (60 s tick, Continuum's roster-changed message): it
 * keeps what is on screen and only replaces it with a good reply.
 */
export function refreshProjectChannels(
	options: { force?: boolean; quiet?: boolean } = {}
): Promise<void> {
	const pubkey = manager.getActive()?.pubkey ?? '';
	if (!options.force && pubkey && pubkey === loadedFor && projectChannels.status === 'ready') {
		return Promise.resolve();
	}
	if (options.quiet && (projectChannels.status !== 'ready' || pubkey !== loadedFor)) {
		return Promise.resolve();
	}
	if (inflight) return inflight;
	inflight = loadProjectChannels(Boolean(options.quiet)).finally(() => {
		inflight = null;
	});
	return inflight;
}

async function loadProjectChannels(quiet = false): Promise<void> {
	if (!quiet) loadedFor = '';
	const account = manager.getActive();
	if (!client || !account) {
		if (client) projectChannels.status = 'signed-out';
		return;
	}
	const pubkey = normalizePubKey(account.pubkey);
	client.keepOnlyFor(pubkey);
	// Renew quietly when under a quarter of the token's life is left: no signer.
	if (client.hasSession(pubkey)) await client.renew();
	if (!client.hasSession(pubkey)) {
		const waiting = client.pendingFor(pubkey);
		if (waiting) {
			projectChannels.invite = { projectName: waiting.projectName, ownerName: waiting.ownerName };
			projectChannels.status = 'waiting';
			void checkInvite();
			return;
		}
		if (inviteGone) {
			projectChannels.status = 'error';
			projectChannels.error = INVITE_GONE;
			return;
		}
		projectChannels.status = 'signed-out';
		return;
	}
	if (!quiet) projectChannels.status = 'loading';
	try {
		const me = await client.me();
		const owners: Record<string, string | null> = {};
		const rosters: Record<string, string[]> = {};
		const teams: Record<string, RosterTeams> = {};
		let unreadable = false;
		await Promise.all(
			me.projects.map(async (p) => {
				const roster = await client!.roster(p.slug);
				if (!roster) unreadable = true;
				owners[p.slug] = roster?.owner ?? null;
				if (roster?.members) rosters[p.slug] = roster.members;
				if (roster?.teams) teams[p.slug] = roster.teams;
			})
		);
		// A background refresh never swaps a good view for a partial one.
		if (quiet && unreadable) return;
		projectChannels.owner = me.owner || me.projects.some((p) => p.role === 'owner');
		projectChannels.projects = me.projects;
		projectChannels.owners = owners;
		projectChannels.rosters = rosters;
		projectChannels.teams = teams;
		projectChannels.ready = me.ready;
		projectChannels.error = '';
		projectChannels.invite = null;
		forgetInvite(); // already in: the link has nothing left to do
		projectChannels.status = 'ready';
		loadedFor = account.pubkey;
		const c = client;
		setProfileSource({ profiles: (pks) => c.profiles(pks), avatar: (pk) => c.avatar(pk) }, (ev) =>
			eventStore.add(ev)
		);
	} catch (error) {
		if (error instanceof ContinuumError && error.status === 401) {
			setProfileSource(null);
			projectChannels.status = 'signed-out';
		} else if (quiet) {
			// Keep the current view; the next tick tries again.
		} else {
			projectChannels.status = 'error';
			projectChannels.error = explain(error);
		}
	}
}

/** A live stored session for this key: load it instead of signing (ADR 0008). */
export function hasContinuumSession(pubkey: string): boolean {
	return Boolean(client?.hasSession(normalizePubKey(pubkey)));
}

/** Renew the session if due (load, focus, tick); never prompts the signer. */
export async function renewContinuumSession(): Promise<void> {
	const account = manager.getActive();
	if (!client || !account) return;
	const pubkey = normalizePubKey(account.pubkey);
	if (!client.hasSession(pubkey) || !client.needsRenewal()) return;
	if (!(await client.renew()) && projectChannels.status === 'ready') {
		signOutOfContinuum();
	}
}

/**
 * Owner inside Continuum's Team view (ADR 0008): ask the parent for the
 * owner's team session instead of signing a second challenge. Accepted only
 * from window.parent, from the node file's Continuum origin, for the key the
 * signer gave us. Resolves false after `waitMs` so sign-in can go ahead.
 */
export function requestSessionHandoff(waitMs = 2500): Promise<boolean> {
	const account = manager.getActive();
	if (!client || !account || typeof window === 'undefined' || window.parent === window) {
		return Promise.resolve(false);
	}
	const c = client;
	const pubkey = normalizePubKey(account.pubkey);
	return new Promise((resolve) => {
		const done = (ok: boolean) => {
			clearTimeout(timer);
			window.removeEventListener('message', onMessage);
			resolve(ok);
		};
		const onMessage = (e: MessageEvent) => {
			if (!acceptsHandoff(e, window.parent, c.origin)) return;
			if (c.adopt(e.data, pubkey)) done(true);
		};
		const timer = setTimeout(() => done(false), waitMs);
		window.addEventListener('message', onMessage);
		window.parent.postMessage({ type: 'torii:session-request', pubkey }, c.origin);
	});
}

/**
 * Sign a Continuum challenge with the active account (one signer prompt).
 * With an invite in this tab the same signature claims it (ADR 0009).
 */
export async function signInToContinuum(): Promise<void> {
	const account = manager.getActive();
	if (!client || !account) return;
	projectChannels.status = 'signing-in';
	inviteGone = false;
	const pubkey = normalizePubKey(account.pubkey);
	try {
		if (link) {
			const names = projectChannels.invite ?? { projectName: '', ownerName: '' };
			const r = await client.claimInvite(account.signer, pubkey, link, names);
			forgetInvite();
			if (r.state === 'waiting') {
				projectChannels.status = 'waiting';
				return;
			}
			projectChannels.invite = null;
		} else {
			await client.signIn(account.signer, pubkey);
		}
		await refreshProjectChannels({ force: true });
	} catch (error) {
		if (error instanceof ContinuumError && error.code === 'invite_unavailable') {
			forgetInvite();
			projectChannels.invite = null;
			projectChannels.status = 'error';
			projectChannels.error = INVITE_GONE;
			return;
		}
		projectChannels.status = 'error';
		projectChannels.error = explain(error);
	}
}

/**
 * While waiting on an invite: has the owner let us in? Network only, never
 * the signer (load, focus, the 60 s tick). Refusal shows one plain line.
 */
let checking: Promise<void> | null = null;
export function checkInvite(): Promise<void> {
	if (!client || projectChannels.status !== 'waiting') return Promise.resolve();
	const c = client;
	checking ??= (async () => {
		const state = await c.checkWaiting();
		if (projectChannels.status !== 'waiting') return;
		if (state === 'in') {
			projectChannels.invite = null;
			projectChannels.status = 'loading';
			await refreshProjectChannels({ force: true });
		} else if (state === 'refused') {
			projectChannels.invite = null;
			projectChannels.status = 'error';
			projectChannels.error = INVITE_GONE;
		}
	})().finally(() => {
		checking = null;
	});
	return checking;
}

/** While waiting: tell Continuum the owner's client can add us (once per key). */
let readyWaitingFor = '';
export async function reportReadyWaiting(): Promise<void> {
	const pubkey = manager.getActive()?.pubkey ?? '';
	if (!client || projectChannels.status !== 'waiting' || !pubkey || readyWaitingFor === pubkey) {
		return;
	}
	readyWaitingFor = pubkey;
	try {
		await client.markReadyWaiting();
	} catch {
		readyWaitingFor = '';
	}
}

/**
 * Tell Continuum this client's key packages are on the node coordinator
 * (verified by the caller from reachability), once per session. Bearer only.
 */
let readySentFor = '';
export async function reportReady(): Promise<void> {
	const pubkey = manager.getActive()?.pubkey ?? '';
	if (!client || projectChannels.status !== 'ready' || projectChannels.ready !== false) return;
	if (!pubkey || readySentFor === pubkey) return;
	readySentFor = pubkey;
	try {
		await client.markReady();
		projectChannels.ready = true;
	} catch {
		readySentFor = ''; // try again on a later tick
	}
}

/** Owner: Continuum's chat record and membership signals. */
export function continuumClient(): ContinuumClient | null {
	return client;
}

export function signOutOfContinuum(): void {
	setProfileSource(null);
	client?.signOut();
	forgetInvite();
	projectChannels.invite = null;
	loadedFor = '';
	projectChannels.status = client ? 'signed-out' : 'off';
	projectChannels.projects = [];
	projectChannels.rosters = {};
	projectChannels.teams = {};
	projectChannels.ready = null;
}

function groupLikes(): GroupLike[] {
	return listChatGroups().map((g) => {
		let members: string[];
		try {
			members = listChatGroupMembers(g.id).map((m) => normalizePubKey(m.stablePubkey));
		} catch {
			members = [];
		}
		const admins = g.metadata?.adminPubkeys?.length
			? g.metadata.adminPubkeys.map((p) => normalizePubKey(p))
			: null;
		return {
			id: g.id,
			coordinatorKey: normalizePubKey(g.coordinatorKey),
			description: g.metadata?.description,
			adminPubkeys: admins,
			memberPubkeys: members,
			status: g.status
		};
	});
}

/** The Cordn group for a project on this node, or null (fails closed). */
export function projectGroup(slug: string): GroupLike | null {
	return matchProjectGroup(
		slug,
		projectChannels.owners[slug] ?? null,
		normalizePubKey(projectChannels.coordinator),
		groupLikes(),
		projectChannels.teams[slug]?.chatGroupId ?? null
	);
}

export function projectGroupId(slug: string): string | null {
	return projectGroup(slug)?.id ?? null;
}

/** The project whose chat is this group, or null. */
export function projectForGroup(groupId: string): string | null {
	for (const p of projectChannels.projects) {
		if (projectGroupId(p.slug) === groupId) return p.slug;
	}
	return null;
}
