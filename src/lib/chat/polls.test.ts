import { describe, expect, it } from 'vitest';

import { ChatKinds } from '$lib/chat/kinds';
import {
	buildPollTally,
	createPollMessageTags,
	createPollResponseTags,
	getMessagePollDefinition,
	getMessagePollResponseReference,
	validatePollDraft,
	type PollDraft
} from '$lib/chat/polls';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';

const ME = '1'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function draft(overrides: Partial<PollDraft> = {}): PollDraft {
	return {
		question: 'Pineapple on pizza?',
		optionLabels: ['Yay', 'Nay'],
		pollType: 'singlechoice',
		endsAt: null,
		...overrides
	};
}

let cursor = 0;
function message(overrides: Partial<StoredChatMessage> & { id: string }): StoredChatMessage {
	return {
		cursor: ++cursor,
		createdAt: 1000,
		direction: 'inbound',
		sender: ALICE,
		kind: ChatKinds.Text,
		tags: [],
		content: '',
		...overrides
	};
}

function pollMessage(id: string, overrides: Partial<StoredChatMessage> = {}): StoredChatMessage {
	return message({
		id,
		kind: ChatKinds.Poll,
		content: 'Pineapple on pizza?',
		createdAt: 100,
		tags: createPollMessageTags(draft()),
		...overrides
	});
}

function voteMessage(
	id: string,
	sender: string,
	optionIds: string[],
	overrides: Partial<StoredChatMessage> = {}
): StoredChatMessage {
	return message({
		id,
		sender,
		kind: ChatKinds.PollResponse,
		createdAt: 150,
		tags: createPollResponseTags({ id: 'poll1', pubkey: ALICE, kind: ChatKinds.Poll }, optionIds),
		...overrides
	});
}

describe('poll drafts', () => {
	it('accepts a sane draft and rejects the marmot gotcha cases', () => {
		const now = 1000;
		expect(validatePollDraft(draft(), now)).toBeNull();
		expect(validatePollDraft(draft({ question: ' padded ' }), now)).toMatch(/Question/);
		expect(validatePollDraft(draft({ question: 'q\u202eevil' }), now)).toMatch(/Question/);
		expect(validatePollDraft(draft({ optionLabels: ['only'] }), now)).toMatch(/options/);
		expect(validatePollDraft(draft({ optionLabels: ['a', '  '] }), now)).toMatch(/Options/);
		expect(validatePollDraft(draft({ endsAt: now }), now)).toMatch(/End time/);
		expect(validatePollDraft(draft({ endsAt: now + 31 * 24 * 3600 }), now)).toMatch(/End time/);
		expect(validatePollDraft(draft({ endsAt: now + 3600 }), now)).toBeNull();
	});
});

describe('poll tag round trip', () => {
	it('assigns display-order ids and defaults to singlechoice on parse', () => {
		const tags = createPollMessageTags(draft({ pollType: 'multiplechoice', endsAt: 5000 }), 4000);
		const parsed = getMessagePollDefinition(ChatKinds.Poll, 'Pineapple on pizza?', tags);
		expect(parsed).toEqual({
			question: 'Pineapple on pizza?',
			options: [
				{ id: '0', label: 'Yay' },
				{ id: '1', label: 'Nay' }
			],
			pollType: 'multiplechoice',
			endsAt: 5000
		});
	});

	it('parses a poll without polltype as singlechoice and ignores extension tags', () => {
		const tags = [
			['option', 'qj518h583', 'Yay'],
			['option', 'gga6cdnqj', 'Nay'],
			['relay', 'wss://example.test'],
			['future-extension', 'value']
		];
		expect(getMessagePollDefinition(ChatKinds.Poll, 'Q?', tags)).toMatchObject({
			pollType: 'singlechoice',
			endsAt: null
		});
	});

	it('rejects malformed known tags strictly', () => {
		const base = createPollMessageTags(draft());
		expect(getMessagePollDefinition(ChatKinds.Poll, 'Q?', [['option', '0']])).toBeNull();
		expect(
			getMessagePollDefinition(ChatKinds.Poll, 'Q?', [...base, ['polltype', 'approval']])
		).toBeNull();
		expect(
			getMessagePollDefinition(ChatKinds.Poll, 'Q?', [...base, ['polltype', 'singlechoice']])
		).toBeNull(); // duplicate
		expect(
			getMessagePollDefinition(ChatKinds.Poll, 'Q?', [...base, ['endsAt', 'soon']])
		).toBeNull();
		expect(getMessagePollDefinition(ChatKinds.Poll, '  ', base)).toBeNull(); // empty question
		expect(getMessagePollDefinition(ChatKinds.Text, 'Q?', base)).toBeNull();
		expect(
			getMessagePollDefinition(
				ChatKinds.Poll,
				'Q?',
				Array.from({ length: 33 }, () => ['x', 'y'])
			)
		).toBeNull(); // tag bound
	});
});

describe('poll responses', () => {
	const target = { id: 'poll1', pubkey: ALICE, kind: ChatKinds.Poll };

	it('round-trips through the parser', () => {
		const tags = createPollResponseTags(target, ['0', '1']);
		expect(getMessagePollResponseReference(ChatKinds.PollResponse, tags)).toEqual({
			targetId: 'poll1',
			optionIds: ['0', '1']
		});
	});

	it('rejects empty and duplicate selections on send', () => {
		expect(() => createPollResponseTags(target, [])).toThrow(/selection/);
		expect(() => createPollResponseTags(target, ['0', '0'])).toThrow(/selection/);
	});

	it('rejects malformed responses on parse', () => {
		expect(getMessagePollResponseReference(ChatKinds.PollResponse, [])).toBeNull();
		expect(getMessagePollResponseReference(ChatKinds.PollResponse, [['e', 'poll1']])).toBeNull(); // no response tag
		expect(
			getMessagePollResponseReference(ChatKinds.PollResponse, [
				['e', 'poll1'],
				['response', 'bad id!']
			])
		).toBeNull();
	});
});

describe('buildPollTally', () => {
	it('projects one vote per account, latest response wins', () => {
		const tally = buildPollTally(
			[
				pollMessage('poll1'),
				voteMessage('v1', ALICE, ['0'], { createdAt: 150 }),
				voteMessage('v2', ALICE, ['1'], { createdAt: 160 }), // re-vote
				voteMessage('v3', BOB, ['1'], { createdAt: 155 })
			],
			'poll1',
			ME,
			170
		);
		expect(tally?.options).toEqual([
			{ id: '0', label: 'Yay', votes: 0 },
			{ id: '1', label: 'Nay', votes: 2 }
		]);
		expect(tally?.participants).toBe(2);
		expect(tally?.open).toBe(true);
	});

	it('breaks same-second ties on cursor (multi-device same account)', () => {
		const tally = buildPollTally(
			[
				pollMessage('poll1'),
				voteMessage('v1', ME, ['0'], { createdAt: 150, cursor: 5 }),
				voteMessage('v2', ME, ['1'], { createdAt: 150, cursor: 9 })
			],
			'poll1',
			ME,
			170
		);
		expect(tally?.participants).toBe(1);
		expect(tally?.selection).toEqual(['1']);
		expect(tally?.options.map((option) => option.votes)).toEqual([0, 1]);
	});

	it('ignores responses outside the poll window or with invalid selections', () => {
		const withDeadline = pollMessage('poll1', {
			tags: createPollMessageTags(draft({ endsAt: 200 }), 100)
		});
		const tally = buildPollTally(
			[
				withDeadline,
				voteMessage('early', ALICE, ['0'], { createdAt: 99 }), // before the poll
				voteMessage('late', BOB, ['0'], { createdAt: 201 }), // after endsAt
				voteMessage('multi', ME, ['0', '1'], { createdAt: 150 }), // singlechoice violation
				voteMessage('unknown', 'c'.repeat(64), ['7'], { createdAt: 150 }) // no such option
			],
			'poll1',
			ME,
			250
		);
		expect(tally?.participants).toBe(0);
		expect(tally?.selection).toEqual([]);
		expect(tally?.open).toBe(false);
	});

	it('accepts multi selections for multiplechoice polls and orders votes deterministically', () => {
		const tally = buildPollTally(
			[
				pollMessage('poll1', {
					tags: createPollMessageTags(draft({ pollType: 'multiplechoice' }))
				}),
				voteMessage('v1', BOB, ['0', '1'], { createdAt: 150 }),
				voteMessage('v2', ALICE, ['1'], { createdAt: 150 })
			],
			'poll1',
			ME,
			170
		);
		expect(tally?.options.map((option) => option.votes)).toEqual([1, 2]);
		expect(tally?.votes.map((vote) => vote.voter)).toEqual([ALICE, BOB]);
	});

	it('returns null for missing or unsupported polls', () => {
		expect(buildPollTally([pollMessage('poll1')], 'other', ME)).toBeNull();
		const broken = message({
			id: 'poll1',
			kind: ChatKinds.Poll,
			content: 'Q?',
			tags: [['option', '0']]
		});
		expect(buildPollTally([broken], 'poll1', ME)).toBeNull();
	});
});
