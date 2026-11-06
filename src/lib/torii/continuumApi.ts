// Torii Teams: member sign-in to this node's Continuum and the caller's
// projects (TEAMS-2a slice 2). Continuum's contract, docs/adr-team-collaboration.md:
//   POST /api/auth/challenge {}            -> {challenge, expires_in, kind: 22242}
//   sign kind 22242 {content: challenge, tags: [["challenge", challenge]]}
//   POST /api/team/auth/verify {event}     -> {token: "m2....", expires_at}
//   POST /api/team/auth/refresh (Bearer)   -> {token, expires_at}; 403 not_member,
//                                             401 expired / max_lifetime_reached (ADR 0008)
//   GET  /api/team/me (Bearer)             -> {pubkey, owner, projects, teams_app_url}
//   GET  /api/projects/:slug/roster        -> {roster: {owner, members...}, role, teams}
// Membership signals and profiles (ADR 0006, Continuum adr-teams-membership-signals):
//   POST /api/team/ready                   -> caller's key packages are on the node coordinator
//   POST /api/projects/:slug/teams/chat    {op: claim|set|release, group_id}  (owner)
//   POST /api/projects/:slug/teams/members {added, removed}                    (owner)
//   GET  /api/team/profiles?p=hex,…        -> {profiles: {hex: {event}}}
//   GET  /api/team/avatar/:hex             -> image bytes
// Invite links (ADR 0009):
//   POST /api/team/invite/peek  {id, secret}        -> {kind, project_name, owner_name}
//   POST /api/team/invite/claim {id, secret, event} -> {token: m2, slug} | {pending, token: j1}
//   POST /api/team/auth/refresh (Bearer j1)         -> m2 once let in; 409 pending, 403 refused
//   POST /api/team/ready (Bearer j1)                -> allowed while waiting
//   Every link failure is the same 404 {code: 'invite_unavailable'}.
// Bearer only, no cookies. One sign-in (ADR 0008): the token lives in this
// origin's localStorage and renews without the signer until Continuum's
// absolute cap (7 days by default); only then is a new challenge signed.
// The owner signs in through the same member route, or receives the same
// scoped token from the Continuum Team view that frames us (handoff): the
// owner's admin token never lives on this origin (ADR 0002).

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
	/** When this client stored the token; sets the renewal point. */
	issuedAt: number;
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
const TOKEN_RE = /^m[12]\.[A-Za-z0-9._-]{10,512}$/;
const PENDING_RE = /^j1\.[A-Za-z0-9._-]{10,512}$/;
export const INVITE_ID_RE = /^[A-Za-z0-9_-]{16}$/;
export const INVITE_SECRET_RE = /^[A-Za-z0-9_-]{22}$/;
const NAME_MAX = 80;
/** Renew once less than this share of the token's life is left (ADR 0008). */
export const RENEW_AT_REMAINING = 0.25;
const MAX_PROJECTS = 200;
const MAX_BODY = 64 * 1024;
const MAX_PROFILES_BODY = 1024 * 1024;
const MAX_AVATAR_BYTES = 512 * 1024;
const GROUP_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

const sessionKey = (origin: string) => `torii.continuumSession:${origin}`;
const pendingKey = (origin: string) => `torii.continuumPending:${origin}`;

/** A link someone sent us: `/chat/join/<id>#<secret>` (ADR 0009). */
export interface InviteLink {
	id: string;
	secret: string;
}

/** What the link says before sign-in: display names only. */
export interface InvitePeek {
	kind: 'open' | 'named';
	projectName: string;
	ownerName: string;
}

/** Waiting for the owner to let us in (open link, ADR 0009). */
export interface PendingInvite {
	token: string;
	expiresAt: number;
	pubkey: string;
	projectName: string;
	ownerName: string;
}

export type ClaimResult = { state: 'in'; slug: string | null } | { state: 'waiting' };
export type WaitState = 'in' | 'waiting' | 'refused' | 'offline';

export const INVITE_GONE = 'This invite no longer works. Ask for a new one.';

const cleanName = (v: unknown) =>
	typeof v === 'string'
		? [...v]
				.filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127)
				.join('')
				.trim()
				.slice(0, NAME_MAX)
		: '';

/**
 * Read a link from the address bar: the id from the path, the secret from the
 * fragment (never sent to any server). Null when it is not an invite link.
 */
export function parseInviteLink(pathname: string, hash: string): InviteLink | null {
	const m = pathname.match(/^\/chat\/join\/([A-Za-z0-9_-]{16})\/?$/);
	const secret = hash.replace(/^#/, '');
	if (!m || !INVITE_SECRET_RE.test(secret)) return null;
	return { id: m[1], secret };
}

export function parseInvitePeek(raw: unknown): InvitePeek | null {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	if (r.kind !== 'open' && r.kind !== 'named') return null;
	return {
		kind: r.kind,
		projectName: cleanName(r.project_name),
		ownerName: cleanName(r.owner_name)
	};
}

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

/** The source and origin checks for a `torii:session` message (pubkey: adopt). */
export function acceptsHandoff(
	e: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
	parent: unknown,
	continuumOrigin: string
): boolean {
	const data = e.data as { type?: unknown } | null;
	return e.source === parent && e.origin === continuumOrigin && data?.type === 'torii:session';
}

export class ContinuumClient {
	private session: ContinuumSession | null = null;

	private pending: PendingInvite | null = null;

	constructor(
		readonly origin: string,
		private readonly deps: {
			fetch: typeof fetch;
			storage: StorageLike;
			now?: () => number;
		}
	) {
		this.session = this.load();
		this.pending = this.loadPending();
	}

	private loadPending(): PendingInvite | null {
		let p: PendingInvite | null;
		try {
			const raw = this.deps.storage.getItem(pendingKey(this.origin));
			p = raw ? (JSON.parse(raw) as PendingInvite) : null;
		} catch {
			p = null;
		}
		const ok =
			p &&
			typeof p.token === 'string' &&
			PENDING_RE.test(p.token) &&
			typeof p.pubkey === 'string' &&
			HEX64.test(p.pubkey) &&
			Number.isFinite(p.expiresAt) &&
			p.expiresAt > this.now();
		if (!ok) {
			this.deps.storage.removeItem(pendingKey(this.origin));
			return null;
		}
		return { ...p!, projectName: cleanName(p!.projectName), ownerName: cleanName(p!.ownerName) };
	}

	private clearPending(): void {
		this.pending = null;
		this.deps.storage.removeItem(pendingKey(this.origin));
	}

	/** Waiting on an open invite for this key (ADR 0009). */
	pendingFor(pubkey: string): PendingInvite | null {
		return this.pending && this.pending.pubkey === pubkey && this.pending.expiresAt > this.now()
			? this.pending
			: null;
	}

	private now() {
		return (this.deps.now ?? (() => Math.floor(Date.now() / 1000)))();
	}

	private load(): ContinuumSession | null {
		let s: ContinuumSession | null;
		try {
			const raw = this.deps.storage.getItem(sessionKey(this.origin));
			if (!raw) return null;
			s = JSON.parse(raw) as ContinuumSession;
		} catch {
			s = null;
		}
		const ok =
			s &&
			typeof s.token === 'string' &&
			TOKEN_RE.test(s.token) &&
			typeof s.pubkey === 'string' &&
			HEX64.test(s.pubkey) &&
			Number.isFinite(s.expiresAt) &&
			s.expiresAt > this.now() + 30;
		if (!ok) {
			// Expired or malformed: never leave a dead token in localStorage.
			this.deps.storage.removeItem(sessionKey(this.origin));
			return null;
		}
		return { ...s!, issuedAt: Number.isFinite(s!.issuedAt) ? s!.issuedAt : this.now() };
	}

	private store(token: unknown, expiresAt: unknown, pubkey: string): void {
		if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
			throw new ContinuumError(0, null, 'bad token from Continuum');
		}
		const now = this.now();
		const exp = typeof expiresAt === 'number' && expiresAt > now ? expiresAt : now + 3600;
		this.session = { token, expiresAt: exp, pubkey, issuedAt: now };
		this.deps.storage.setItem(sessionKey(this.origin), JSON.stringify(this.session));
	}

	/** A stored session for this pubkey that has not expired. */
	hasSession(pubkey: string): boolean {
		return Boolean(
			this.session && this.session.pubkey === pubkey && this.session.expiresAt > this.now() + 30
		);
	}

	/** A different key signed in: drop the old key's session (ADR 0008). */
	keepOnlyFor(pubkey: string): void {
		if (this.session && this.session.pubkey !== pubkey) this.signOut();
		if (this.pending && this.pending.pubkey !== pubkey) this.clearPending();
	}

	/** The live session token (node file server uploads, ADR 0007), or null. */
	bearer(): string | null {
		return this.session && this.session.expiresAt > this.now() + 30 ? this.session.token : null;
	}

	/** Time to renew: under a quarter of the token's life is left. */
	needsRenewal(): boolean {
		const s = this.session;
		if (!s) return false;
		const life = Math.max(1, s.expiresAt - s.issuedAt);
		return s.expiresAt - this.now() < life * RENEW_AT_REMAINING;
	}

	private renewing: Promise<boolean> | null = null;

	/**
	 * Renew the session without the signer (ADR 0008). True when a session is
	 * live afterwards. A refusal (removed from every roster, past the 7-day
	 * cap, expired) clears it so the next step is one fresh sign-in; a network
	 * error keeps it and the next load or focus tries again.
	 */
	renew(): Promise<boolean> {
		if (!this.session) return Promise.resolve(false);
		if (!this.needsRenewal()) return Promise.resolve(true);
		this.renewing ??= this.doRenew().finally(() => {
			this.renewing = null;
		});
		return this.renewing;
	}

	private async doRenew(): Promise<boolean> {
		const s = this.session!;
		try {
			const res = (await call(this.deps.fetch, `${this.origin}/api/team/auth/refresh`, {
				method: 'POST',
				token: s.token
			})) as { token?: unknown; expires_at?: unknown };
			if (this.session !== s) return Boolean(this.session); // signed out or replaced meanwhile
			this.store(res?.token, res?.expires_at, s.pubkey);
			return true;
		} catch (error) {
			if (error instanceof ContinuumError && (error.status === 401 || error.status === 403)) {
				if (this.session === s) this.signOut();
				return false;
			}
			return this.session !== null && this.session.expiresAt > this.now() + 30;
		}
	}

	/**
	 * A session handed over by the Continuum Team view (owner, ADR 0008). The
	 * caller has checked the message's source and origin; this checks the
	 * token shape and that it is for the signed-in key.
	 */
	adopt(raw: unknown, pubkey: string): boolean {
		const m = (raw && typeof raw === 'object' ? raw : {}) as {
			token?: unknown;
			expires_at?: unknown;
			pubkey?: unknown;
		};
		if (m.pubkey !== pubkey || !HEX64.test(pubkey)) return false;
		if (typeof m.expires_at !== 'number' || m.expires_at <= this.now() + 30) return false;
		try {
			this.store(m.token, m.expires_at, pubkey);
			return true;
		} catch {
			return false;
		}
	}

	signOut(): void {
		this.session = null;
		this.deps.storage.removeItem(sessionKey(this.origin));
		this.clearPending();
	}

	/** Who sent the link and for what; null when the link no longer works. */
	async peekInvite(link: InviteLink): Promise<InvitePeek | null> {
		try {
			return parseInvitePeek(
				await call(this.deps.fetch, `${this.origin}/api/team/invite/peek`, {
					method: 'POST',
					body: JSON.stringify({ id: link.id, secret: link.secret })
				})
			);
		} catch (error) {
			if (error instanceof ContinuumError && error.status === 404) return null;
			throw error;
		}
	}

	/**
	 * Use a link: the same one signer prompt as sign-in. A named link (or one
	 * for a project we are already on) signs straight in; an open link leaves
	 * us waiting for the owner. A dead link throws code 'invite_unavailable'.
	 */
	async claimInvite(
		signer: SignerLike,
		pubkey: string,
		link: InviteLink,
		names: { projectName: string; ownerName: string }
	): Promise<ClaimResult> {
		const event = await this.signChallenge(signer, pubkey);
		const res = (await call(this.deps.fetch, `${this.origin}/api/team/invite/claim`, {
			method: 'POST',
			body: JSON.stringify({ id: link.id, secret: link.secret, event })
		})) as { token?: unknown; expires_at?: unknown; pending?: unknown; slug?: unknown };
		if (res?.pending === true) {
			if (typeof res.token !== 'string' || !PENDING_RE.test(res.token)) {
				throw new ContinuumError(0, null, 'bad token from Continuum');
			}
			const exp =
				typeof res.expires_at === 'number' && res.expires_at > this.now()
					? res.expires_at
					: this.now() + 86400;
			this.pending = {
				token: res.token,
				expiresAt: exp,
				pubkey,
				projectName: cleanName(names.projectName),
				ownerName: cleanName(names.ownerName)
			};
			this.deps.storage.setItem(pendingKey(this.origin), JSON.stringify(this.pending));
			return { state: 'waiting' };
		}
		this.store(res?.token, res?.expires_at, pubkey);
		this.clearPending();
		return {
			state: 'in',
			slug: typeof res?.slug === 'string' && SLUG_RE.test(res.slug) ? res.slug : null
		};
	}

	/**
	 * While waiting: ask whether the owner let us in. No signer: the waiting
	 * token is swapped for a member session once the roster lists us.
	 */
	async checkWaiting(): Promise<WaitState> {
		const p = this.pending;
		if (!p) return 'refused';
		try {
			const res = (await call(this.deps.fetch, `${this.origin}/api/team/auth/refresh`, {
				method: 'POST',
				token: p.token
			})) as { token?: unknown; expires_at?: unknown };
			if (this.pending !== p) return this.session ? 'in' : 'refused';
			this.store(res?.token, res?.expires_at, p.pubkey);
			this.clearPending();
			return 'in';
		} catch (error) {
			if (error instanceof ContinuumError && error.status === 409) return 'waiting';
			if (error instanceof ContinuumError && (error.status === 401 || error.status === 403)) {
				if (this.pending === p) this.clearPending();
				return 'refused';
			}
			return 'offline';
		}
	}

	/** While waiting: our key packages are on the node coordinator (ADR 0006). */
	async markReadyWaiting(): Promise<void> {
		if (!this.pending) throw new ContinuumError(401, null, 'not waiting');
		await call(this.deps.fetch, `${this.origin}/api/team/ready`, {
			method: 'POST',
			body: '{}',
			token: this.pending.token
		});
	}

	/** The one place the user's signer signs for Continuum (kind 22242). */
	private async signChallenge(signer: SignerLike, pubkey: string): Promise<NostrEvent> {
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
		return event;
	}

	async signIn(signer: SignerLike, pubkey: string): Promise<void> {
		const event = await this.signChallenge(signer, pubkey);
		const res = (await call(this.deps.fetch, `${this.origin}/api/team/auth/verify`, {
			method: 'POST',
			body: JSON.stringify({ event })
		})) as { token?: unknown; expires_at?: unknown };
		this.store(res?.token, res?.expires_at, pubkey);
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
