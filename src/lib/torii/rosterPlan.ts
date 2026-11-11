// Torii Teams: the roster is the membership (ADR 0005). Pure rules only; the
// effects live in rosterSync.svelte.ts.

import { projectMarker } from './continuumApi';

/** Do not retry a failed invite for this long. */
export const INVITE_RETRY_MS = 10 * 60 * 1000;

/**
 * Every coordinator call asks the user's signer (a popup with extension
 * signers). Automatic passes that need the coordinator run at most once per
 * pace; the pace doubles while nothing changes and resets on progress.
 */
export const PACE_MIN_MS = 5 * 60 * 1000;
export const PACE_MAX_MS = 30 * 60 * 1000;

export function nextPace(pace: number, progressed: boolean): number {
	return progressed ? PACE_MIN_MS : Math.min(PACE_MAX_MS, Math.max(PACE_MIN_MS, pace * 2));
}

export function coordinatorDue(now: number, lastAt: number | null, pace: number): boolean {
	return lastAt === null || now - lastAt >= pace;
}

/** A member's client only needs to look for welcomes while a project of
 *  theirs (owned by someone else) has no chat on this device. */
export function needsWelcomeCheck(
	slugs: string[],
	owners: Readonly<Record<string, string | null>>,
	me: string,
	hasChat: (slug: string) => boolean
): boolean {
	return slugs.some((s) => owners[s] !== me && !hasChat(s));
}

export interface RosterPlanInput {
	me: string;
	owner: string | null;
	/** Roster pubkeys (owner included); undefined when the roster was unreadable. */
	roster: string[] | undefined;
	/** The project's chat, or null when there is none yet. */
	groupMembers: string[] | null;
	/** Pubkeys holding a key package on the node coordinator. */
	available: ReadonlySet<string>;
	/** Last failed invite per pubkey (ms). */
	failedAt?: Readonly<Record<string, number>>;
	now?: number;
}

export interface RosterPlan {
	create: boolean;
	invite: string[];
	remove: string[];
	/** Roster members who are not in the chat and cannot be added yet. */
	waiting: string[];
}

const NOTHING: RosterPlan = { create: false, invite: [], remove: [], waiting: [] };

export function planRosterSync(input: RosterPlanInput): RosterPlan {
	const { me, owner, roster, groupMembers, available } = input;
	// Only the project owner's client acts, and only on a roster it could read.
	if (!owner || me !== owner || !roster || !roster.includes(owner)) return NOTHING;
	if (!groupMembers) {
		return { create: true, invite: [], remove: [], waiting: roster.filter((p) => p !== me) };
	}
	const inGroup = new Set(groupMembers);
	const onRoster = new Set(roster);
	const now = input.now ?? Date.now();
	const failedAt = input.failedAt ?? {};
	const invite: string[] = [];
	const waiting: string[] = [];
	for (const pk of roster) {
		if (pk === me || inGroup.has(pk)) continue;
		const recentlyFailed = now - (failedAt[pk] ?? -Infinity) < INVITE_RETRY_MS;
		if (available.has(pk) && !recentlyFailed) invite.push(pk);
		else waiting.push(pk);
	}
	let remove = groupMembers.filter((pk) => pk !== me && !onRoster.has(pk));
	// A bad read must never empty a chat: remove at most half of it at once.
	if (remove.length > Math.floor(groupMembers.length / 2)) remove = [];
	return { create: false, invite, remove, waiting };
}

/** Roster members not in the chat, for display on any member's client. */
export function waitingMembers(roster: string[] | undefined, groupMembers: string[]): string[] {
	if (!roster) return [];
	const inGroup = new Set(groupMembers);
	return roster.filter((pk) => !inGroup.has(pk));
}

const MARKER_RE = /^torii:project=([a-z0-9][a-z0-9-]{0,62})$/;

/** The project slugs a group description claims (normally one). */
export function markerSlugs(description: string | undefined): string[] {
	const out: string[] = [];
	for (const word of (description ?? '').split(/\s+/)) {
		const m = MARKER_RE.exec(word);
		if (m && projectMarker(m[1]) === word) out.push(m[1]);
	}
	return out;
}

export interface WelcomeLike {
	coordinatorKey: string;
	description?: string;
	memberPubkeys?: string[];
}

export interface WelcomeContext {
	nodeCoordinator: string;
	/** Projects the member is on (from /api/team/me). */
	projects: ReadonlySet<string>;
	owners: Readonly<Record<string, string | null>>;
	rosters: Readonly<Record<string, string[]>>;
}

/**
 * The project a welcome may be auto-accepted for, or null (leave it alone).
 * All must hold: exactly one marker, for a project the member is on; the node
 * coordinator; the project owner is a member; every member is on the roster.
 */
export function autoAcceptProject(welcome: WelcomeLike, ctx: WelcomeContext): string | null {
	if (!ctx.nodeCoordinator || welcome.coordinatorKey !== ctx.nodeCoordinator) return null;
	const slugs = markerSlugs(welcome.description);
	if (slugs.length !== 1) return null;
	const slug = slugs[0];
	if (!ctx.projects.has(slug)) return null;
	const owner = ctx.owners[slug];
	const roster = ctx.rosters[slug];
	const members = welcome.memberPubkeys ?? [];
	if (!owner || !roster || !members.includes(owner)) return null;
	const onRoster = new Set(roster);
	return members.every((pk) => onRoster.has(pk)) ? slug : null;
}

// ── Membership signals (ADR 0006) ─────────────────────────────────────────
// With Continuum's signals the owner's client calls the coordinator only when
// there is work it can do: create a chat nobody has claimed, add someone whose
// client reported ready, remove someone taken off the roster. Each attempt is
// remembered per person for INVITE_RETRY_MS, so a call that does not stick
// never turns into a prompt every minute.

/** A member's welcome check backs off 1, 2, 4 … 30 minutes. */
export const WELCOME_MIN_MS = 60 * 1000;
export const WELCOME_MAX_MS = 30 * 60 * 1000;

export function nextWelcomePace(pace: number): number {
	return Math.min(WELCOME_MAX_MS, Math.max(WELCOME_MIN_MS, pace * 2));
}

export interface OwnerSignalsInput {
	me: string;
	owner: string | null;
	roster: string[] | undefined;
	/** The project chat on this device, or null. */
	localGroup: { id: string; memberPubkeys: string[] } | null;
	teams: {
		chatGroupId: string | null;
		claimed: boolean;
		ready: readonly string[];
		added: readonly string[];
	};
	/** Last attempt per key (ms): pubkeys for invites/removals, `chat:<slug>` for creation. */
	attemptedAt?: Readonly<Record<string, number>>;
	slug: string;
	now?: number;
}

export type ChatAction = 'ok' | 'create' | 'record' | 'elsewhere' | 'wait';

export interface OwnerSignalsPlan {
	chat: ChatAction;
	invite: string[];
	remove: string[];
	/** Tell Continuum: these are in the chat now / not any more. */
	markAdded: string[];
	markRemoved: string[];
	/** On the roster, not in the chat, not addable yet (not ready, or retrying). */
	waiting: string[];
}

const NO_SIGNALS: OwnerSignalsPlan = {
	chat: 'wait',
	invite: [],
	remove: [],
	markAdded: [],
	markRemoved: [],
	waiting: []
};

export function planOwnerSignals(input: OwnerSignalsInput): OwnerSignalsPlan {
	const { me, owner, roster, localGroup, teams, slug } = input;
	if (!owner || me !== owner || !roster || !roster.includes(owner)) return NO_SIGNALS;
	const now = input.now ?? Date.now();
	const attempted = input.attemptedAt ?? {};
	const recent = (key: string) => now - (attempted[key] ?? -Infinity) < INVITE_RETRY_MS;
	const others = roster.filter((p) => p !== me);

	if (!localGroup) {
		// Started on another device (or being started there): never duplicate it.
		if (teams.chatGroupId || teams.claimed)
			return { ...NO_SIGNALS, chat: 'elsewhere', waiting: others };
		return { ...NO_SIGNALS, chat: recent(`chat:${slug}`) ? 'wait' : 'create', waiting: others };
	}
	if (teams.chatGroupId && teams.chatGroupId !== localGroup.id) {
		return { ...NO_SIGNALS, chat: 'elsewhere', waiting: others };
	}
	const chat: ChatAction = teams.chatGroupId ? 'ok' : 'record';
	const inGroup = new Set(localGroup.memberPubkeys);
	const onRoster = new Set(roster);
	const ready = new Set(teams.ready);
	const added = new Set(teams.added);
	const invite: string[] = [];
	const waiting: string[] = [];
	for (const pk of others) {
		if (inGroup.has(pk)) continue;
		if (ready.has(pk) && !recent(pk)) invite.push(pk);
		else waiting.push(pk);
	}
	let remove = localGroup.memberPubkeys.filter(
		(pk) => pk !== me && !onRoster.has(pk) && !recent(pk)
	);
	// A bad read must never empty a chat: remove at most half of it at once.
	if (remove.length > Math.floor(localGroup.memberPubkeys.length / 2)) remove = [];
	const markAdded = others.filter((pk) => inGroup.has(pk) && !added.has(pk));
	const markRemoved = [...added].filter((pk) => !inGroup.has(pk));
	return { chat, invite, remove, markAdded, markRemoved, waiting };
}

/** Member: projects whose owner says we were added but which have no chat here. */
export function welcomeDue(
	projects: ReadonlyArray<{ slug: string; added: boolean }>,
	owners: Readonly<Record<string, string | null>>,
	me: string,
	hasChat: (slug: string) => boolean
): string[] {
	return projects
		.filter((p) => p.added && owners[p.slug] !== me && !hasChat(p.slug))
		.map((p) => p.slug);
}

/** Owner, while a teammate is not in the chat yet (ADR 0019): check this often. */
export const OWNER_QUICK_MS = 15 * 1000;
/** ...for this long after the waiting list last changed or the page opened. */
export const OWNER_QUICK_FOR_MS = 15 * 60 * 1000;

/** Everyone still waiting across owned projects, as one stable key. */
export function waitingKey(
	waiting: Readonly<Record<string, readonly string[] | undefined>>
): string {
	return Object.keys(waiting)
		.sort()
		.flatMap((slug) => (waiting[slug] ?? []).map((pk) => `${slug}:${pk}`))
		.join(',');
}

/**
 * The owner's quick check (Continuum reads only, no signer): due when someone
 * is waiting, the waiting list changed (or the page opened) within
 * {@link OWNER_QUICK_FOR_MS}, and the last check was {@link OWNER_QUICK_MS} ago.
 * After that the regular 60 s pass carries on.
 */
export function ownerQuickCheckDue(input: {
	now: number;
	key: string;
	since: number;
	lastAt: number;
}): boolean {
	if (!input.key) return false;
	if (input.now - input.since >= OWNER_QUICK_FOR_MS) return false;
	return input.now - input.lastAt >= OWNER_QUICK_MS;
}
