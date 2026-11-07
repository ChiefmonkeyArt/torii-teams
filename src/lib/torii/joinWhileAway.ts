// Torii Teams: join a project chat while the owner is away (ADR 0011).
// Members keep the node's join card current; a newcomer who is on the
// project but not in the chat lets themselves in from it, then waits until
// the group's history confirms their commit won its epoch.
// Everything outside is injected, so the rules are tested without a node.

import type { NostrEvent } from 'nostr-tools';
import type { JoinCard } from './continuumApi';

export interface JoinDeps {
	card(slug: string): Promise<JoinCard | null>;
	put(
		slug: string,
		card: { groupId: string; epoch: bigint; groupInfo: string; transcriptHash: string }
	): Promise<boolean>;
	exportInfo(groupId: string): Promise<string | null>;
	facts(groupId: string): { epoch: bigint; transcriptHash: string } | null;
	join(input: {
		groupInfoBase64: string;
		allow: NostrEvent;
	}): Promise<{ groupId: string; epoch: bigint; transcriptHash: string }>;
	drop(groupId: string): void;
	now(): number;
	/** Keep unconfirmed joins across reloads (a reload must not skip the check). */
	remember?(pending: Record<string, SavedPending>): void;
}

export interface SavedPending {
	groupId: string;
	epoch: string;
	transcriptHash: string;
}

/** Three tries, then a pause before the next round (ADR 0011 §2). */
export const MAX_TRIES = 3;
export const RETRY_PAUSE_MS = 10 * 60 * 1000;
/** No card yet: look again after 1 min, doubling to 30 min. */
export const CARD_MIN_MS = 60 * 1000;
export const CARD_MAX_MS = 30 * 60 * 1000;

interface Pending {
	groupId: string;
	epoch: bigint;
	transcriptHash: string;
}

export class JoinWhileAway {
	private uploaded = new Map<string, string>();
	private pending = new Map<string, Pending>();
	private tries = new Map<string, number>();
	private nextAt = new Map<string, number>();
	private wait = new Map<string, number>();

	constructor(
		private readonly deps: JoinDeps,
		saved: Record<string, SavedPending> = {}
	) {
		for (const [slug, p] of Object.entries(saved)) {
			if (p && typeof p.groupId === 'string' && /^\d{1,19}$/.test(String(p.epoch))) {
				this.pending.set(slug, {
					groupId: p.groupId,
					epoch: BigInt(p.epoch),
					transcriptHash: String(p.transcriptHash)
				});
			}
		}
	}

	private save(): void {
		const out: Record<string, SavedPending> = {};
		for (const [slug, p] of this.pending) {
			out[slug] = {
				groupId: p.groupId,
				epoch: p.epoch.toString(),
				transcriptHash: p.transcriptHash
			};
		}
		this.deps.remember?.(out);
	}

	/** True while our own join has not been confirmed yet. */
	isPending(slug: string): boolean {
		return this.pending.has(slug);
	}

	/** Member: upload the GroupInfo when the epoch moved since our last upload. */
	async publish(slug: string, groupId: string): Promise<boolean> {
		if (this.pending.has(slug)) return false;
		const facts = this.deps.facts(groupId);
		if (!facts) return false;
		const key = `${groupId}:${facts.epoch}`;
		if (this.uploaded.get(slug) === key) return false;
		const groupInfo = await this.deps.exportInfo(groupId);
		if (!groupInfo) return false;
		const stored = await this.deps.put(slug, {
			groupId,
			epoch: facts.epoch,
			groupInfo,
			transcriptHash: facts.transcriptHash
		});
		// A refusal (older epoch, other group) is final for this epoch too.
		this.uploaded.set(slug, key);
		return stored;
	}

	/**
	 * Newcomer: on the project, not in the chat. Returns what happened, so the
	 * caller can show it and fall back to the owner's Welcome.
	 */
	async tryJoin(
		slug: string,
		chatGroupId: string
	): Promise<'joined' | 'no-card' | 'paused' | 'wrong-group' | 'no-proof' | 'failed'> {
		const now = this.deps.now();
		if ((this.nextAt.get(slug) ?? 0) > now) return 'paused';
		const card = await this.deps.card(slug);
		if (!card) {
			const wait = Math.min((this.wait.get(slug) ?? CARD_MIN_MS / 2) * 2, CARD_MAX_MS);
			this.wait.set(slug, wait);
			this.nextAt.set(slug, now + wait);
			return 'no-card';
		}
		this.wait.delete(slug);
		if (card.groupId !== chatGroupId) return 'wrong-group';
		if (!card.proof) return 'no-proof';
		try {
			const joined = await this.deps.join({ groupInfoBase64: card.groupInfo, allow: card.proof });
			this.pending.set(slug, joined);
			this.save();
			return 'joined';
		} catch {
			this.countTry(slug, now);
			return 'failed';
		}
	}

	/**
	 * Did our commit win its epoch? Confirmed when the node's history for that
	 * epoch carries our transcript hash, or when we have since processed a
	 * later commit (only possible on the winning branch). Lost when the node
	 * recorded a different hash: drop the group and let the next pass retry.
	 */
	async confirm(slug: string): Promise<'confirmed' | 'lost' | 'waiting' | 'none'> {
		const p = this.pending.get(slug);
		if (!p) return 'none';
		const facts = this.deps.facts(p.groupId);
		if (!facts) {
			this.pending.delete(slug);
			this.save();
			return 'lost';
		}
		if (facts.epoch > p.epoch) return this.settle(slug);
		const card = await this.deps.card(slug).catch(() => null);
		const seen = card?.groupId === p.groupId ? card.history[p.epoch.toString()] : undefined;
		if (seen === p.transcriptHash) return this.settle(slug);
		if (seen !== undefined) {
			this.deps.drop(p.groupId);
			this.pending.delete(slug);
			this.save();
			this.countTry(slug, this.deps.now());
			return 'lost';
		}
		return 'waiting';
	}

	private settle(slug: string): 'confirmed' {
		this.pending.delete(slug);
		this.save();
		this.tries.delete(slug);
		this.nextAt.delete(slug);
		return 'confirmed';
	}

	private countTry(slug: string, now: number): void {
		const n = (this.tries.get(slug) ?? 0) + 1;
		if (n >= MAX_TRIES) {
			this.tries.delete(slug);
			this.nextAt.set(slug, now + RETRY_PAUSE_MS);
		} else {
			this.tries.set(slug, n);
		}
	}
}
