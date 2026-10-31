import { describe, expect, it } from 'vitest';

import { ChatKinds } from '$lib/chat/kinds';
import {
	ACTION_MAX_SOURCES,
	createRosterRoleResolver,
	foldActions,
	parseActionOp,
	parseSlashAction
} from '$lib/chat/actions';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';
import {
	addSourceToDraft,
	canChangeAction,
	canCreateAction,
	canPromoteAction,
	createOutgoing,
	draftFromSlash,
	dueInputToUnix,
	formError,
	isTypingTarget,
	nextStatuses,
	openActionCount,
	promoteOutgoing,
	removeSourceFromDraft,
	resolveGroupRoles,
	statusOutgoing,
	unixToDueInput,
	updateOutgoing
} from './actionsView';

const hex = (c: string) => c.repeat(64);
const ADMIN = hex('a');
const MEMBER = hex('b');
const OTHER = hex('c');
const OUTSIDER = hex('f');
const MSG1 = hex('1');
const MSG2 = hex('2');

let seq = 0;
/** Turn an outgoing op into the stored message every member would fold. */
function stored(sender: string, out: { content: string; tags: string[][]; kind: number }) {
	seq += 1;
	return {
		cursor: seq,
		createdAt: 1_000_000 + seq * 1000,
		direction: 'inbound',
		sender,
		id: seq.toString(16).padStart(64, '0'),
		kind: out.kind,
		tags: out.tags,
		content: out.content
	} as StoredChatMessage;
}

describe('resolveGroupRoles', () => {
	it('admins are maintainers, members contributors, outsiders nothing', () => {
		const roleOf = resolveGroupRoles([ADMIN], [ADMIN, MEMBER]);
		expect(roleOf(ADMIN)?.role).toBe('maintainer');
		expect(roleOf(MEMBER)?.role).toBe('contributor');
		expect(roleOf(OUTSIDER)).toBeNull();
	});
	it('an admin-less (egalitarian) group makes every member a maintainer', () => {
		const roleOf = resolveGroupRoles([], [ADMIN, MEMBER]);
		expect(roleOf(MEMBER)?.role).toBe('maintainer');
		expect(roleOf(OUTSIDER)).toBeNull();
	});
});

describe('draft building', () => {
	it('starts from one message with a clipped title', () => {
		const d = addSourceToDraft(null, { eventId: MSG1, text: 'Fix the login\nmore detail' });
		expect(d).toMatchObject({ title: 'Fix the login', type: 'todo', owner: '', due: '' });
		expect(d.sources).toEqual([{ id: MSG1, preview: 'Fix the login' }]);
	});
	it('adds more messages without duplicates and keeps the title', () => {
		let d = addSourceToDraft(null, { eventId: MSG1, text: 'one' });
		d = addSourceToDraft(d, { eventId: MSG2, text: 'two' });
		d = addSourceToDraft(d, { eventId: MSG2, text: 'two' });
		expect(d.title).toBe('one');
		expect(d.sources.map((s) => s.id)).toEqual([MSG1, MSG2]);
		expect(removeSourceFromDraft(d, MSG1).sources.map((s) => s.id)).toEqual([MSG2]);
	});
	it('caps sources at the protocol limit', () => {
		let d = addSourceToDraft(null, { eventId: hex('0'), text: 'x' });
		for (let i = 1; i < ACTION_MAX_SOURCES + 5; i += 1) {
			d = addSourceToDraft(d, { eventId: i.toString(16).padStart(64, '9'), text: 'x' });
		}
		expect(d.sources).toHaveLength(ACTION_MAX_SOURCES);
		expect(formError(d)).toBeNull();
	});
	it('a draft with no messages or no title cannot be saved', () => {
		const d = addSourceToDraft(null, { eventId: MSG1, text: 'x' });
		expect(formError(removeSourceFromDraft(d, MSG1))).toMatch(/between 1/);
		expect(formError({ ...d, title: '   ' })).toMatch(/Title/);
	});
});

describe('/action quick capture', () => {
	const now = new Date(2026, 9, 31, 12); // Saturday
	it('resolves the owner from picked mentions and the due word', () => {
		const command = parseSlashAction('/action Fix login timeout @Alice fri', now)!;
		const d = draftFromSlash(command, {
			people: [{ pubkey: MEMBER, label: '@alice' }],
			source: { eventId: MSG1, text: 'login keeps timing out' }
		})!;
		expect(d.title).toBe('Fix login timeout');
		expect(d.owner).toBe(MEMBER);
		expect(d.due).toBe('2026-11-06');
		expect(d.sources[0].id).toBe(MSG1);
	});
	it('falls back to the source text when the command has no title', () => {
		const d = draftFromSlash(parseSlashAction('/action', now)!, {
			people: [],
			source: { eventId: MSG1, text: 'ship the panel' }
		})!;
		expect(d.title).toBe('ship the panel');
		expect(d.owner).toBe('');
	});
	it('needs a message to link back to', () => {
		expect(draftFromSlash(parseSlashAction('/action x', now)!, { people: [], source: null })).toBe(
			null
		);
	});
});

describe('due dates', () => {
	it('round-trips a date input at 17:00 local', () => {
		const unix = dueInputToUnix('2026-11-06')!;
		expect(new Date(unix * 1000).getHours()).toBe(17);
		expect(unixToDueInput(unix)).toBe('2026-11-06');
	});
	it('rejects bad dates', () => {
		expect(dueInputToUnix('')).toBeNull();
		expect(dueInputToUnix('2026-02-31')).toBeNull();
		expect(dueInputToUnix('6/11/2026')).toBeNull();
	});
});

describe('outgoing ops land in the fold', () => {
	it('create → status → promote, sent through the chat outbox shape', () => {
		const roleOf = resolveGroupRoles([ADMIN], [ADMIN, MEMBER]);
		const draft = {
			...addSourceToDraft(null, { eventId: MSG1, text: 'Write the importer' }),
			type: 'code' as const,
			owner: MEMBER,
			due: '2026-11-06'
		};
		const createOp = createOutgoing(draft);
		expect(createOp.kind).toBe(ChatKinds.Action);
		expect(parseActionOp(createOp.kind, createOp.content, createOp.tags)?.op).toBe('create');

		const created = stored(MEMBER, createOp);
		const actionId = created.id;
		const log = [
			created,
			stored(MEMBER, statusOutgoing(actionId, 'in_progress')),
			stored(ADMIN, promoteOutgoing(actionId)),
			stored(MEMBER, updateOutgoing(actionId, { title: 'Write the CSV importer' }))
		];
		const state = foldActions(log, roleOf);
		expect(state.rejected).toEqual([]);
		const action = state.byId.get(actionId)!;
		expect(action).toMatchObject({
			title: 'Write the CSV importer',
			status: 'in_progress',
			promoted: true,
			owner: MEMBER,
			due: dueInputToUnix('2026-11-06')
		});
		expect(openActionCount(state)).toBe(1);
	});
});

describe('permission mirrors match the fold', () => {
	const roleOf = resolveGroupRoles([ADMIN], [ADMIN, MEMBER, OTHER]);
	const created = stored(
		MEMBER,
		createOutgoing({
			...addSourceToDraft(null, { eventId: MSG1, text: 'Code it' }),
			type: 'code'
		})
	);
	const state = foldActions([created], roleOf);
	const action = state.byId.get(created.id)!;

	it('creator and admins may change; other members may not', () => {
		expect(canChangeAction(action, MEMBER, roleOf)).toBe(true);
		expect(canChangeAction(action, ADMIN, roleOf)).toBe(true);
		expect(canChangeAction(action, OTHER, roleOf)).toBe(false);
		expect(canChangeAction(action, OUTSIDER, roleOf)).toBe(false);
		// …and the fold agrees: OTHER's status op is rejected.
		const after = foldActions([created, stored(OTHER, statusOutgoing(action.id, 'done'))], roleOf);
		expect(after.rejected.map((r) => r.reason)).toEqual(['not_allowed']);
	});
	it('only maintainers may make a code action a job', () => {
		expect(canPromoteAction(action, ADMIN, roleOf)).toBe(true);
		expect(canPromoteAction(action, MEMBER, roleOf)).toBe(false);
		expect(canPromoteAction({ ...action, type: 'todo' }, ADMIN, roleOf)).toBe(false);
		expect(canPromoteAction({ ...action, status: 'done' }, ADMIN, roleOf)).toBe(false);
	});
	it('agents and viewers never create (people move every stage)', () => {
		const roster = createRosterRoleResolver({
			members: [
				{ pubkey: ADMIN, role: 'owner' },
				{ pubkey: MEMBER, role: 'viewer' },
				{ pubkey: OTHER, role: 'agent', of: ADMIN }
			]
		});
		expect(canCreateAction(ADMIN, roster)).toBe(true);
		expect(canCreateAction(MEMBER, roster)).toBe(false);
		expect(canCreateAction(OTHER, roster)).toBe(false);
		expect(canCreateAction(OUTSIDER, roster)).toBe(false);
	});
});

describe('small helpers', () => {
	it('offers sensible next statuses', () => {
		expect(nextStatuses('open').map((s) => s.status)).toEqual(['in_progress', 'done', 'dropped']);
		expect(nextStatuses('done').map((s) => s.status)).toEqual(['open']);
	});
	it('ignores non-elements for the typing check', () => {
		expect(isTypingTarget(null)).toBe(false);
		expect(isTypingTarget({} as EventTarget)).toBe(false);
	});
});
