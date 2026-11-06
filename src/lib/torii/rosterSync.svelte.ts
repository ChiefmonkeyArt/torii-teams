// Torii Teams: keep each project chat in step with its Continuum roster
// (ADR 0005). The owner's client creates the chat and adds/removes members;
// a member's client accepts the owner's welcome. Rules: rosterPlan.ts.
// With Continuum's membership signals (ADR 0006) the owner only calls the
// coordinator when someone reported ready or left the roster, and a member
// only looks for welcomes once the owner's client says it added them.

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
import { ContinuumError, projectMarker } from './continuumApi';
import { continuumClient, projectChannels, projectGroup } from './projectChannels.svelte';
import {
	autoAcceptProject,
	coordinatorDue,
	needsWelcomeCheck,
	nextPace,
	nextWelcomePace,
	PACE_MIN_MS,
	planOwnerSignals,
	planRosterSync,
	welcomeDue,
	WELCOME_MIN_MS
} from './rosterPlan';

/** How often the page asks whether a paced pass is due (no signer call). */
export const SYNC_INTERVAL_MS = 60 * 1000;
/** While waiting on an ask-first invite (ADR 0010); 3 a minute stays far
 * under Continuum's 20-a-minute refresh limit, even for a few people behind
 * one address. */
export const WAIT_CHECK_MS = 20 * 1000;

/** Per project: roster members who cannot be added until they sign in. */
export const rosterSync = $state<{
	waiting: Record<string, string[]>;
	busy: Record<string, boolean>;
	error: Record<string, string>;
	/** The chat exists but was started on another of the owner's devices. */
	elsewhere: Record<string, boolean>;
}>({ waiting: {}, busy: {}, error: {}, elsewhere: {} });

const failedAt: Record<string, number> = {};
/** ADR 0006: last coordinator attempt per pubkey / `chat:<slug>` (ms). */
const attemptedAt: Record<string, number> = {};
// Member welcome backoff (1 → 30 min), reset when the set of projects changes.
let welcomeKey = '';
let welcomeAt: number | null = null;
let welcomePace = WELCOME_MIN_MS;
const createRequested = new Set<string>();
// Coordinator pacing (see rosterPlan PACE_*): each call is a signer prompt.
let lastCoordinatorAt: number | null = null;
let pace = PACE_MIN_MS;
/** Set by a pass that called the coordinator / changed membership. */
let touched = false;
let progressed = false;

/** The owner asked to start this project's chat; runs a pass now. */
export function startProjectChat(slug: string): Promise<void> {
	createRequested.add(slug);
	delete attemptedAt[`chat:${slug}`];
	return syncRosters({ now: true });
}
let running: Promise<void> | null = null;
let again = false;
let forceNext = false;

/** Web Locks keep two tabs from creating two chats for one project. */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (!locks?.request) return fn();
	return locks.request(name, fn) as Promise<T>;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Owner, with Continuum's signals. Claim-before-create means a second device
 * (or tab) never makes a duplicate chat; it reports "started elsewhere".
 */
async function syncOwnedWithSignals(slug: string, me: string): Promise<void> {
	const c = continuumClient();
	const owner = projectChannels.owners[slug] ?? null;
	const roster = projectChannels.rosters[slug];
	const teams = projectChannels.teams[slug];
	const coordinator = normalizePubKey(projectChannels.coordinator);
	if (!c || owner !== me || !roster || !teams || !coordinator) return;
	let group = projectGroup(slug);
	let plan = planOwnerSignals({ me, owner, roster, localGroup: group, teams, attemptedAt, slug });
	rosterSync.elsewhere[slug] = plan.chat === 'elsewhere';
	if (plan.chat === 'elsewhere' || plan.chat === 'wait') {
		rosterSync.waiting[slug] = plan.waiting;
		return;
	}
	if (plan.chat === 'create') {
		attemptedAt[`chat:${slug}`] = Date.now();
		try {
			await c.chatOp(slug, 'claim');
		} catch (error) {
			if (
				error instanceof ContinuumError &&
				(error.code === 'claimed' || error.code === 'exists')
			) {
				rosterSync.elsewhere[slug] = true;
				return;
			}
			throw error;
		}
		touched = progressed = true;
		try {
			await withLock(`torii.createProjectChat:${slug}`, async () => {
				if (projectGroup(slug)) return;
				await createChatGroup({
					name: slug,
					description: projectMarker(slug),
					coordinatorKey: coordinator,
					adminPubkeys: [me]
				});
			});
		} catch (error) {
			await c.chatOp(slug, 'release').catch(() => {});
			throw error;
		}
		group = projectGroup(slug);
		if (!group) {
			await c.chatOp(slug, 'release').catch(() => {});
			return;
		}
	}
	if (plan.chat === 'create' || plan.chat === 'record') {
		await c.chatOp(slug, 'set', group!.id);
		teams.chatGroupId = group!.id;
		teams.claimed = false;
	}
	plan = planOwnerSignals({ me, owner, roster, localGroup: group, teams, attemptedAt, slug });
	if (plan.invite.length) {
		touched = progressed = true;
		const t = Date.now();
		for (const pk of plan.invite) attemptedAt[pk] = t;
		await inviteChatGroupMembers({
			groupId: group!.id,
			targets: plan.invite.map((pk) => ({ identifier: pk, expectedStablePubkey: pk }))
		});
	}
	for (const pk of plan.remove) {
		touched = progressed = true;
		attemptedAt[pk] = Date.now();
		await removeChatGroupMember({ groupId: group!.id, targetStablePubkey: pk });
	}
	// Report what the chat holds now (bearer only, no signer).
	group = projectGroup(slug);
	if (group) {
		plan = planOwnerSignals({ me, owner, roster, localGroup: group, teams, attemptedAt, slug });
		if (plan.markAdded.length || plan.markRemoved.length) {
			await c.markMembers(slug, plan.markAdded, plan.markRemoved);
			teams.added = [...new Set([...teams.added, ...plan.markAdded])].filter(
				(pk) => !plan.markRemoved.includes(pk)
			);
		}
	}
	rosterSync.waiting[slug] = plan.waiting;
}

async function syncOwnedProject(slug: string, me: string): Promise<void> {
	const owner = projectChannels.owners[slug] ?? null;
	const roster = projectChannels.rosters[slug];
	if (owner !== me || !roster) return;
	const coordinator = normalizePubKey(projectChannels.coordinator);
	if (!coordinator) return;
	if (projectChannels.teams[slug]) return syncOwnedWithSignals(slug, me);

	let group = projectGroup(slug);
	// Nothing to ask the coordinator: everyone on the roster is in the chat.
	if (group && !createRequested.has(slug)) {
		const local = planRosterSync({
			me,
			owner,
			roster,
			groupMembers: group.memberPubkeys,
			available: new Set()
		});
		if (!local.waiting.length && !local.remove.length) {
			rosterSync.waiting[slug] = [];
			return;
		}
	}
	// Creation needs the owner's click: a second device of the owner has no
	// local copy of an existing chat and would otherwise make a duplicate.
	if (!group && !createRequested.has(slug)) return;
	if (!group) {
		createRequested.delete(slug);
		touched = progressed = true;
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

	touched = true;
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
	if (plan.invite.length || plan.remove.length) progressed = true;
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

/**
 * Member: is a welcome check due? With signals, only for projects whose
 * owner's client added us, backing off 1 → 30 min; without, the old pacing.
 */
function welcomeCheckDue(me: string, force: boolean): boolean | 'paced' {
	if (projectChannels.ready === null) {
		const slugs = projectChannels.projects.map((p) => p.slug);
		return needsWelcomeCheck(slugs, projectChannels.owners, me, (s) => Boolean(projectGroup(s)))
			? 'paced'
			: false;
	}
	const due = welcomeDue(projectChannels.projects, projectChannels.owners, me, (s) =>
		Boolean(projectGroup(s))
	);
	const key = due.join(',');
	if (key !== welcomeKey) {
		welcomeKey = key;
		welcomeAt = null;
		welcomePace = WELCOME_MIN_MS;
	}
	if (!due.length) return false;
	if (!force && !coordinatorDue(Date.now(), welcomeAt, welcomePace)) return false;
	welcomeAt = Date.now();
	welcomePace = nextWelcomePace(welcomePace);
	return true;
}

async function acceptProjectWelcomes(me: string): Promise<void> {
	const coordinator = normalizePubKey(projectChannels.coordinator);
	if (!coordinator) return;
	touched = true;
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
			accepted = progressed = true;
		} catch (error) {
			rosterSync.error[slug] = message(error);
		} finally {
			clearWelcomeSubmitting(w.id);
		}
	}
	if (accepted) void refreshWelcomeNotificationsAction().catch(() => {});
}

async function syncOnce(force: boolean): Promise<void> {
	const account = manager.getActive();
	if (!account || projectChannels.status !== 'ready') return;
	const me = normalizePubKey(account.pubkey);
	// Signals present: no shared pace. The owner acts only on work, each
	// attempt remembered per person; the member's welcome check has its own
	// backoff. Without signals (older Continuum): the torii.5 pacing.
	const signals = projectChannels.ready !== null;
	if (!signals && !force && !coordinatorDue(Date.now(), lastCoordinatorAt, pace)) return;
	touched = progressed = false;
	let failed = false;
	const welcome = welcomeCheckDue(me, force);
	if (welcome) await acceptProjectWelcomes(me).catch(() => {});
	for (const p of projectChannels.projects) {
		if (projectChannels.owners[p.slug] !== me) continue;
		rosterSync.busy[p.slug] = true;
		try {
			await syncOwnedProject(p.slug, me);
			delete rosterSync.error[p.slug];
		} catch (error) {
			failed = true;
			rosterSync.error[p.slug] = message(error);
		} finally {
			rosterSync.busy[p.slug] = false;
		}
	}
	if (!signals && (touched || failed)) {
		lastCoordinatorAt = Date.now();
		pace = nextPace(pace, progressed && !failed);
	}
}

/**
 * Run a pass. Automatic passes are paced (no signer prompt loops); `now` is
 * for a user's click. Overlapping calls coalesce into one follow-up pass.
 */
export function syncRosters(opts: { now?: boolean } = {}): Promise<void> {
	if (opts.now) forceNext = true;
	if (running) {
		again = true;
		return running;
	}
	running = (async () => {
		do {
			again = false;
			const force = forceNext;
			forceNext = false;
			await syncOnce(force);
		} while (again);
	})().finally(() => {
		running = null;
	});
	return running;
}
