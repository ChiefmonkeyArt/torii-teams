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
