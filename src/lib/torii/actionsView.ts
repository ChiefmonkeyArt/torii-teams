/**
 * Torii Teams — glue between the action log (`$lib/chat/actions`) and the
 * chat screen (J1 slice 2). Pure functions only, so the shell stays thin and
 * every rule here is unit-tested without a browser.
 */
import {
	createActionTags,
	createGroupRoleResolver,
	promoteActionTags,
	statusActionTags,
	titleFromMessage,
	updateActionMessage,
	validateActionDraft,
	ACTION_MAX_SOURCES,
	type Action,
	type ActionPatch,
	type ActionState,
	type ActionStatus,
	type ActionType,
	type RoleResolver,
	type SlashActionCommand
} from '$lib/chat/actions';
import { ChatKinds } from '$lib/chat/kinds';
import { safeNormalizePubKey } from '$lib/utils';

/** One outgoing action operation, ready for the chat outbox. */
export interface ActionOutgoing {
	content: string;
	tags: string[][];
	kind: number;
}

/** A source message as the draft form shows it. */
export interface DraftSource {
	/** Event id (what the `q` tag carries). */
	id: string;
	/** Short preview text. */
	preview: string;
}

/** Editable form state for a new action (nothing is sent until Save). */
export interface ActionFormDraft {
	title: string;
	type: ActionType;
	sources: DraftSource[];
	owner: string;
	/** `YYYY-MM-DD` from a date input, or ''. */
	due: string;
	/** Set when editing an existing action (its id); sources are then fixed. */
	editing?: string;
}

/**
 * Role resolver for a plain Cordn group (no Torii roster yet). A group with
 * no configured admins is egalitarian in Cordn — every member may administer —
 * so every member counts as a maintainer there.
 */
export function resolveGroupRoles(adminPubkeys: string[], memberPubkeys: string[]): RoleResolver {
	return createGroupRoleResolver(
		adminPubkeys.length > 0 ? adminPubkeys : memberPubkeys,
		memberPubkeys
	);
}

/** Mirrors the fold's update/status rule so the UI only offers what will land. */
export function canChangeAction(action: Action, me: string, roleOf: RoleResolver): boolean {
	const role = roleOf(me);
	if (!role || role.agent || role.role === 'viewer') return false;
	if (role.role === 'owner' || role.role === 'maintainer') return true;
	return me === action.createdBy || me === action.owner;
}

/** Mirrors the fold's promote rule. */
export function canPromoteAction(action: Action, me: string, roleOf: RoleResolver): boolean {
	const role = roleOf(me);
	return (
		!!role &&
		!role.agent &&
		(role.role === 'owner' || role.role === 'maintainer') &&
		action.type === 'code' &&
		!action.promoted &&
		action.status !== 'done' &&
		action.status !== 'dropped'
	);
}

/** Mirrors the fold's create rule. */
export function canCreateAction(me: string, roleOf: RoleResolver): boolean {
	const role = roleOf(me);
	return !!role && !role.agent && role.role !== 'viewer';
}

/** Start a draft from one message, or add the message to an open draft. */
export function addSourceToDraft(
	draft: ActionFormDraft | null,
	source: { eventId: string; text: string }
): ActionFormDraft {
	const preview = titleFromMessage(source.text) || 'Message';
	if (!draft) {
		return {
			title: titleFromMessage(source.text),
			type: 'todo',
			sources: [{ id: source.eventId, preview }],
			owner: '',
			due: ''
		};
	}
	if (
		draft.sources.some((s) => s.id === source.eventId) ||
		draft.sources.length >= ACTION_MAX_SOURCES
	) {
		return draft;
	}
	return {
		...draft,
		title: draft.title || titleFromMessage(source.text),
		sources: [...draft.sources, { id: source.eventId, preview }]
	};
}

/** Drop one source from the draft. */
export function removeSourceFromDraft(draft: ActionFormDraft, id: string): ActionFormDraft {
	return { ...draft, sources: draft.sources.filter((s) => s.id !== id) };
}

/**
 * Turn `/action …` into a draft. Owner = the first `@name` that matches a
 * mention the composer picked or a member label (case-insensitive). The
 * source is the reply target, else the newest message in view: an action
 * always links back to the talk it came from.
 */
export function draftFromSlash(
	command: SlashActionCommand,
	options: {
		people: { pubkey: string; label: string }[];
		source: { eventId: string; text: string } | null;
	}
): ActionFormDraft | null {
	if (!options.source) return null;
	const draft = addSourceToDraft(null, options.source);
	const wanted = command.mentions.map((m) => m.toLowerCase());
	const owner = options.people.find((p) =>
		wanted.includes(p.label.replace(/^@/, '').toLowerCase())
	);
	return {
		...draft,
		title: command.title || draft.title,
		owner: owner?.pubkey ?? '',
		due: command.due ? unixToDueInput(command.due) : ''
	};
}

/** `YYYY-MM-DD` → unix seconds at 17:00 local; '' or invalid → null. */
export function dueInputToUnix(value: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 17, 0, 0, 0);
	if (date.getMonth() !== Number(match[2]) - 1) return null;
	return Math.floor(date.getTime() / 1000);
}

/** unix seconds → `YYYY-MM-DD` in local time. */
export function unixToDueInput(seconds: number): string {
	const d = new Date(seconds * 1000);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Open the form on an existing action. */
export function draftFromAction(
	action: Action,
	previewOf: (eventId: string) => string | undefined
): ActionFormDraft {
	return {
		title: action.title,
		type: action.type,
		sources: action.sources.map((id) => ({ id, preview: previewOf(id) ?? 'Earlier message' })),
		owner: action.owner ?? '',
		due: action.due ? unixToDueInput(action.due) : '',
		editing: action.id
	};
}

/**
 * Only the fields that changed, or null when nothing did. A due date left on
 * the same calendar day keeps its exact time (no churn from the 17:00 rule).
 */
export function patchFromDraft(action: Action, draft: ActionFormDraft): ActionPatch | null {
	const patch: ActionPatch = {};
	const title = draft.title.trim();
	if (title !== action.title) patch.title = title;
	if (draft.type !== action.type) patch.type = draft.type;
	const owner = draft.owner ? safeNormalizePubKey(draft.owner) || draft.owner : null;
	if (owner !== action.owner) patch.owner = owner;
	const sameDay = action.due !== null && draft.due === unixToDueInput(action.due);
	if (!sameDay) {
		const due = dueInputToUnix(draft.due);
		if (due !== action.due) patch.due = due;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

/** Validate the form; null when it can be saved. */
export function formError(draft: ActionFormDraft): string | null {
	return validateActionDraft({
		title: draft.title.trim(),
		type: draft.type,
		sources: draft.sources.map((s) => s.id),
		owner: draft.owner ? safeNormalizePubKey(draft.owner) || draft.owner : null,
		due: dueInputToUnix(draft.due)
	});
}

/** The `create` op for a saved draft. Throws on an invalid draft. */
export function createOutgoing(draft: ActionFormDraft): ActionOutgoing {
	const title = draft.title.trim();
	return {
		content: title,
		tags: createActionTags({
			title,
			type: draft.type,
			sources: draft.sources.map((s) => s.id),
			owner: draft.owner ? safeNormalizePubKey(draft.owner) || draft.owner : null,
			due: dueInputToUnix(draft.due)
		}),
		kind: ChatKinds.Action
	};
}

export function statusOutgoing(actionId: string, status: ActionStatus): ActionOutgoing {
	return { content: '', tags: statusActionTags(actionId, status), kind: ChatKinds.Action };
}

export function promoteOutgoing(actionId: string): ActionOutgoing {
	return { content: '', tags: promoteActionTags(actionId), kind: ChatKinds.Action };
}

export function updateOutgoing(actionId: string, patch: ActionPatch): ActionOutgoing {
	const { content, tags } = updateActionMessage(actionId, patch);
	return { content, tags, kind: ChatKinds.Action };
}

/** Status buttons offered for an action, in display order. */
export function nextStatuses(status: ActionStatus): { status: ActionStatus; label: string }[] {
	switch (status) {
		case 'open':
			return [
				{ status: 'in_progress', label: 'Start' },
				{ status: 'done', label: 'Done' },
				{ status: 'dropped', label: 'Drop' }
			];
		case 'in_progress':
			return [
				{ status: 'done', label: 'Done' },
				{ status: 'open', label: 'Pause' },
				{ status: 'dropped', label: 'Drop' }
			];
		default:
			return [{ status: 'open', label: 'Reopen' }];
	}
}

/** Count shown on the header button: everything not finished. */
export function openActionCount(state: ActionState): number {
	let n = 0;
	for (const a of state.actions) if (a.status === 'open' || a.status === 'in_progress') n += 1;
	return n;
}

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
	todo: 'To do',
	decision: 'Decision',
	question: 'Question',
	code: 'Code'
};

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
	open: 'Open',
	in_progress: 'In progress',
	done: 'Done',
	dropped: 'Dropped'
};

/** True when keyboard focus is in a text field (so `A` must type, not act). */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!target || typeof (target as Element).closest !== 'function') return false;
	const el = target as HTMLElement;
	return Boolean(
		el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
	);
}
