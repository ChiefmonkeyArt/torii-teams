import { mount, unmount, flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('$lib/queries/chatProfileQueries', () => ({ ensureProfileLoaded: () => {} }));

import ActionsPanel from './ActionsPanel.svelte';
import { foldActions, type ActionState } from '$lib/chat/actions';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';
import {
	addSourceToDraft,
	draftFromAction,
	createOutgoing,
	promoteOutgoing,
	resolveGroupRoles,
	statusOutgoing,
	type ActionFormDraft
} from './actionsView';

const hex = (c: string) => c.repeat(64);
const ADMIN = hex('a');
const MEMBER = hex('b');
const MSG1 = hex('1');
const roleOf = resolveGroupRoles([ADMIN], [ADMIN, MEMBER]);

let seq = 0;
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

function makeState(): { state: ActionState; codeId: string } {
	const code = stored(
		MEMBER,
		createOutgoing({
			...addSourceToDraft(null, { eventId: MSG1, text: 'Write importer' }),
			type: 'code'
		})
	);
	const decision = stored(
		ADMIN,
		createOutgoing({
			...addSourceToDraft(null, { eventId: MSG1, text: 'Use SQLite' }),
			type: 'decision'
		})
	);
	const done = stored(
		MEMBER,
		createOutgoing(addSourceToDraft(null, { eventId: MSG1, text: 'Book the call' }))
	);
	const log = [code, decision, done, stored(MEMBER, statusOutgoing(done.id, 'done'))];
	return { state: foldActions(log, roleOf), codeId: code.id };
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
	await cleanup?.();
	cleanup = null;
});

function render(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.append(target);
	const handlers = {
		onSave: vi.fn(),
		onStatus: vi.fn(),
		onPromote: vi.fn(),
		onEdit: vi.fn(),
		onAssign: vi.fn(),
		onJump: vi.fn(),
		onClose: vi.fn()
	};
	const component = mount(ActionsPanel, {
		target,
		props: { roleOf, members: [ADMIN, MEMBER], ...handlers, ...props } as never
	});
	flushSync();
	cleanup = async () => {
		await unmount(component);
		target.remove();
	};
	return { target, handlers };
}

test('groups actions into sections and only offers allowed buttons', () => {
	const { state, codeId } = makeState();
	const { target, handlers } = render({ actionState: state, me: ADMIN });
	const summaries = [...target.querySelectorAll('summary')].map((s) => s.textContent?.trim());
	expect(summaries).toEqual(['Open · 2', 'Done · 1']);

	const card = target.querySelector(`[data-action-id="${codeId}"]`)!;
	const labels = [...card.querySelectorAll('button')].map((b) => b.textContent?.trim());
	expect(labels).toContain('Make job');
	[...card.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Make job')!.click();
	expect(handlers.onPromote).toHaveBeenCalledOnce();
	[...card.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Start')!.click();
	expect(handlers.onStatus.mock.calls[0][1]).toBe('in_progress');
});

test('a member who did not make the decision sees no buttons on it', () => {
	const { state } = makeState();
	const { target } = render({ actionState: state, me: MEMBER });
	const decision = state.actions.find((a) => a.type === 'decision')!;
	const card = target.querySelector(`[data-action-id="${decision.id}"]`)!;
	// Only the "show source" eye button; no status or promote buttons.
	expect([...card.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
		'Show the message this came from'
	]);
	const code = state.actions.find((a) => a.type === 'code')!;
	const codeCard = target.querySelector(`[data-action-id="${code.id}"]`)!;
	expect(codeCard.textContent).not.toContain('Make job');
});

test('promoted actions move under Jobs', () => {
	const code = stored(
		MEMBER,
		createOutgoing({
			...addSourceToDraft(null, { eventId: MSG1, text: 'Job me' }),
			type: 'code'
		})
	);
	const log = [code, stored(ADMIN, promoteOutgoing(code.id))];
	const { target } = render({ actionState: foldActions(log, roleOf), me: ADMIN });
	expect([...target.querySelectorAll('summary')].map((s) => s.textContent?.trim())).toEqual([
		'Jobs · 1'
	]);
});

test('the draft form saves with Enter and blocks an empty title', () => {
	const draft: ActionFormDraft = addSourceToDraft(null, {
		eventId: MSG1,
		text: 'Ship the panel'
	});
	const { state } = makeState();
	const { target, handlers } = render({ actionState: state, me: ADMIN, draft });
	const form = target.querySelector<HTMLFormElement>('form[aria-label="New action"]')!;
	const title = form.querySelector<HTMLInputElement>('input:not([type="date"])')!;
	expect(title.value).toBe('Ship the panel');
	form.requestSubmit();
	expect(handlers.onSave).toHaveBeenCalledOnce();
	expect(handlers.onSave.mock.calls[0][0].title).toBe('Ship the panel');

	title.value = '';
	title.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	expect(form.querySelector('[role="alert"]')?.textContent).toMatch(/Title/);
	expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});

test('decisions tab lists decisions only', () => {
	const { state } = makeState();
	const { target } = render({ actionState: state, me: ADMIN });
	[...target.querySelectorAll('[role="tab"]')]
		.find((t) => t.textContent?.trim() === 'Decisions')!
		.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
	const cards = target.querySelectorAll('[data-action-id]');
	expect(cards).toHaveLength(1);
	expect(cards[0].textContent).toContain('Use SQLite');
});

test('Edit and Assign to me appear for people who may change the action', () => {
	const { state, codeId } = makeState();
	const { target, handlers } = render({ actionState: state, me: ADMIN });
	const card = target.querySelector(`[data-action-id="${codeId}"]`)!;
	const button = (label: string) =>
		[...card.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
	button('Assign to me')!.click();
	expect(handlers.onAssign.mock.calls[0][0].id).toBe(codeId);
	button('Edit')!.click();
	expect(handlers.onEdit.mock.calls[0][0].id).toBe(codeId);
	// Done actions can be edited but not assigned.
	const done = state.actions.find((a) => a.status === 'done')!;
	const doneCard = target.querySelector(`[data-action-id="${done.id}"]`)!;
	const doneLabels = [...doneCard.querySelectorAll('button')].map((b) => b.textContent?.trim());
	expect(doneLabels).toContain('Edit');
	expect(doneLabels).not.toContain('Assign to me');
});

test('edit mode keeps sources fixed and says so', () => {
	const { state, codeId } = makeState();
	const draft = draftFromAction(state.byId.get(codeId)!, () => 'Write importer');
	const { target } = render({ actionState: state, me: ADMIN, draft });
	const form = target.querySelector<HTMLFormElement>('form[aria-label="Edit action"]')!;
	expect(form.querySelector('h3')?.textContent).toBe('Edit action');
	expect(form.querySelector('[aria-label="Remove this message"]')).toBeNull();
	expect(form.textContent).not.toContain('Tip:');
});
