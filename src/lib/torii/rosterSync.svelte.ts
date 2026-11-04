// Torii Teams: keep each project chat in step with its Continuum roster
// (ADR 0005). The owner's client creates the chat and adds/removes members;
// a member's client accepts the owner's welcome. Rules: rosterPlan.ts.

import {
	acceptChatWelcome,
	createChatGroup,
	inviteChatGroupMembers,
	listCoordinatorAvailableKeyPackages,
	removeChatGroupMember
} from '$lib/services/chatGroups.svelte';
import {
	listWelcomeNotifications,
	clearWelcomeSubmitting,
	isWelcomeSubmitting,
	setWelcomeSubmitting
} from '$lib/services/chatWelcomeNotifications.svelte';
import {
	refreshCoordinatorWelcomeNotificationsAction,
	refreshWelcomeNotificationsAction
} from '$lib/services/chatUiActions.svelte';
import { manager } from '$lib/services/accountManager.svelte';
import { safeNormalizePubKey as normalizePubKey } from '$lib/utils';
import { projectMarker } from './continuumApi';
import { projectChannels, projectGroup } from './projectChannels.svelte';
import { autoAcceptProject, planRosterSync } from './rosterPlan';

export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Per project: roster members who cannot be added until they sign in. */
export const rosterSync = $state<{
	waiting: Record<string, string[]>;
	busy: Record<string, boolean>;
	error: Record<string, string>;
}>({ waiting: {}, busy: {}, error: {} });

const failedAt: Record<string, number> = {};
const createRequested = new Set<string>();

/** The owner asked to start this project's chat; runs a sync pass now. */
export function startProjectChat(slug: string): Promise<void> {
	createRequested.add(slug);
	return syncRosters();
}
let running: Promise<void> | null = null;
let again = false;

/** Web Locks keep two tabs from creating two chats for one project. */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (!locks?.request) return fn();
	return locks.request(name, fn) as Promise<T>;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function syncOwnedProject(slug: string, me: string): Promise<void> {
	const owner = projectChannels.owners[slug] ?? null;
	const roster = projectChannels.rosters[slug];
	if (owner !== me || !roster) return;
	const coordinator = normalizePubKey(projectChannels.coordinator);
	if (!coordinator) return;

	let group = projectGroup(slug);
	// Creation needs the owner's click: a second device of the owner has no
	// local copy of an existing chat and would otherwise make a duplicate.
	if (!group && !createRequested.has(slug)) return;
	if (!group) {
		createRequested.delete(slug);
		await withLock(`torii.createProjectChat:${slug}`, async () => {
			if (projectGroup(slug)) return; // another tab won the race
			const plan = planRosterSync({ me, owner, roster, groupMembers: null, available: new Set() });
			if (!plan.create) return;
			await createChatGroup({
				name: slug,
				description: projectMarker(slug),
				coordinatorKey: coordinator,
				adminPubkeys: [me]
			});
		});
		group = projectGroup(slug);
		if (!group) return;
	}

	const available = new Set(
		(await listCoordinatorAvailableKeyPackages(group.id)).map((k) => k.stablePubkey)
	);
	const plan = planRosterSync({
		me,
		owner,
		roster,
		groupMembers: group.memberPubkeys,
		available,
		failedAt
	});
	if (plan.invite.length) {
		const result = await inviteChatGroupMembers({
			groupId: group.id,
			targets: plan.invite.map((pk) => ({ identifier: pk, expectedStablePubkey: pk }))
		});
		const now = Date.now();
		for (const f of result.failures) failedAt[normalizePubKey(f.identifier)] = now;
	}
	for (const pk of plan.remove) {
		await removeChatGroupMember({ groupId: group.id, targetStablePubkey: pk });
	}
	rosterSync.waiting[slug] = plan.waiting;
}

async function acceptProjectWelcomes(me: string): Promise<void> {
	const coordinator = normalizePubKey(projectChannels.coordinator);
	if (!coordinator) return;
	await refreshCoordinatorWelcomeNotificationsAction(coordinator).catch(() => {});
	const ctx = {
		nodeCoordinator: coordinator,
		projects: new Set(projectChannels.projects.map((p) => p.slug)),
		owners: projectChannels.owners,
		rosters: projectChannels.rosters
	};
	let accepted = false;
	for (const w of listWelcomeNotifications()) {
		if (w.status === 'accepted' || w.status === 'dismissed' || isWelcomeSubmitting(w.id)) continue;
		const slug = autoAcceptProject(
			{
				coordinatorKey: normalizePubKey(w.coordinatorKey),
				description: w.preview?.description,
				memberPubkeys: (w.preview?.memberPubkeys ?? []).map((p) => normalizePubKey(p))
			},
			ctx
		);
		// Never join a second chat for a project we already have.
		if (!slug || projectChannels.owners[slug] === me || projectGroup(slug)) continue;
		setWelcomeSubmitting(w.id);
		try {
			await acceptChatWelcome({ welcomeId: w.id });
			accepted = true;
		} catch (error) {
			rosterSync.error[slug] = message(error);
		} finally {
			clearWelcomeSubmitting(w.id);
		}
	}
	if (accepted) void refreshWelcomeNotificationsAction().catch(() => {});
}

async function syncOnce(): Promise<void> {
	const account = manager.getActive();
	if (!account || projectChannels.status !== 'ready') return;
	const me = normalizePubKey(account.pubkey);
	await acceptProjectWelcomes(me).catch(() => {});
	for (const p of projectChannels.projects) {
		if (projectChannels.owners[p.slug] !== me) continue;
		rosterSync.busy[p.slug] = true;
		try {
			await syncOwnedProject(p.slug, me);
			delete rosterSync.error[p.slug];
		} catch (error) {
			rosterSync.error[p.slug] = message(error);
		} finally {
			rosterSync.busy[p.slug] = false;
		}
	}
}

/** Run a pass now; overlapping calls coalesce into one follow-up pass. */
export function syncRosters(): Promise<void> {
	if (running) {
		again = true;
		return running;
	}
	running = (async () => {
		do {
			again = false;
			await syncOnce();
		} while (again);
	})().finally(() => {
		running = null;
	});
	return running;
}
