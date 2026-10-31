/**
 * Torii Teams actions — chat that turns into work (Torii TEAMS-JOBS J1).
 *
 * An action is a todo, decision, question or code task made from one or more
 * chat messages by a person. It lives in the group itself as an append-only
 * log of small operations, each an ordinary MLS application message (an
 * unsigned event envelope, like polls). Every member folds the same log in
 * coordinator-cursor order, so everyone sees the same list with no server
 * database. Design: torii-continuum `docs/adr-team-jobs.md` §2–§3, §2a.
 *
 * Operations (kind `ChatKinds.Action`, `op` tag):
 *   create   content = title; `type`, 1..MAX_SOURCES `q` (source message ids),
 *            optional `p` (owner) and `due` (unix seconds). Action id = the
 *            create message's id.
 *   update   `e` = action id; any of: content (new title), `type`, `p`
 *            (owner; empty value = unassigned), `due` (empty value = none).
 *   status   `e` = action id; `status` = open | in_progress | done | dropped.
 *   promote  `e` = action id; marks a `code` action as a job candidate (J3
 *            writes the job spec). Owner or maintainer only.
 *
 * Trust rules (all fail closed, per operation):
 *   • the sender's role comes from a resolver (Torii roster, or group admins);
 *     unknown senders and agents (clankers) cannot write actions in J1 — the
 *     scribe only ever suggests (J2), a person moves every stage;
 *   • create needs contributor or above; update/status need the creator, the
 *     current owner, or maintainer and above; promote needs maintainer+;
 *   • strict shapes and byte limits; unknown extension tags are ignored;
 *   • ops for unknown actions, duplicate creates and malformed ops are
 *     dropped, never "repaired".
 * Ordering is the coordinator cursor, which Cordn makes authoritative; the
 * sender-minted `created_at` is never used to order.
 */
import { safeNormalizePubKey } from '$lib/utils';
import { ChatKinds } from '$lib/chat/kinds';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';

export const ACTION_TYPES = ['todo', 'decision', 'question', 'code'] as const;
export const ACTION_STATUSES = ['open', 'in_progress', 'done', 'dropped'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ActionOpName = 'create' | 'update' | 'status' | 'promote';

export const ACTION_MAX_TITLE_BYTES = 280;
export const ACTION_MAX_SOURCES = 20;
export const ACTION_MAX_TAGS = 32;
/** Bound receive-side work per group. */
export const ACTION_MAX_PER_GROUP = 5000;
const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type ActionRole = 'owner' | 'maintainer' | 'contributor' | 'viewer';
export interface ResolvedRole {
	role: ActionRole;
	/** Clankers (roster `agent` entries). Never write actions in J1. */
	agent: boolean;
}
export type RoleResolver = (pubkey: string) => ResolvedRole | null;

const RANK: Record<ActionRole, number> = { viewer: 1, contributor: 2, maintainer: 3, owner: 4 };

/**
 * Torii roster resolver (kind 30098, see torii-continuum agent/lib/roster.mjs).
 * Agents get min(their human's role, contributor) and are flagged `agent`.
 */
export function createRosterRoleResolver(roster: {
	members: Array<{ pubkey: string; role: string; of?: string }>;
}): RoleResolver {
	const byKey = new Map(roster.members.map((m) => [m.pubkey, m]));
	return (pubkey) => {
		const m = byKey.get(pubkey);
		if (!m) return null;
		if (m.role === 'agent') {
			const human = m.of ? byKey.get(m.of) : undefined;
			if (!human || human.role === 'agent' || !(human.role in RANK)) return null;
			const role = RANK[human.role as ActionRole] >= RANK.contributor ? 'contributor' : 'viewer';
			return { role, agent: true };
		}
		return m.role in RANK ? { role: m.role as ActionRole, agent: false } : null;
	};
}

/**
 * Standalone fallback (no Torii roster): group admins act as maintainers,
 * other current members as contributors.
 */
export function createGroupRoleResolver(admins: string[], members: string[]): RoleResolver {
	const adminSet = new Set(admins.map((p) => safeNormalizePubKey(p)).filter(Boolean));
	const memberSet = new Set(members.map((p) => safeNormalizePubKey(p)).filter(Boolean));
	return (pubkey) => {
		if (adminSet.has(pubkey)) return { role: 'maintainer', agent: false };
		if (memberSet.has(pubkey)) return { role: 'contributor', agent: false };
		return null;
	};
}

// ---------------------------------------------------------------------------
// Text hygiene (same rules as poll labels: titles are a spoofing surface)
// ---------------------------------------------------------------------------

function byteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}
const BIDI_CHARS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
function hasControlChars(value: string): boolean {
	return [...value].some((char) => {
		const code = char.codePointAt(0) ?? 0;
		return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
	});
}
function isValidTitle(value: string): boolean {
	const trimmed = value.trim();
	return (
		trimmed.length > 0 &&
		trimmed === value &&
		byteLength(value) <= ACTION_MAX_TITLE_BYTES &&
		!hasControlChars(value) &&
		!BIDI_CHARS.test(value)
	);
}

/** Make a pre-filled title from message text: first line, collapsed, clipped. */
export function titleFromMessage(text: string): string {
	const firstLine = (text.split('\n').find((line) => line.trim()) ?? '').replace(/\s+/g, ' ');
	let clean = [...firstLine]
		.filter((char) => !hasControlChars(char) && !BIDI_CHARS.test(char))
		.join('')
		.trim();
	while (byteLength(clean) > ACTION_MAX_TITLE_BYTES) clean = [...clean].slice(0, -1).join('');
	return clean.trim();
}

const isType = (v: unknown): v is ActionType => ACTION_TYPES.includes(v as ActionType);
const isStatus = (v: unknown): v is ActionStatus => ACTION_STATUSES.includes(v as ActionStatus);
const isDue = (v: string) => /^[1-9][0-9]{0,11}$/.test(v);

// ---------------------------------------------------------------------------
// Send side
// ---------------------------------------------------------------------------

export interface ActionDraft {
	title: string;
	type: ActionType;
	/** Source message ids (the messages the action was made from). */
	sources: string[];
	owner?: string | null;
	/** Unix seconds. */
	due?: number | null;
}

export function validateActionDraft(draft: ActionDraft): string | null {
	if (!isValidTitle(draft.title)) return 'Title is required (max 280 bytes, no control characters)';
	if (!isType(draft.type)) return 'Unknown action type';
	if (draft.sources.length < 1 || draft.sources.length > ACTION_MAX_SOURCES) {
		return `Pick between 1 and ${ACTION_MAX_SOURCES} messages`;
	}
	if (new Set(draft.sources).size !== draft.sources.length) return 'Duplicate source message';
	if (draft.sources.some((id) => !HEX64.test(id))) return 'Bad source message id';
	if (draft.owner && !HEX64.test(draft.owner)) return 'Owner must be a member pubkey';
	if (draft.due != null && (!Number.isInteger(draft.due) || draft.due <= 0)) return 'Bad due date';
	return null;
}

/** Tags for a `create` op; content is the title. Throws on invalid drafts. */
export function createActionTags(draft: ActionDraft): string[][] {
	const error = validateActionDraft(draft);
	if (error) throw new Error(error);
	const tags: string[][] = [
		['op', 'create'],
		['type', draft.type]
	];
	for (const id of draft.sources) tags.push(['q', id]);
	if (draft.owner) tags.push(['p', draft.owner]);
	if (draft.due != null) tags.push(['due', String(draft.due)]);
	tags.push(['alt', `Action: ${draft.title}`]);
	return tags;
}

export interface ActionPatch {
	title?: string;
	type?: ActionType;
	owner?: string | null;
	due?: number | null;
}

/** Tags + content for an `update` op. Only fields present in the patch change. */
export function updateActionMessage(
	actionId: string,
	patch: ActionPatch
): { content: string; tags: string[][] } {
	if (!HEX64.test(actionId)) throw new Error('Bad action id');
	const tags: string[][] = [
		['op', 'update'],
		['e', actionId]
	];
	if (patch.title !== undefined && !isValidTitle(patch.title)) throw new Error('Bad title');
	if (patch.type !== undefined) {
		if (!isType(patch.type)) throw new Error('Unknown action type');
		tags.push(['type', patch.type]);
	}
	if (patch.owner !== undefined) {
		if (patch.owner && !HEX64.test(patch.owner)) throw new Error('Bad owner');
		tags.push(['p', patch.owner ?? '']);
	}
	if (patch.due !== undefined) {
		if (patch.due !== null && (!Number.isInteger(patch.due) || patch.due <= 0)) {
			throw new Error('Bad due date');
		}
		tags.push(['due', patch.due === null ? '' : String(patch.due)]);
	}
	if (tags.length === 2 && patch.title === undefined) throw new Error('Nothing to update');
	tags.push(['alt', 'Action updated']);
	return { content: patch.title ?? '', tags };
}

export function statusActionTags(actionId: string, status: ActionStatus): string[][] {
	if (!HEX64.test(actionId) || !isStatus(status)) throw new Error('Bad status op');
	return [
		['op', 'status'],
		['e', actionId],
		['status', status],
		['alt', `Action ${status}`]
	];
}

export function promoteActionTags(actionId: string): string[][] {
	if (!HEX64.test(actionId)) throw new Error('Bad action id');
	return [
		['op', 'promote'],
		['e', actionId],
		['alt', 'Action promoted to a job']
	];
}

// ---------------------------------------------------------------------------
// Receive side
// ---------------------------------------------------------------------------

export type ParsedActionOp =
	| {
			op: 'create';
			title: string;
			type: ActionType;
			sources: string[];
			owner: string | null;
			due: number | null;
	  }
	| {
			op: 'update';
			target: string;
			title?: string;
			type?: ActionType;
			owner?: string | null;
			due?: number | null;
	  }
	| { op: 'status'; target: string; status: ActionStatus }
	| { op: 'promote'; target: string };

function single(tags: string[][], name: string): string[] | null | false {
	const found = tags.filter((t) => t[0] === name);
	if (found.length > 1) return false; // duplicates are malformed
	return found[0] ?? null;
}

/** Strict parser. Returns null for anything that is not a well-formed op. */
export function parseActionOp(
	kind: number,
	content: string,
	tags: string[][]
): ParsedActionOp | null {
	if (kind !== ChatKinds.Action || !Array.isArray(tags) || tags.length > ACTION_MAX_TAGS)
		return null;
	const opTag = single(tags, 'op');
	if (!opTag || opTag.length !== 2) return null;
	const op = opTag[1];

	const typeTag = single(tags, 'type');
	const pTag = single(tags, 'p');
	const dueTag = single(tags, 'due');
	if (typeTag === false || pTag === false || dueTag === false) return null;

	if (op === 'create') {
		if (!typeTag || !isType(typeTag[1]) || !isValidTitle(content)) return null;
		const sources = tags.filter((t) => t[0] === 'q').map((t) => t[1]);
		if (sources.length < 1 || sources.length > ACTION_MAX_SOURCES) return null;
		if (sources.some((id) => !HEX64.test(String(id))) || new Set(sources).size !== sources.length) {
			return null;
		}
		if (pTag && !HEX64.test(String(pTag[1]))) return null;
		if (dueTag && !isDue(String(dueTag[1]))) return null;
		return {
			op,
			title: content,
			type: typeTag[1],
			sources,
			owner: pTag ? pTag[1] : null,
			due: dueTag ? Number(dueTag[1]) : null
		};
	}

	const eTag = single(tags, 'e');
	if (!eTag || !HEX64.test(String(eTag[1]))) return null;
	const target = eTag[1];

	if (op === 'update') {
		const out: Extract<ParsedActionOp, { op: 'update' }> = { op, target };
		if (content !== '') {
			if (!isValidTitle(content)) return null;
			out.title = content;
		}
		if (typeTag) {
			if (!isType(typeTag[1])) return null;
			out.type = typeTag[1];
		}
		if (pTag) {
			if (pTag[1] !== '' && !HEX64.test(String(pTag[1]))) return null;
			out.owner = pTag[1] || null;
		}
		if (dueTag) {
			if (dueTag[1] !== '' && !isDue(String(dueTag[1]))) return null;
			out.due = dueTag[1] ? Number(dueTag[1]) : null;
		}
		if (Object.keys(out).length === 2) return null; // empty update
		return out;
	}
	if (op === 'status') {
		const s = single(tags, 'status');
		if (!s || !isStatus(s[1])) return null;
		return { op, target, status: s[1] };
	}
	if (op === 'promote') {
		if (content !== '') return null;
		return { op, target };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Fold
// ---------------------------------------------------------------------------

export interface ActionHistoryEntry {
	cursor: number;
	at: number;
	by: string;
	op: ActionOpName;
	status?: ActionStatus;
}

export interface Action {
	id: string;
	title: string;
	type: ActionType;
	status: ActionStatus;
	sources: string[];
	owner: string | null;
	due: number | null;
	createdBy: string;
	/** Coordinator time, unix milliseconds (StoredChatMessage.createdAt units). */
	createdAt: number;
	updatedAt: number;
	promoted: boolean;
	history: ActionHistoryEntry[];
}

export interface ActionRejection {
	cursor: number;
	id: string;
	reason: string;
}

export interface ActionState {
	/** Creation order (cursor). */
	actions: Action[];
	byId: Map<string, Action>;
	/** Source message id → action ids made from it (for message badges). */
	bySource: Map<string, string[]>;
	rejected: ActionRejection[];
}

function canWrite(r: ResolvedRole | null, min: ActionRole): boolean {
	return !!r && !r.agent && RANK[r.role] >= RANK[min];
}

/**
 * Fold a group's messages into the current action list. Pure and
 * deterministic: same messages + same resolver → same state on every device.
 */
export function foldActions(messages: StoredChatMessage[], roleOf: RoleResolver): ActionState {
	const ops = messages
		.filter((m) => m.kind === ChatKinds.Action)
		.sort((a, b) => a.cursor - b.cursor);
	const byId = new Map<string, Action>();
	const actions: Action[] = [];
	const rejected: ActionRejection[] = [];
	const reject = (m: StoredChatMessage, reason: string) =>
		rejected.push({ cursor: m.cursor, id: m.id, reason });

	for (const m of ops) {
		const sender = safeNormalizePubKey(m.sender);
		const op = parseActionOp(m.kind, m.content, m.tags);
		if (!op) {
			reject(m, 'malformed');
			continue;
		}
		const role = sender ? roleOf(sender) : null;

		if (op.op === 'create') {
			if (!canWrite(role, 'contributor')) {
				reject(m, 'not_allowed');
				continue;
			}
			if (!HEX64.test(m.id) || byId.has(m.id)) {
				reject(m, 'duplicate');
				continue;
			}
			if (actions.length >= ACTION_MAX_PER_GROUP) {
				reject(m, 'too_many');
				continue;
			}
			const action: Action = {
				id: m.id,
				title: op.title,
				type: op.type,
				status: 'open',
				sources: op.sources,
				owner: op.owner,
				due: op.due,
				createdBy: sender!,
				createdAt: m.createdAt,
				updatedAt: m.createdAt,
				promoted: false,
				history: [{ cursor: m.cursor, at: m.createdAt, by: sender!, op: 'create' }]
			};
			byId.set(action.id, action);
			actions.push(action);
			continue;
		}

		const action = byId.get(op.target);
		if (!action) {
			reject(m, 'unknown_action');
			continue;
		}
		const isMaintainer = canWrite(role, 'maintainer');
		const isStakeholder =
			canWrite(role, 'contributor') && (sender === action.createdBy || sender === action.owner);

		if (op.op === 'promote') {
			if (!isMaintainer) {
				reject(m, 'not_allowed');
				continue;
			}
			if (
				action.type !== 'code' ||
				action.promoted ||
				action.status === 'done' ||
				action.status === 'dropped'
			) {
				reject(m, 'not_promotable');
				continue;
			}
			action.promoted = true;
		} else {
			if (!isMaintainer && !isStakeholder) {
				reject(m, 'not_allowed');
				continue;
			}
			if (op.op === 'status') {
				action.status = op.status;
			} else {
				if (op.title !== undefined) action.title = op.title;
				if (op.type !== undefined) {
					if (action.promoted && op.type !== 'code') {
						reject(m, 'promoted_is_code');
						continue;
					}
					action.type = op.type;
				}
				if (op.owner !== undefined) action.owner = op.owner;
				if (op.due !== undefined) action.due = op.due;
			}
		}
		action.updatedAt = m.createdAt;
		action.history.push({
			cursor: m.cursor,
			at: m.createdAt,
			by: sender!,
			op: op.op,
			...(op.op === 'status' ? { status: op.status } : {})
		});
	}

	const bySource = new Map<string, string[]>();
	for (const a of actions) {
		for (const s of a.sources) bySource.set(s, [...(bySource.get(s) ?? []), a.id]);
	}
	return { actions, byId, bySource, rejected };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ActionPanelGroups {
	open: Action[];
	inProgress: Action[];
	jobs: Action[];
	done: Action[];
}

/** Right-panel sections. Promoted, unfinished actions show under Jobs. */
export function groupForPanel(state: ActionState): ActionPanelGroups {
	const out: ActionPanelGroups = { open: [], inProgress: [], jobs: [], done: [] };
	for (const a of state.actions) {
		if (a.status === 'done' || a.status === 'dropped') out.done.push(a);
		else if (a.promoted) out.jobs.push(a);
		else if (a.status === 'in_progress') out.inProgress.push(a);
		else out.open.push(a);
	}
	return out;
}

/** The decision log: every decision, newest first. */
export function decisionLog(state: ActionState): Action[] {
	return state.actions
		.filter((a) => a.type === 'decision')
		.sort((a, b) => b.createdAt - a.createdAt);
}

/** Badge for a source message: the most recently updated action made from it. */
export function badgeForMessage(
	state: ActionState,
	messageId: string
): { actionId: string; status: ActionStatus; count: number } | null {
	const ids = state.bySource.get(messageId);
	if (!ids?.length) return null;
	const latest = ids.map((id) => state.byId.get(id)!).sort((a, b) => b.updatedAt - a.updatedAt)[0];
	return { actionId: latest.id, status: latest.status, count: ids.length };
}

export interface ActionStatusLine {
	/** Place the line at this cursor in the stream. */
	cursor: number;
	at: number;
	actionId: string;
	by: string;
	text: string;
}

/**
 * One-line notes drawn locally in the stream when an action is created,
 * finished or promoted. Never posted as messages (the scribe still never
 * speaks unless addressed); derived from the log, so every device agrees.
 */
export function statusLines(state: ActionState): ActionStatusLine[] {
	const lines: ActionStatusLine[] = [];
	for (const a of state.actions) {
		for (const h of a.history) {
			let text: string | null = null;
			if (h.op === 'create') text = `New ${a.type}: ${a.title}`;
			else if (h.op === 'promote') text = `Promoted to a job: ${a.title}`;
			else if (h.op === 'status' && h.status === 'done') text = `Done: ${a.title}`;
			else if (h.op === 'status' && h.status === 'dropped') text = `Dropped: ${a.title}`;
			if (text) lines.push({ cursor: h.cursor, at: h.at, actionId: a.id, by: h.by, text });
		}
	}
	return lines.sort((x, y) => x.cursor - y.cursor);
}

// ---------------------------------------------------------------------------
// Quick capture: `/action <title> [@owner] [due]`
// ---------------------------------------------------------------------------

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Due date words → unix seconds at 17:00 local time of that day. */
export function parseDueWord(word: string, now: Date = new Date()): number | null {
	const w = word.toLowerCase();
	const at = (d: Date) => {
		const x = new Date(d);
		x.setHours(17, 0, 0, 0);
		return Math.floor(x.getTime() / 1000);
	};
	if (w === 'today') return at(now);
	if (w === 'tomorrow') return at(new Date(now.getTime() + 86_400_000));
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w);
	if (iso) {
		const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
		if (d.getMonth() !== Number(iso[2]) - 1) return null;
		return at(d);
	}
	const FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
	const day = WEEKDAYS.indexOf(w) >= 0 ? WEEKDAYS.indexOf(w) : FULL.indexOf(w);
	if (day >= 0) {
		const ahead = (day - now.getDay() + 7) % 7 || 7;
		return at(new Date(now.getTime() + ahead * 86_400_000));
	}
	return null;
}

export interface SlashActionCommand {
	title: string;
	/** Raw `@name` tokens; the composer resolves them to member pubkeys. */
	mentions: string[];
	due: number | null;
}

/**
 * Parse `/action Fix login timeout @alice friday`. Returns null when the text
 * is not an /action command. Only a trailing date word becomes the due date;
 * `@` tokens anywhere become owner candidates. Nothing is saved: the result
 * only pre-fills the draft.
 */
export function parseSlashAction(text: string, now: Date = new Date()): SlashActionCommand | null {
	const match = /^\/action(?:\s+([\s\S]*))?$/.exec(text.trim());
	if (!match) return null;
	const words = (match[1] ?? '').split(/\s+/).filter(Boolean);
	const mentions = words.filter((w) => /^@\S+$/.test(w)).map((w) => w.slice(1));
	let rest = words.filter((w) => !/^@\S+$/.test(w));
	let due: number | null = null;
	if (rest.length > 1) {
		const parsed = parseDueWord(rest[rest.length - 1], now);
		if (parsed !== null) {
			due = parsed;
			rest = rest.slice(0, -1);
		}
	}
	return { title: titleFromMessage(rest.join(' ')), mentions, due };
}
