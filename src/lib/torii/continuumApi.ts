// Torii Teams: member sign-in to this node's Continuum and the caller's
// projects (TEAMS-2a slice 2). Continuum's contract, docs/adr-team-collaboration.md:
//   POST /api/auth/challenge {}            -> {challenge, expires_in, kind: 22242}
//   sign kind 22242 {content: challenge, tags: [["challenge", challenge]]}
//   POST /api/team/auth/verify {event}     -> {token: "m1....", expires_at}
//   GET  /api/team/me (Bearer)             -> {pubkey, owner, projects, teams_app_url}
//   GET  /api/projects/:slug/roster        -> {roster: {owner, members...}, role, teams}
// Membership signals and profiles (ADR 0006, Continuum adr-teams-membership-signals):
//   POST /api/team/ready                   -> caller's key packages are on the node coordinator
//   POST /api/projects/:slug/teams/chat    {op: claim|set|release, group_id}  (owner)
//   POST /api/projects/:slug/teams/members {added, removed}                    (owner)
//   GET  /api/team/profiles?p=hex,…        -> {profiles: {hex: {event}}}
//   GET  /api/team/avatar/:hex             -> image bytes
// Bearer only, no cookies, no refresh: a 401 means sign a new challenge.
// The owner signs in through the same member route and gets the same scoped
// token: the owner's admin token never lives on this origin (ADR 0002).

import type { EventTemplate, NostrEvent } from 'nostr-tools';

export interface TeamProject {
	slug: string;
	role: string;
	caps: string[];
	/** The owner has recorded this project's chat (ADR 0006). */
	chat: boolean;
	/** The owner's client has added the caller to that chat. */
	added: boolean;
}

export interface TeamMe {
	pubkey: string;
	owner: boolean;
	/** Null when this Continuum predates the membership signals. */
	ready: boolean | null;
	projects: TeamProject[];
}

/** Membership signals for one project, as the roster reply carries them. */
export interface RosterTeams {
	chatGroupId: string | null;
	claimed: boolean;
	ready: string[];
	added: string[];
}

export interface ContinuumSession {
	token: string;
	expiresAt: number;
	pubkey: string;
}

export interface SignerLike {
	signEvent(template: EventTemplate): Promise<NostrEvent>;
}

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export class ContinuumError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | null,
		message: string
	) {
		super(message);
	}
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^m1\.[A-Za-z0-9._-]{10,512}$/;
const MAX_PROJECTS = 200;
const MAX_BODY = 64 * 1024;
const MAX_PROFILES_BODY = 1024 * 1024;
const MAX_AVATAR_BYTES = 512 * 1024;
const GROUP_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

const sessionKey = (origin: string) => `torii.continuumSession:${origin}`;

async function readJson(res: Response, max = MAX_BODY): Promise<unknown> {
	const text = await res.text();
	if (text.length > max) throw new ContinuumError(res.status, null, 'response too large');
	try {
		return text ? JSON.parse(text) : null;
	} catch {
		throw new ContinuumError(res.status, null, 'bad JSON from Continuum');
	}
}

async function call(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit & { token?: string; maxBody?: number } = {}
): Promise<unknown> {
	const headers: Record<string, string> = { accept: 'application/json' };
	if (init.body) headers['content-type'] = 'application/json';
	if (init.token) headers.authorization = `Bearer ${init.token}`;
	const res = await fetchImpl(url, {
		method: init.method ?? 'GET',
		body: init.body,
		headers,
		credentials: 'omit',
		redirect: 'error',
		cache: 'no-store'
	});
	const body = await readJson(res, init.maxBody);
	if (!res.ok) {
		const b = (body && typeof body === 'object' ? body : {}) as { code?: unknown; error?: unknown };
		// Continuum puts short machine codes in `error` (e.g. "claimed").
		const code =
			typeof b.code === 'string'
				? b.code
				: typeof b.error === 'string' && /^[a-z_]{2,32}$/.test(b.error)
					? b.error
					: null;
		throw new ContinuumError(res.status, code, `Continuum ${res.status}${code ? ` ${code}` : ''}`);
	}
	return body;
}

export function parseTeamMe(raw: unknown): TeamMe | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.pubkey !== 'string' || !HEX64.test(r.pubkey)) return null;
	if (!Array.isArray(r.projects)) return null;
	const projects: TeamProject[] = [];
	for (const p of r.projects.slice(0, MAX_PROJECTS)) {
		if (!p || typeof p !== 'object') continue;
		const { slug, role, caps } = p as Record<string, unknown>;
		if (typeof slug !== 'string' || !SLUG_RE.test(slug) || typeof role !== 'string') continue;
		const { chat, added } = p as Record<string, unknown>;
		projects.push({
			slug,
			role: role.slice(0, 32),
			caps: Array.isArray(caps)
				? caps.filter((c): c is string => typeof c === 'string').slice(0, 32)
				: [],
			chat: chat === true,
			added: added === true
		});
	}
	return {
		pubkey: r.pubkey,
		owner: r.owner === true,
		ready: typeof r.ready === 'boolean' ? r.ready : null,
		projects
	};
}

/** The roster owner's pubkey, or null if the reply is not what we expect. */
export function parseRosterOwner(raw: unknown): string | null {
	const owner = (raw as { roster?: { owner?: unknown } } | null)?.roster?.owner;
	return typeof owner === 'string' && HEX64.test(owner) ? owner : null;
}

export interface ProjectRoster {
	owner: string;
	/** Everyone on the roster, owner and agents included, deduplicated;
	 *  null when the reply carries no member list (never guess membership). */
	members: string[] | null;
	/** Null when this Continuum predates the membership signals. */
	teams: RosterTeams | null;
}

const hexList = (v: unknown, max = MAX_ROSTER) =>
	Array.isArray(v)
		? [...new Set(v.filter((x): x is string => typeof x === 'string' && HEX64.test(x)))].slice(
				0,
				max
			)
		: [];

export function parseRosterTeams(raw: unknown): RosterTeams | null {
	if (!raw || typeof raw !== 'object') return null;
	const t = raw as { chat?: unknown; ready?: unknown; added?: unknown };
	const chat = (t.chat && typeof t.chat === 'object' ? t.chat : null) as {
		group_id?: unknown;
		claimed?: unknown;
	} | null;
	const gid =
		typeof chat?.group_id === 'string' && GROUP_ID_RE.test(chat.group_id) ? chat.group_id : null;
	return {
		chatGroupId: gid,
		claimed: chat?.claimed === true,
		ready: hexList(t.ready),
		added: hexList(t.added)
	};
}

const MAX_ROSTER = 64;

/** The roster (owner + member pubkeys), or null when it has no valid owner. */
export function parseRoster(raw: unknown): ProjectRoster | null {
	const owner = parseRosterOwner(raw);
	if (!owner) return null;
	const list = (raw as { roster: { members?: unknown } }).roster.members;
	const teams = parseRosterTeams((raw as { teams?: unknown }).teams);
	if (!Array.isArray(list)) return { owner, members: null, teams };
	const members = new Set<string>([owner]);
	for (const m of list.slice(0, MAX_ROSTER)) {
		const pk = (m as { pubkey?: unknown } | null)?.pubkey;
		if (typeof pk === 'string' && HEX64.test(pk)) members.add(pk);
	}
	return { owner, members: [...members], teams };
}

export class ContinuumClient {
	private session: ContinuumSession | null = null;

	constructor(
		readonly origin: string,
		private readonly deps: {
			fetch: typeof fetch;
			storage: StorageLike;
			now?: () => number;
		}
	) {
		this.session = this.load();
	}

	private now() {
		return (this.deps.now ?? (() => Math.floor(Date.now() / 1000)))();
	}

	private load(): ContinuumSession | null {
		try {
			const raw = this.deps.storage.getItem(sessionKey(this.origin));
			if (!raw) return null;
			const s = JSON.parse(raw) as ContinuumSession;
			if (!TOKEN_RE.test(s.token) || !HEX64.test(s.pubkey)) return null;
			return s.expiresAt > this.now() + 30 ? s : null;
		} catch {
			return null;
		}
	}

	/** A stored session for this pubkey that has not expired. */
	hasSession(pubkey: string): boolean {
		return Boolean(
			this.session && this.session.pubkey === pubkey && this.session.expiresAt > this.now() + 30
		);
	}

	signOut(): void {
		this.session = null;
		this.deps.storage.removeItem(sessionKey(this.origin));
	}

	async signIn(signer: SignerLike, pubkey: string): Promise<void> {
		const ch = (await call(this.deps.fetch, `${this.origin}/api/auth/challenge`, {
			method: 'POST',
			body: '{}'
		})) as { challenge?: unknown };
		if (typeof ch?.challenge !== 'string' || !/^[0-9a-f]{16,128}$/.test(ch.challenge)) {
			throw new ContinuumError(0, null, 'bad challenge from Continuum');
		}
		const event = await signer.signEvent({
			kind: 22242,
			created_at: this.now(),
			tags: [['challenge', ch.challenge]],
			content: ch.challenge
		});
		if (event.pubkey !== pubkey) throw new ContinuumError(0, null, 'signer returned another key');
		const res = (await call(this.deps.fetch, `${this.origin}/api/team/auth/verify`, {
			method: 'POST',
			body: JSON.stringify({ event })
		})) as { token?: unknown; expires_at?: unknown };
		if (typeof res?.token !== 'string' || !TOKEN_RE.test(res.token)) {
			throw new ContinuumError(0, null, 'bad token from Continuum');
		}
		const expiresAt = typeof res.expires_at === 'number' ? res.expires_at : this.now() + 3600;
		this.session = { token: res.token, expiresAt, pubkey };
		this.deps.storage.setItem(sessionKey(this.origin), JSON.stringify(this.session));
	}

	private async authed(
		path: string,
		init: { method?: string; body?: unknown; maxBody?: number } = {}
	): Promise<unknown> {
		if (!this.session) throw new ContinuumError(401, null, 'not signed in');
		try {
			return await call(this.deps.fetch, `${this.origin}${path}`, {
				token: this.session.token,
				method: init.method,
				body: init.body === undefined ? undefined : JSON.stringify(init.body),
				maxBody: init.maxBody
			});
		} catch (error) {
			if (error instanceof ContinuumError && error.status === 401) this.signOut();
			throw error;
		}
	}

	async me(): Promise<TeamMe> {
		const me = parseTeamMe(await this.authed('/api/team/me'));
		if (!me) throw new ContinuumError(0, null, 'bad /api/team/me reply');
		if (this.session && me.pubkey !== this.session.pubkey) {
			this.signOut();
			throw new ContinuumError(401, null, 'session belongs to another key');
		}
		return me;
	}

	/** Project owner pubkey; null when the roster is unreadable (fail closed). */
	async rosterOwner(slug: string): Promise<string | null> {
		return (await this.roster(slug))?.owner ?? null;
	}

	/** Tell Continuum our key packages are on the node coordinator (ADR 0006). */
	async markReady(): Promise<void> {
		await this.authed('/api/team/ready', { method: 'POST', body: {} });
	}

	/**
	 * Owner: claim, set or release the project's chat record. A 409 arrives as
	 * a ContinuumError with code 'claimed' or 'exists'.
	 */
	async chatOp(slug: string, op: 'claim' | 'set' | 'release', groupId?: string): Promise<void> {
		if (!SLUG_RE.test(slug)) throw new ContinuumError(0, null, 'bad slug');
		if (op === 'set' && !(groupId && GROUP_ID_RE.test(groupId))) {
			throw new ContinuumError(0, null, 'bad group id');
		}
		await this.authed(`/api/projects/${slug}/teams/chat`, {
			method: 'POST',
			body: op === 'set' ? { op, group_id: groupId } : { op }
		});
	}

	/** Owner: record who the owner's client added to or removed from the chat. */
	async markMembers(slug: string, added: string[], removed: string[]): Promise<void> {
		if (!SLUG_RE.test(slug)) throw new ContinuumError(0, null, 'bad slug');
		await this.authed(`/api/projects/${slug}/teams/members`, {
			method: 'POST',
			body: { added: hexList(added), removed: hexList(removed) }
		});
	}

	/** Signed kind-0 events for up to 50 pubkeys, unmodified (the EventStore verifies them). */
	async profiles(pubkeys: string[]): Promise<Record<string, NostrEvent | null>> {
		const list = hexList(pubkeys, 50);
		if (list.length === 0) return {};
		const raw = (await this.authed(`/api/team/profiles?p=${list.join(',')}`, {
			maxBody: MAX_PROFILES_BODY
		})) as { profiles?: Record<string, { event?: unknown }> } | null;
		const out: Record<string, NostrEvent | null> = {};
		for (const pk of list) {
			const ev = raw?.profiles?.[pk]?.event as NostrEvent | undefined;
			out[pk] = ev && ev.kind === 0 && ev.pubkey === pk ? ev : null;
		}
		return out;
	}

	/** Avatar bytes for a pubkey (raster images only), or null. */
	async avatar(pubkey: string): Promise<Blob | null> {
		if (!this.session || !HEX64.test(pubkey)) return null;
		try {
			const res = await this.deps.fetch(`${this.origin}/api/team/avatar/${pubkey}`, {
				headers: { authorization: `Bearer ${this.session.token}` },
				credentials: 'omit',
				redirect: 'error'
			});
			if (!res.ok) return null;
			const blob = await res.blob();
			return blob.size <= MAX_AVATAR_BYTES && /^image\/(jpeg|png|gif|webp)$/.test(blob.type)
				? blob
				: null;
		} catch {
			return null;
		}
	}

	/** Project roster; null when it is unreadable (fail closed). */
	async roster(slug: string): Promise<ProjectRoster | null> {
		if (!SLUG_RE.test(slug)) return null;
		try {
			return parseRoster(await this.authed(`/api/projects/${slug}/roster`));
		} catch (error) {
			if (error instanceof ContinuumError && error.status === 401) throw error;
			return null;
		}
	}
}

// ── Project ↔ Cordn group mapping (until Continuum projects groups, 2a-4) ──
// A project's chat is a Cordn group that (1) runs on this node's coordinator,
// (2) has the project owner as an admin, and (3) carries the marker in its
// description. Anything else is not shown: a look-alike group fails closed.

export const projectMarker = (slug: string) => `torii:project=${slug}`;

export interface GroupLike {
	id: string;
	coordinatorKey: string;
	description?: string;
	adminPubkeys: string[] | null; // null = every member is an admin
	memberPubkeys: string[];
	status?: string;
}

export function matchProjectGroup(
	slug: string,
	ownerPubkey: string | null,
	nodeCoordinator: string,
	groups: GroupLike[],
	/** The chat the owner recorded in Continuum (ADR 0006); settles look-alikes. */
	recordedId: string | null = null
): GroupLike | null {
	if (!ownerPubkey) return null;
	const marker = projectMarker(slug);
	const hits = groups.filter(
		(g) =>
			g.status !== 'removed' &&
			g.status !== 'poisoned' &&
			g.coordinatorKey === nodeCoordinator &&
			(g.description ?? '').split(/\s+/).includes(marker) &&
			g.memberPubkeys.includes(ownerPubkey) &&
			(g.adminPubkeys === null || g.adminPubkeys.includes(ownerPubkey))
	);
	if (recordedId) {
		const recorded = hits.find((g) => g.id === recordedId);
		if (recorded) return recorded;
	}
	// Two candidates means someone made a look-alike; show neither until resolved.
	return hits.length === 1 ? hits[0] : null;
}
