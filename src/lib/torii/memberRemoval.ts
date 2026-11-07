// Removing people while the owner is away (ADR 0012 §2). A member's client may
// commit a Remove for someone the owner's newest signed member list leaves
// out, carrying that list as proof. Every member checks it here, using only
// the commit and the group's own state, so all clients reach the same answer.
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { verifyEvent, type NostrEvent } from 'nostr-tools/pure';
import {
	defaultProposalTypes,
	wireformats,
	type ClientState,
	type IncomingMessageCallback,
	type MlsMessage,
	type Proposal
} from 'ts-mls';

import { listGroupMembers } from '$lib/services/chatAdminPolicy';
import {
	CORDN_GROUP_METADATA_EXTENSION_TYPE,
	getCordnGroupMetadataExtension,
	getCordnGroupMetadataFromExtensions,
	makeCordnGroupMetadataExtension,
	type CordnGroupMetadata
} from '$lib/services/chatMlsUtils';
import { safeNormalizePubKey } from '$lib/utils';

import { readFloor, ROSTER_KIND, withFloor } from './externalJoin';

const PROOF_PREFIX = 'torii-remove/1\n';
/** A roster of 64 people is about 6 KB; anything much bigger is not one. */
const MAX_PROOF_BYTES = 16 * 1024;

export function encodeRemovalProof(roster: NostrEvent): Uint8Array {
	return utf8ToBytes(
		PROOF_PREFIX +
			JSON.stringify({
				id: roster.id,
				pubkey: roster.pubkey,
				created_at: roster.created_at,
				kind: roster.kind,
				tags: roster.tags,
				content: roster.content,
				sig: roster.sig
			})
	);
}

export function decodeRemovalProof(bytes: Uint8Array | undefined): NostrEvent | null {
	if (!bytes || bytes.length === 0 || bytes.length > MAX_PROOF_BYTES) return null;
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
	if (!text.startsWith(PROOF_PREFIX)) return null;
	try {
		const e = JSON.parse(text.slice(PROOF_PREFIX.length)) as NostrEvent;
		const ok =
			!!e &&
			typeof e.id === 'string' &&
			typeof e.pubkey === 'string' &&
			typeof e.sig === 'string' &&
			typeof e.content === 'string' &&
			Number.isInteger(e.kind) &&
			Number.isInteger(e.created_at) &&
			Array.isArray(e.tags) &&
			e.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'));
		return ok ? e : null;
	} catch {
		return null;
	}
}

function verified(e: NostrEvent): boolean {
	try {
		// A fresh object: nostr-tools caches the verdict on the event itself.
		return verifyEvent({
			id: e.id,
			pubkey: e.pubkey,
			created_at: e.created_at,
			kind: e.kind,
			tags: e.tags,
			content: e.content,
			sig: e.sig
		});
	} catch {
		return false;
	}
}

/** Pubkeys a roster event lists (`p` tags), plus its signer (the owner). */
export function rosterListed(roster: NostrEvent): Set<string> {
	const out = new Set<string>([roster.pubkey]);
	for (const t of roster.tags) if (t[0] === 'p' && typeof t[1] === 'string') out.add(t[1]);
	return out;
}

/** Structural equality for decoded MLS values (Uint8Array, bigint, arrays, objects). */
export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a instanceof Uint8Array || b instanceof Uint8Array) {
		if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length)
			return false;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	}
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a as object).filter(
		(k) => (a as Record<string, unknown>)[k] !== undefined
	);
	const kb = Object.keys(b as object).filter(
		(k) => (b as Record<string, unknown>)[k] !== undefined
	);
	if (ka.length !== kb.length) return false;
	return ka.every((k) =>
		sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
	);
}

const sameMeta = (a: CordnGroupMetadata | undefined, b: CordnGroupMetadata | undefined) =>
	!!a &&
	!!b &&
	a.name === b.name &&
	(a.icon ?? '') === (b.icon ?? '') &&
	(a.imageUrl ?? '') === (b.imageUrl ?? '') &&
	sameValue(a.adminPubkeys ?? [], b.adminPubkeys ?? []);

interface ProposalLike {
	proposal: {
		proposalType: number;
		remove?: { removed: number };
		groupContextExtensions?: { extensions: { extensionType: number }[] };
	};
}

export type RemovalVerdict = { ok: true; removed: string[] } | { ok: false; reason: string };

/**
 * ADR 0012 §2: may this non-admin commit stand? `state` is the receiver's
 * state before the commit; `committer` the sender's stable pubkey.
 */
export function verifyMemberRemoval(
	state: ClientState,
	committer: string | undefined,
	proposals: ProposalLike[],
	authenticatedData: Uint8Array | undefined
): RemovalVerdict {
	const no = (reason: string): RemovalVerdict => ({ ok: false, reason });
	const meta = getCordnGroupMetadataExtension(state);
	const owner = safeNormalizePubKey(meta?.adminPubkeys?.[0] ?? '');
	const me = safeNormalizePubKey(committer ?? '');
	if (!owner || !meta?.name) return no('group has no admin or name');
	if (!me) return no('committer unknown');
	const roster = decodeRemovalProof(authenticatedData);
	if (!roster) return no('no removal proof');
	if (roster.kind !== ROSTER_KIND || roster.pubkey !== owner || !verified(roster))
		return no('not signed by the owner');
	const d = roster.tags.filter((t) => t[0] === 'd');
	if (d.length !== 1 || d[0][1] !== meta.name) return no('roster is for another project');
	const floor = readFloor(meta.description);
	if (roster.created_at < floor) return no('older than the member-list floor');
	const listed = rosterListed(roster);
	if (!listed.has(me)) return no('committer is not on the signed list');

	const members = listGroupMembers(state);
	const removed: string[] = [];
	let settings: ProposalLike['proposal'] | null = null;
	for (const { proposal } of proposals) {
		if (proposal.proposalType === defaultProposalTypes.remove && proposal.remove) {
			const who = members.find((m) => m.leafIndex === proposal.remove!.removed)?.stablePubkey;
			if (!who) return no('removes an unknown leaf');
			if (who === owner || who === me || listed.has(who))
				return no('removes someone the list keeps');
			removed.push(who);
		} else if (proposal.proposalType === defaultProposalTypes.group_context_extensions) {
			if (settings) return no('more than one settings change');
			settings = proposal;
		} else {
			return no('only removals are allowed');
		}
	}
	if (!removed.length) return no('removes nobody');

	const needsFloor = floor < roster.created_at;
	if (!settings) return needsFloor ? no('must raise the floor') : { ok: true, removed };
	if (!needsFloor) return no('settings change not needed');
	const next = settings.groupContextExtensions?.extensions ?? [];
	const nextMeta = getCordnGroupMetadataSafe(next);
	if (!sameMeta(meta, nextMeta)) return no('changes group settings');
	if ((nextMeta?.description ?? '') !== withFloor(meta.description, roster.created_at))
		return no('sets another floor');
	const others = (list: { extensionType: number }[]) =>
		list.filter((e) => e.extensionType !== CORDN_GROUP_METADATA_EXTENSION_TYPE);
	if (!sameValue(others(state.groupContext.extensions), others(next)))
		return no('changes other extensions');
	return { ok: true, removed };
}

function getCordnGroupMetadataSafe(
	extensions: { extensionType: number }[]
): CordnGroupMetadata | undefined {
	try {
		return getCordnGroupMetadataFromExtensions(
			extensions as Parameters<typeof getCordnGroupMetadataFromExtensions>[0]
		);
	} catch {
		return undefined;
	}
}

/** The authenticated data of a framed message (public or private). */
export function authenticatedDataOf(message: MlsMessage): Uint8Array | undefined {
	if (message.wireformat === wireformats.mls_private_message && 'privateMessage' in message)
		return message.privateMessage.authenticatedData;
	if (message.wireformat === wireformats.mls_public_message && 'publicMessage' in message)
		return message.publicMessage.content.authenticatedData;
	return undefined;
}

/**
 * Wrap a processing callback so a member's commit with a valid removal proof
 * is accepted where the admin policy would reject it. Only "reject" can turn
 * into "accept"; `inner` always runs first (sibling-skip, join check).
 */
export function gateMemberRemoval(
	state: ClientState,
	message: MlsMessage,
	inner: IncomingMessageCallback | undefined
): IncomingMessageCallback | undefined {
	const aad = authenticatedDataOf(message);
	if (!inner || !decodeRemovalProof(aad)) return inner;
	return (incoming) => {
		const verdict = inner(incoming);
		if (verdict !== 'reject' || incoming.kind !== 'commit') return verdict;
		if (incoming.senderLeafIndex === undefined) return verdict;
		const sender = listGroupMembers(state).find((m) => m.leafIndex === incoming.senderLeafIndex);
		const check = verifyMemberRemoval(state, sender?.stablePubkey, incoming.proposals, aad);
		return check.ok ? 'accept' : verdict;
	};
}

/**
 * The proposals and proof for removing `removedLeafIndex` with `roster`: the
 * Remove, plus the floor change when the floor is lower than the roster.
 * Runs the receivers' own check first and throws if it would fail, so a
 * client never posts a commit the others would skip.
 */
export function memberRemovalCommit(
	state: ClientState,
	removedLeafIndex: number,
	roster: NostrEvent,
	committer: string
): { proposals: Proposal[]; authenticatedData: Uint8Array } {
	const meta = getCordnGroupMetadataExtension(state);
	const proposals: Proposal[] = [
		{ proposalType: defaultProposalTypes.remove, remove: { removed: removedLeafIndex } }
	];
	if (meta && readFloor(meta.description) < roster.created_at) {
		proposals.push({
			proposalType: defaultProposalTypes.group_context_extensions,
			groupContextExtensions: {
				extensions: [
					...state.groupContext.extensions.filter(
						(e) => e.extensionType !== CORDN_GROUP_METADATA_EXTENSION_TYPE
					),
					makeCordnGroupMetadataExtension({
						...meta,
						description: withFloor(meta.description, roster.created_at)
					})
				]
			}
		});
	}
	const authenticatedData = encodeRemovalProof(roster);
	const verdict = verifyMemberRemoval(
		state,
		committer,
		proposals.map((proposal) => ({ proposal }) as ProposalLike),
		authenticatedData
	);
	if (!verdict.ok) throw new Error(`Removal not allowed: ${verdict.reason}`);
	return { proposals, authenticatedData };
}

// ── Who acts (ADR 0012 §2, proposer side) ───────────────────────────────────

export const REMOVE_GRACE_MS = 2 * 60 * 1000;
export const REMOVE_STEP_MS = 60 * 1000;
export const REMOVE_RETRY_MS = 10 * 60 * 1000;

export interface MemberRemovalInput {
	me: string;
	owner: string;
	/** The node's member list (signed roster plus straight-in admissions). */
	nodeMembers: readonly string[];
	/** The owner-signed roster event the node serves. */
	roster: NostrEvent | null;
	groupMembers: readonly string[];
	/** Group description (for the floor). */
	description: string | undefined;
	attemptedAt?: Readonly<Record<string, number>>;
	now: number;
}

/** People this member's client should remove now (usually none). */
export function planMemberRemoval(input: MemberRemovalInput): string[] {
	const { me, owner, roster, groupMembers, now } = input;
	if (me === owner || !roster || roster.pubkey !== owner || roster.kind !== ROSTER_KIND) return [];
	if (roster.created_at < readFloor(input.description)) return [];
	const listed = rosterListed(roster);
	if (!listed.has(me)) return [];
	const onNode = new Set(input.nodeMembers);
	const gone = groupMembers.filter(
		(pk) => pk !== me && pk !== owner && !onNode.has(pk) && !listed.has(pk)
	);
	if (!gone.length || gone.length > Math.floor(groupMembers.length / 2)) return [];
	// Stagger: the owner first, then members in pubkey order.
	const staying = groupMembers.filter((pk) => pk !== owner && !gone.includes(pk)).sort();
	const rank = Math.max(0, staying.indexOf(me));
	if (now < roster.created_at * 1000 + REMOVE_GRACE_MS + rank * REMOVE_STEP_MS) return [];
	const attempted = input.attemptedAt ?? {};
	return gone.filter((pk) => now - (attempted[pk] ?? -Infinity) >= REMOVE_RETRY_MS);
}
