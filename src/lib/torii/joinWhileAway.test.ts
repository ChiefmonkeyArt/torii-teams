import { describe, expect, test } from 'vitest';
import type { NostrEvent } from 'nostr-tools';
import type { JoinCard } from './continuumApi';
import {
	CARD_MIN_MS,
	JoinWhileAway,
	MAX_TRIES,
	RETRY_PAUSE_MS,
	type JoinDeps
} from './joinWhileAway';

const proof = { id: 'p', sig: 's' } as NostrEvent;

function setup(over: Partial<JoinDeps> = {}) {
	const log: string[] = [];
	let t = 1_000_000;
	const facts = new Map<string, { epoch: bigint; transcriptHash: string }>();
	let card: JoinCard | null = {
		groupId: 'g1',
		epoch: 4n,
		groupInfo: 'AAAA',
		history: { '4': 'h4' },
		proof
	};
	const deps: JoinDeps = {
		card: async () => card,
		put: async (slug, c) => {
			log.push(`put ${slug} ${c.groupId} ${c.epoch} ${c.transcriptHash}`);
			return true;
		},
		exportInfo: async (gid) => `info-${gid}`,
		facts: (gid) => facts.get(gid) ?? null,
		join: async () => {
			facts.set('g1', { epoch: 5n, transcriptHash: 'mine' });
			return { groupId: 'g1', epoch: 5n, transcriptHash: 'mine' };
		},
		drop: (gid) => {
			facts.delete(gid);
			log.push(`drop ${gid}`);
		},
		now: () => t,
		...over
	};
	return {
		j: new JoinWhileAway(deps),
		log,
		facts,
		setCard: (c: JoinCard | null) => (card = c),
		tick: (ms: number) => (t += ms)
	};
}

describe('members keep the join card current', () => {
	test('uploads once per epoch, again after it moves', async () => {
		const s = setup();
		s.facts.set('g1', { epoch: 2n, transcriptHash: 'aa' });
		expect(await s.j.publish('site', 'g1')).toBe(true);
		expect(await s.j.publish('site', 'g1')).toBe(false);
		s.facts.set('g1', { epoch: 3n, transcriptHash: 'bb' });
		expect(await s.j.publish('site', 'g1')).toBe(true);
		expect(s.log).toEqual(['put site g1 2 aa', 'put site g1 3 bb']);
	});

	test('not for a chat we are not in', async () => {
		const s = setup();
		expect(await s.j.publish('site', 'nope')).toBe(false);
		expect(s.log).toEqual([]);
	});
});

describe('a newcomer lets themselves in', () => {
	test('joins, holds back uploads, then confirms from the history', async () => {
		const s = setup();
		expect(await s.j.tryJoin('site', 'g1')).toBe('joined');
		expect(s.j.isPending('site')).toBe(true);
		expect(await s.j.publish('site', 'g1')).toBe(false);
		expect(await s.j.confirm('site')).toBe('waiting');
		s.setCard({ groupId: 'g1', epoch: 5n, groupInfo: 'B', history: { '5': 'mine' }, proof });
		expect(await s.j.confirm('site')).toBe('confirmed');
		expect(await s.j.publish('site', 'g1')).toBe(true);
	});

	test('an unconfirmed join survives a reload', async () => {
		let saved = {};
		const s = setup({ remember: (p) => (saved = p) });
		await s.j.tryJoin('site', 'g1');
		expect(saved).toEqual({ site: { groupId: 'g1', epoch: '5', transcriptHash: 'mine' } });
		const s2 = setup();
		const again = new JoinWhileAway(
			{
				...(s2.j as unknown as { deps: JoinDeps }).deps,
				facts: () => ({ epoch: 5n, transcriptHash: 'mine' })
			},
			saved
		);
		expect(again.isPending('site')).toBe(true);
		expect(await again.publish('site', 'g1')).toBe(false);
	});

	test('a later epoch on our side also confirms', async () => {
		const s = setup();
		await s.j.tryJoin('site', 'g1');
		s.facts.set('g1', { epoch: 6n, transcriptHash: 'x' });
		expect(await s.j.confirm('site')).toBe('confirmed');
	});

	test('losing the race drops the group; three losses pause', async () => {
		const s = setup();
		for (let i = 0; i < MAX_TRIES; i++) {
			s.setCard({ groupId: 'g1', epoch: 4n, groupInfo: 'A', history: {}, proof });
			expect(await s.j.tryJoin('site', 'g1')).toBe('joined');
			s.setCard({ groupId: 'g1', epoch: 5n, groupInfo: 'B', history: { '5': 'theirs' }, proof });
			expect(await s.j.confirm('site')).toBe('lost');
		}
		expect(s.log.filter((l) => l === 'drop g1')).toHaveLength(MAX_TRIES);
		expect(await s.j.tryJoin('site', 'g1')).toBe('paused');
		s.tick(RETRY_PAUSE_MS + 1);
		expect(await s.j.tryJoin('site', 'g1')).toBe('joined');
	});

	test('no card yet backs off', async () => {
		const s = setup();
		s.setCard(null);
		expect(await s.j.tryJoin('site', 'g1')).toBe('no-card');
		expect(await s.j.tryJoin('site', 'g1')).toBe('paused');
		s.tick(CARD_MIN_MS + 1);
		expect(await s.j.tryJoin('site', 'g1')).toBe('no-card');
		s.tick(CARD_MIN_MS + 1);
		expect(await s.j.tryJoin('site', 'g1')).toBe('paused');
	});

	test('refuses a card for another chat or without proof', async () => {
		const s = setup();
		expect(await s.j.tryJoin('site', 'other')).toBe('wrong-group');
		s.setCard({ groupId: 'g1', epoch: 4n, groupInfo: 'A', history: {}, proof: null });
		expect(await s.j.tryJoin('site', 'g1')).toBe('no-proof');
	});

	test('a failed join counts as a try', async () => {
		const s = setup({
			join: async () => {
				throw new Error('post failed');
			}
		});
		for (let i = 0; i < MAX_TRIES; i++) expect(await s.j.tryJoin('site', 'g1')).toBe('failed');
		expect(await s.j.tryJoin('site', 'g1')).toBe('paused');
	});
});
