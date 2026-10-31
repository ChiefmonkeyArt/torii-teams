import { describe, expect, it } from 'vitest';

import { ChatKinds, isStreamHiddenKind } from '$lib/chat/kinds';
import {
	ACTION_MAX_SOURCES,
	badgeForMessage,
	createActionTags,
	createGroupRoleResolver,
	createRosterRoleResolver,
	decisionLog,
	foldActions,
	groupForPanel,
	parseActionOp,
	parseDueWord,
	parseSlashAction,
	promoteActionTags,
	statusActionTags,
	statusLines,
	titleFromMessage,
	updateActionMessage,
	validateActionDraft
} from '$lib/chat/actions';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';

const hex = (c: string) => c.repeat(64);
const OWNER = hex('a');
const MAINT = hex('b');
const CONTRIB = hex('c');
const VIEWER = hex('d');
const AGENT = hex('e');
const OUTSIDER = hex('f');
const MSG1 = hex('1');
const MSG2 = hex('2');

const roster = createRosterRoleResolver({
	members: [
		{ pubkey: OWNER, role: 'owner' },
		{ pubkey: MAINT, role: 'maintainer' },
		{ pubkey: CONTRIB, role: 'contributor' },
		{ pubkey: VIEWER, role: 'viewer' },
		{ pubkey: AGENT, role: 'agent', of: OWNER }
	]
});

let seq = 0;
function op(
	sender: string,
	tags: string[][],
	content = '',
	extra: Partial<StoredChatMessage> = {}
): StoredChatMessage {
	seq += 1;
	return {
		cursor: seq,
		createdAt: 1_000_000 + seq * 1000,
		direction: 'inbound',
		sender,
		id: seq.toString(16).padStart(64, '0'),
		kind: ChatKinds.Action,
		tags,
		content,
		...extra
	};
}
const create = (
	sender: string,
	title: string,
	type = 'todo',
	sources = [MSG1],
	more: string[][] = []
) =>
	op(sender, [['op', 'create'], ['type', type], ...sources.map((s) => ['q', s]), ...more], title);

describe('kind registration', () => {
	it('action ops never render as stream rows', () => {
		expect(isStreamHiddenKind(ChatKinds.Action)).toBe(true);
	});
});

describe('send side', () => {
	it('builds create tags that round-trip through the parser', () => {
		const tags = createActionTags({
			title: 'Fix login',
			type: 'code',
			sources: [MSG1, MSG2],
			owner: CONTRIB,
			due: 1_800_000_000
		});
		expect(parseActionOp(ChatKinds.Action, 'Fix login', tags)).toEqual({
			op: 'create',
			title: 'Fix login',
			type: 'code',
			sources: [MSG1, MSG2],
			owner: CONTRIB,
			due: 1_800_000_000
		});
	});

	it('rejects bad drafts', () => {
		expect(validateActionDraft({ title: '', type: 'todo', sources: [MSG1] })).toMatch(/Title/);
		expect(validateActionDraft({ title: ' padded', type: 'todo', sources: [MSG1] })).toMatch(
			/Title/
		);
		expect(validateActionDraft({ title: 'x\u202e', type: 'todo', sources: [MSG1] })).toMatch(
			/Title/
		);
		expect(validateActionDraft({ title: 'x', type: 'todo', sources: [] })).toMatch(/Pick/);
		expect(validateActionDraft({ title: 'x', type: 'todo', sources: [MSG1, MSG1] })).toMatch(
			/Duplicate/
		);
		expect(
			validateActionDraft({
				title: 'x',
				type: 'todo',
				sources: Array.from({ length: ACTION_MAX_SOURCES + 1 }, (_, i) =>
					i.toString(16).padStart(64, '0')
				)
			})
		).toMatch(/Pick/);
		expect(validateActionDraft({ title: 'x', type: 'nope' as never, sources: [MSG1] })).toMatch(
			/type/
		);
		expect(() => createActionTags({ title: '', type: 'todo', sources: [MSG1] })).toThrow();
	});

	it('builds update, status and promote ops', () => {
		const u = updateActionMessage(MSG1, { owner: null, due: null, title: 'New' });
		expect(parseActionOp(ChatKinds.Action, u.content, u.tags)).toEqual({
			op: 'update',
			target: MSG1,
			title: 'New',
			owner: null,
			due: null
		});
		expect(parseActionOp(ChatKinds.Action, '', statusActionTags(MSG1, 'done'))).toEqual({
			op: 'status',
			target: MSG1,
			status: 'done'
		});
		expect(parseActionOp(ChatKinds.Action, '', promoteActionTags(MSG1))).toEqual({
			op: 'promote',
			target: MSG1
		});
		expect(() => updateActionMessage(MSG1, {})).toThrow(/Nothing/);
	});
});

describe('parser is strict', () => {
	it('drops other kinds, duplicate tags, bad ids and empty updates', () => {
		expect(
			parseActionOp(ChatKinds.Text, 'x', [
				['op', 'create'],
				['type', 'todo'],
				['q', MSG1]
			])
		).toBeNull();
		expect(
			parseActionOp(ChatKinds.Action, 'x', [
				['op', 'create'],
				['type', 'todo'],
				['type', 'code'],
				['q', MSG1]
			])
		).toBeNull();
		expect(
			parseActionOp(ChatKinds.Action, 'x', [
				['op', 'create'],
				['type', 'todo'],
				['q', 'nothex']
			])
		).toBeNull();
		expect(
			parseActionOp(ChatKinds.Action, '', [
				['op', 'update'],
				['e', MSG1]
			])
		).toBeNull();
		expect(
			parseActionOp(ChatKinds.Action, 'x', [
				['op', 'promote'],
				['e', MSG1]
			])
		).toBeNull();
		expect(
			parseActionOp(ChatKinds.Action, '', [
				['op', 'status'],
				['e', MSG1],
				['status', 'later']
			])
		).toBeNull();
		expect(
			parseActionOp(ChatKinds.Action, '', [
				['op', 'delete'],
				['e', MSG1]
			])
		).toBeNull();
	});

	it('ignores unknown extension tags', () => {
		expect(
			parseActionOp(ChatKinds.Action, 'x', [
				['op', 'create'],
				['type', 'todo'],
				['q', MSG1],
				['future', '1']
			])
		).not.toBeNull();
	});
});

describe('fold and roles', () => {
	it('contributors create; viewers, agents and outsiders cannot', () => {
		const ms = [
			create(CONTRIB, 'A'),
			create(VIEWER, 'B'),
			create(AGENT, 'C'),
			create(OUTSIDER, 'D')
		];
		const s = foldActions(ms, roster);
		expect(s.actions.map((a) => a.title)).toEqual(['A']);
		expect(s.rejected.map((r) => r.reason)).toEqual(['not_allowed', 'not_allowed', 'not_allowed']);
	});

	it('creator, owner of the action, or a maintainer may change it; others may not', () => {
		const c = create(CONTRIB, 'Ship it', 'todo', [MSG1], [['p', CONTRIB]]);
		const s = foldActions(
			[
				c,
				op(VIEWER, statusActionTags(c.id, 'done')),
				op(OWNER, statusActionTags(c.id, 'in_progress')),
				op(MAINT, updateActionMessage(c.id, { owner: VIEWER }).tags),
				op(VIEWER, statusActionTags(c.id, 'done')) // viewer is now the owner but cannot write
			],
			roster
		);
		const a = s.byId.get(c.id)!;
		expect(a.status).toBe('in_progress');
		expect(a.owner).toBe(VIEWER);
		expect(s.rejected.map((r) => r.reason)).toEqual(['not_allowed', 'not_allowed']);
	});

	it('only maintainers and the owner promote, and only open code actions', () => {
		const code = create(CONTRIB, 'Write parser', 'code');
		const todo = create(CONTRIB, 'Buy milk');
		const s = foldActions(
			[
				code,
				todo,
				op(CONTRIB, promoteActionTags(code.id)),
				op(MAINT, promoteActionTags(todo.id)),
				op(MAINT, promoteActionTags(code.id)),
				op(OWNER, promoteActionTags(code.id))
			],
			roster
		);
		expect(s.byId.get(code.id)!.promoted).toBe(true);
		expect(s.rejected.map((r) => r.reason)).toEqual([
			'not_allowed',
			'not_promotable',
			'not_promotable'
		]);
	});

	it('a promoted action stays code', () => {
		const code = create(OWNER, 'Write parser', 'code');
		const s = foldActions(
			[
				code,
				op(OWNER, promoteActionTags(code.id)),
				op(OWNER, updateActionMessage(code.id, { type: 'todo' }).tags)
			],
			roster
		);
		expect(s.byId.get(code.id)!.type).toBe('code');
		expect(s.rejected[0].reason).toBe('promoted_is_code');
	});

	it('orders by coordinator cursor, not arrival or created_at', () => {
		const c = create(OWNER, 'T');
		const done = op(OWNER, statusActionTags(c.id, 'done'));
		const reopen = op(OWNER, statusActionTags(c.id, 'open'));
		const s = foldActions([reopen, done, c], roster);
		expect(s.byId.get(c.id)!.status).toBe('open');
	});

	it('is deterministic across devices', () => {
		const c = create(CONTRIB, 'T');
		const ms = [c, op(MAINT, statusActionTags(c.id, 'done'))];
		expect(JSON.stringify(foldActions([...ms], roster).actions)).toBe(
			JSON.stringify(foldActions([...ms].reverse(), roster).actions)
		);
	});

	it('drops ops for unknown actions and duplicate creates', () => {
		const c = create(OWNER, 'T');
		const s = foldActions(
			[c, { ...c, cursor: 999 }, op(OWNER, statusActionTags(MSG2, 'done'))],
			roster
		);
		expect(s.actions).toHaveLength(1);
		expect(s.rejected.map((r) => r.reason).sort()).toEqual(['duplicate', 'unknown_action']);
	});

	it('agents get at most contributor and are still blocked from writing', () => {
		expect(roster(AGENT)).toEqual({ role: 'contributor', agent: true });
	});

	it('standalone groups: admins act as maintainers, members as contributors', () => {
		const r = createGroupRoleResolver([OWNER], [OWNER, CONTRIB]);
		const code = create(CONTRIB, 'X', 'code');
		const s = foldActions([code, op(OWNER, promoteActionTags(code.id))], r);
		expect(s.byId.get(code.id)!.promoted).toBe(true);
		expect(r(OUTSIDER)).toBeNull();
	});
});

describe('views', () => {
	it('groups the panel, badges sources, keeps a decision log and draws status lines', () => {
		const a = create(OWNER, 'Use Cordn', 'decision', [MSG1]);
		const b = create(OWNER, 'Write fold', 'code', [MSG1, MSG2]);
		const c = create(OWNER, 'Ask Bob', 'question', [MSG2]);
		const ms = [
			a,
			b,
			c,
			op(OWNER, promoteActionTags(b.id)),
			op(OWNER, statusActionTags(c.id, 'done'))
		];
		const s = foldActions(ms, roster);
		const g = groupForPanel(s);
		expect(g.open.map((x) => x.title)).toEqual(['Use Cordn']);
		expect(g.jobs.map((x) => x.title)).toEqual(['Write fold']);
		expect(g.done.map((x) => x.title)).toEqual(['Ask Bob']);
		expect(badgeForMessage(s, MSG2)).toEqual({ actionId: c.id, status: 'done', count: 2 });
		expect(badgeForMessage(s, hex('9'))).toBeNull();
		expect(decisionLog(s).map((x) => x.title)).toEqual(['Use Cordn']);
		expect(statusLines(s).map((l) => l.text)).toEqual([
			'New decision: Use Cordn',
			'New code: Write fold',
			'New question: Ask Bob',
			'Promoted to a job: Write fold',
			'Done: Ask Bob'
		]);
	});
});

describe('quick capture', () => {
	const now = new Date(2026, 9, 31, 10, 0, 0); // Saturday 31 Oct 2026, local time

	it('parses /action with owner and trailing due word', () => {
		const r = parseSlashAction('/action Fix login timeout @alice friday', now)!;
		expect(r.title).toBe('Fix login timeout');
		expect(r.mentions).toEqual(['alice']);
		expect(new Date(r.due! * 1000).getDay()).toBe(5);
		expect(new Date(r.due! * 1000).getHours()).toBe(17);
	});

	it('keeps a lone date-like word as the title and ignores non-commands', () => {
		expect(parseSlashAction('/action Friday', now)).toEqual({
			title: 'Friday',
			mentions: [],
			due: null
		});
		expect(parseSlashAction('/actions nope', now)).toBeNull();
		expect(parseSlashAction('hello', now)).toBeNull();
		expect(parseSlashAction('/action', now)).toEqual({ title: '', mentions: [], due: null });
	});

	it('understands today, tomorrow, ISO dates and short weekdays', () => {
		expect(new Date(parseDueWord('today', now)! * 1000).getDate()).toBe(31);
		expect(new Date(parseDueWord('tomorrow', now)! * 1000).getDate()).toBe(1);
		expect(new Date(parseDueWord('2026-11-04', now)! * 1000).getDate()).toBe(4);
		expect(parseDueWord('2026-02-30', now)).toBeNull();
		expect(new Date(parseDueWord('sat', now)! * 1000).getDate()).toBe(7); // next week, not today
		expect(parseDueWord('soon', now)).toBeNull();
	});

	it('pre-fills titles from message text safely', () => {
		expect(titleFromMessage('\n  We should   ship\u202e it  \nsecond line')).toBe(
			'We should ship it'
		);
		expect(new TextEncoder().encode(titleFromMessage('é'.repeat(400))).length).toBeLessThanOrEqual(
			280
		);
	});
});
