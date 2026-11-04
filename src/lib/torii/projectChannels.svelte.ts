// Torii Teams: the sidebar on a Torii node is one channel per Continuum
// project the member is on (owner decision 2026-11-04: the project is the only
// unit of access; no lobby, no team-wide group, no other groups shown).

import { listChatGroupMembers, listChatGroups } from '$lib/services/chatGroups.svelte';
import { manager } from '$lib/services/accountManager.svelte';
import { normalizePubKey } from '$lib/utils';
import type { ToriiNodeConfig } from './nodeConfig';
import {
	ContinuumClient,
	ContinuumError,
	matchProjectGroup,
	type GroupLike,
	type TeamProject
} from './continuumApi';

export type ChannelsStatus = 'off' | 'signed-out' | 'signing-in' | 'loading' | 'ready' | 'error';

export const projectChannels = $state<{
	status: ChannelsStatus;
	error: string;
	owner: boolean;
	projects: TeamProject[];
	owners: Record<string, string | null>;
	coordinator: string;
	relays: string[];
}>({
	status: 'off',
	error: '',
	owner: false,
	projects: [],
	owners: {},
	coordinator: '',
	relays: []
});

let client: ContinuumClient | null = null;
// One load per account: every sidebar instance (desktop + phone sheet) asks,
// but only the first call for a pubkey reaches Continuum.
let inflight: Promise<void> | null = null;
let loadedFor = '';

/** Called once with the node file; turns project mode on only when Continuum is set. */
export function startProjectChannels(config: ToriiNodeConfig, relays: string[]): void {
	if (!config.continuum || typeof window === 'undefined') return;
	client = new ContinuumClient(config.continuum, {
		fetch: fetch.bind(window),
		storage: sessionStorage
	});
	projectChannels.coordinator = config.coordinator;
	projectChannels.relays = relays;
	projectChannels.status = 'signed-out';
	void refreshProjectChannels();
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

/** Load projects with a stored session; never prompts the signer. */
export function refreshProjectChannels(options: { force?: boolean } = {}): Promise<void> {
	const pubkey = manager.getActive()?.pubkey ?? '';
	if (!options.force && pubkey && pubkey === loadedFor && projectChannels.status === 'ready') {
		return Promise.resolve();
	}
	if (inflight) return inflight;
	inflight = loadProjectChannels().finally(() => {
		inflight = null;
	});
	return inflight;
}

async function loadProjectChannels(): Promise<void> {
	loadedFor = '';
	const account = manager.getActive();
	if (!client || !account) {
		if (client) projectChannels.status = 'signed-out';
		return;
	}
	const pubkey = normalizePubKey(account.pubkey);
	if (!client.hasSession(pubkey)) {
		projectChannels.status = 'signed-out';
		return;
	}
	projectChannels.status = 'loading';
	try {
		const me = await client.me();
		const owners: Record<string, string | null> = {};
		await Promise.all(
			me.projects.map(async (p) => {
				owners[p.slug] = await client!.rosterOwner(p.slug);
			})
		);
		projectChannels.owner = me.owner || me.projects.some((p) => p.role === 'owner');
		projectChannels.projects = me.projects;
		projectChannels.owners = owners;
		projectChannels.error = '';
		projectChannels.status = 'ready';
		loadedFor = account.pubkey;
	} catch (error) {
		if (error instanceof ContinuumError && error.status === 401) {
			projectChannels.status = 'signed-out';
		} else {
			projectChannels.status = 'error';
			projectChannels.error = explain(error);
		}
	}
}

/** Sign a Continuum challenge with the active account (one signer prompt). */
export async function signInToContinuum(): Promise<void> {
	const account = manager.getActive();
	if (!client || !account) return;
	projectChannels.status = 'signing-in';
	try {
		await client.signIn(account.signer, normalizePubKey(account.pubkey));
		await refreshProjectChannels({ force: true });
	} catch (error) {
		projectChannels.status = 'error';
		projectChannels.error = explain(error);
	}
}

export function signOutOfContinuum(): void {
	client?.signOut();
	loadedFor = '';
	projectChannels.status = client ? 'signed-out' : 'off';
	projectChannels.projects = [];
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
export function projectGroupId(slug: string): string | null {
	const hit = matchProjectGroup(
		slug,
		projectChannels.owners[slug] ?? null,
		normalizePubKey(projectChannels.coordinator),
		groupLikes()
	);
	return hit?.id ?? null;
}
