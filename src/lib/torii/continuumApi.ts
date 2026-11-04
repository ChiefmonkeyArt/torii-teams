// Torii Teams: member sign-in to this node's Continuum and the caller's
// projects (TEAMS-2a slice 2). Continuum's contract, docs/adr-team-collaboration.md:
//   POST /api/auth/challenge {}            -> {challenge, expires_in, kind: 22242}
//   sign kind 22242 {content: challenge, tags: [["challenge", challenge]]}
//   POST /api/team/auth/verify {event}     -> {token: "m1....", expires_at}
//   GET  /api/team/me (Bearer)             -> {pubkey, owner, projects, teams_app_url}
//   GET  /api/projects/:slug/roster        -> {roster: {owner, members...}, role}
// Bearer only, no cookies, no refresh: a 401 means sign a new challenge.
// The owner signs in through the same member route and gets the same scoped
// token: the owner's admin token never lives on this origin (ADR 0002).

import type { EventTemplate, NostrEvent } from 'nostr-tools';

export interface TeamProject {
	slug: string;
	role: string;
	caps: string[];
}

export interface TeamMe {
	pubkey: string;
	owner: boolean;
	projects: TeamProject[];
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

const sessionKey = (origin: string) => `torii.continuumSession:${origin}`;

async function readJson(res: Response): Promise<unknown> {
	const text = await res.text();
	if (text.length > MAX_BODY) throw new ContinuumError(res.status, null, 'response too large');
	try {
		return text ? JSON.parse(text) : null;
	} catch {
		throw new ContinuumError(res.status, null, 'bad JSON from Continuum');
	}
}

async function call(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit & { token?: string } = {}
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
	const body = await readJson(res);
	if (!res.ok) {
		const code =
			body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
				? (body as { code: string }).code
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
		projects.push({
			slug,
			role: role.slice(0, 32),
			caps: Array.isArray(caps)
				? caps.filter((c): c is string => typeof c === 'string').slice(0, 32)
				: []
		});
	}
	return { pubkey: r.pubkey, owner: r.owner === true, projects };
}

/** The roster owner's pubkey, or null if the reply is not what we expect. */
export function parseRosterOwner(raw: unknown): string | null {
	const owner = (raw as { roster?: { owner?: unknown } } | null)?.roster?.owner;
	return typeof owner === 'string' && HEX64.test(owner) ? owner : null;
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

	private async authed(path: string): Promise<unknown> {
		if (!this.session) throw new ContinuumError(401, null, 'not signed in');
		try {
			return await call(this.deps.fetch, `${this.origin}${path}`, { token: this.session.token });
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
		if (!SLUG_RE.test(slug)) return null;
		try {
			return parseRosterOwner(await this.authed(`/api/projects/${slug}/roster`));
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
	groups: GroupLike[]
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
	// Two candidates means someone made a look-alike; show neither until resolved.
	return hits.length === 1 ? hits[0] : null;
}
