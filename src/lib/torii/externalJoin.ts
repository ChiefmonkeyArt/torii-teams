// Joining while the owner is away (ADR 0011). A newcomer's own client joins
// the project chat with an MLS external commit built from the GroupInfo the
// members keep on the node. The commit carries a proof in its authenticated
// data; every member checks it here, using only the commit and the group's
// own state, so all clients reach the same answer.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { verifyEvent, type NostrEvent } from 'nostr-tools/pure';
import {
	base64ToBytes,
	bytesToBase64,
	createGroupInfoWithExternalPubAndRatchetTree,
	defaultProposalTypes,
	encode,
	joinGroupExternal,
	mlsMessageDecoder,
	mlsMessageEncoder,
	protocolVersions,
	senderTypes,
	unsafeTestingAuthenticationService,
	wireformats,
	type ClientState,
	type GroupInfo,
	type IncomingMessageCallback,
	type KeyPackage,
	type MlsMessage,
	type PrivateKeyPackage
} from 'ts-mls';

import {
	decryptGroupPayloadWithKeyBase64,
	encryptGroupPayloadWithKeyBase64
} from '$lib/services/chatGroupPayloadCrypto';
import { getCordnCipherSuite, getCordnGroupMetadataExtension } from '$lib/services/chatMlsUtils';
import { safeNormalizePubKey } from '$lib/utils';

export const ROSTER_KIND = 30098;
export const GRANT_KIND = 27098;
/** "This new leaf is me": signed by the newcomer, never published. */
import { JOIN_BINDING_KIND } from './signerPermissions';
export { JOIN_BINDING_KIND };

const PROOF_PREFIX = 'torii-join/1\n';
const FLOOR_PREFIX = 'torii:floor=';
/** Signed events are small; anything bigger is not a proof. */
const MAX_PROOF_BYTES = 16 * 1024;

export interface JoinProof {
	/** The owner-signed roster (30098) or straight-in grant (27098). */
	allow: NostrEvent;
	/** Kind 27099 by the newcomer: group, epoch and new leaf key. */
	binding: NostrEvent;
}

export function encodeJoinProof(proof: JoinProof): Uint8Array {
	return utf8ToBytes(PROOF_PREFIX + JSON.stringify({ allow: proof.allow, binding: proof.binding }));
}

export function decodeJoinProof(bytes: Uint8Array | undefined): JoinProof | null {
	if (!bytes || bytes.length > MAX_PROOF_BYTES) return null;
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
	if (!text.startsWith(PROOF_PREFIX)) return null;
	try {
		const raw = JSON.parse(text.slice(PROOF_PREFIX.length)) as Partial<JoinProof>;
		if (!isEventShape(raw?.allow) || !isEventShape(raw?.binding)) return null;
		return { allow: raw.allow, binding: raw.binding };
	} catch {
		return null;
	}
}

function isEventShape(e: unknown): e is NostrEvent {
	const v = e as NostrEvent | undefined;
	return (
		!!v &&
		typeof v.id === 'string' &&
		typeof v.pubkey === 'string' &&
		typeof v.sig === 'string' &&
		typeof v.content === 'string' &&
		Number.isInteger(v.kind) &&
		Number.isInteger(v.created_at) &&
		Array.isArray(v.tags) &&
		v.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))
	);
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

function oneTag(e: NostrEvent, name: string): string | null {
	const all = e.tags.filter((t) => t[0] === name);
	return all.length === 1 && typeof all[0][1] === 'string' ? all[0][1] : null;
}

// ── Member-list floor (ADR 0011 §4) ─────────────────────────────────────────
// Kept as one word in the group description, beside `torii:project=<slug>`, so
// it lives in the group's own state without a new MLS extension (old leaves
// would not list a new extension type, and MLS refuses unsupported ones).

export function readFloor(description: string | undefined): number {
	for (const word of (description ?? '').split(/\s+/)) {
		if (word.startsWith(FLOOR_PREFIX)) {
			const n = Number(word.slice(FLOOR_PREFIX.length));
			if (Number.isSafeInteger(n) && n > 0) return n;
		}
	}
	return 0;
}

export function withFloor(description: string | undefined, floor: number): string {
	const words = (description ?? '').split(/\s+/).filter((w) => w && !w.startsWith(FLOOR_PREFIX));
	if (Number.isSafeInteger(floor) && floor > 0) words.push(FLOOR_PREFIX + floor);
	return words.join(' ');
}

// ── The check every member runs (ADR 0011 §3) ───────────────────────────────

export interface JoinCheckGroup {
	groupId: string;
	epoch: bigint;
	/** Group name: the project slug. */
	name: string | undefined;
	description: string | undefined;
	/** `adminPubkeys[0]`: the owner. */
	adminPubkey: string | undefined;
}

export interface JoinCheckCommit {
	joinerPubkey: string | null;
	leafKeyHex: string;
	authenticatedData: Uint8Array | undefined;
}

export type JoinVerdict = { ok: true; via: 'roster' | 'grant' } | { ok: false; reason: string };

export function verifyExternalJoin(group: JoinCheckGroup, commit: JoinCheckCommit): JoinVerdict {
	const no = (reason: string): JoinVerdict => ({ ok: false, reason });
	const owner = safeNormalizePubKey(group.adminPubkey ?? '');
	const joiner = safeNormalizePubKey(commit.joinerPubkey ?? '');
	if (!owner) return no('group has no admin');
	if (!joiner) return no('joiner has no valid identity');
	if (!group.name) return no('group has no project name');
	const proof = decodeJoinProof(commit.authenticatedData);
	if (!proof) return no('no join proof');
	const { allow, binding } = proof;

	// "This leaf is me", for this group and this epoch.
	if (binding.kind !== JOIN_BINDING_KIND || binding.pubkey !== joiner || !verified(binding)) {
		return no('bad binding signature');
	}
	if (
		oneTag(binding, 'group') !== group.groupId ||
		oneTag(binding, 'epoch') !== group.epoch.toString() ||
		oneTag(binding, 'leaf') !== commit.leafKeyHex
	) {
		return no('binding is for another join');
	}

	// "Who let me in": signed by the owner, for this project, after the floor.
	if (allow.pubkey !== owner || !verified(allow)) return no('not signed by the owner');
	if (allow.created_at < readFloor(group.description))
		return no('older than the member-list floor');
	if (allow.kind === ROSTER_KIND) {
		if (oneTag(allow, 'd') !== group.name) return no('roster is for another project');
		const listed = allow.tags.some((t) => t[0] === 'p' && t[1] === joiner);
		return listed ? { ok: true, via: 'roster' } : no('not on the signed member list');
	}
	if (allow.kind === GRANT_KIND) {
		if (oneTag(allow, 'project') !== group.name) return no('grant is for another project');
		return { ok: true, via: 'grant' };
	}
	return no('unknown proof kind');
}

/** A commit from a new member may only carry its ExternalInit (ADR 0011 §3.6). */
export function onlyExternalInit(proposals: { proposal: { proposalType: number } }[]): boolean {
	return (
		proposals.length === 1 &&
		proposals[0].proposal.proposalType === defaultProposalTypes.external_init
	);
}

/** The joiner's identity, new leaf key and proof, when `message` is an external
 *  commit; null for anything else. */
export function inspectExternalCommit(message: MlsMessage): JoinCheckCommit | null {
	if (message.wireformat !== wireformats.mls_public_message || !('publicMessage' in message)) {
		return null;
	}
	const content = message.publicMessage.content;
	if (content.sender.senderType !== senderTypes.new_member_commit) return null;
	if (content.contentType !== 3 || !('commit' in content)) return null;
	const leaf = content.commit.path?.leafNode;
	const credential = leaf?.credential as { identity?: Uint8Array } | undefined;
	let joinerPubkey: string | null = null;
	if (credential?.identity) {
		joinerPubkey = safeNormalizePubKey(new TextDecoder().decode(credential.identity));
	}
	return {
		joinerPubkey,
		leafKeyHex: leaf ? bytesToHex(leaf.signaturePublicKey) : '',
		authenticatedData: content.authenticatedData
	};
}

/** The facts `verifyExternalJoin` needs, read from a member's own state. */
export function joinCheckGroupOf(state: ClientState): JoinCheckGroup {
	const meta = getCordnGroupMetadataExtension(state);
	return {
		groupId: new TextDecoder().decode(state.groupContext.groupId),
		epoch: state.groupContext.epoch,
		name: meta?.name,
		description: meta?.description,
		adminPubkey: meta?.adminPubkeys?.[0]
	};
}

/**
 * Wrap a processing callback so a commit from a new member is accepted only
 * with a valid proof and nothing but its ExternalInit. Everything else goes to
 * `inner` (the admin policy) unchanged. Applies on every path that processes
 * an MLS message, so an external commit can never skip the check.
 */
export function gateExternalJoin(
	state: ClientState,
	message: MlsMessage,
	inner: IncomingMessageCallback | undefined
): IncomingMessageCallback | undefined {
	const commit = inspectExternalCommit(message);
	if (!commit) return inner;
	const verdict = verifyExternalJoin(joinCheckGroupOf(state), commit);
	return (incoming) => {
		if (incoming.kind === 'commit' && incoming.senderLeafIndex === undefined) {
			return verdict.ok && onlyExternalInit(incoming.proposals) ? 'accept' : 'reject';
		}
		return inner ? inner(incoming) : 'accept';
	};
}

// ── Join seal (ADR 0011 §5) ─────────────────────────────────────────────────

/** A key the joiner (from the GroupInfo) and every member (from their state)
 *  both derive for the epoch being joined. */
export function joinSealKey(context: {
	groupId: Uint8Array;
	epoch: bigint;
	confirmedTranscriptHash: Uint8Array;
}): Uint8Array {
	const epoch = new Uint8Array(8);
	new DataView(epoch.buffer).setBigUint64(0, context.epoch);
	return sha256(
		concatBytes(
			utf8ToBytes('torii-join-seal/1'),
			sha256(context.groupId),
			epoch,
			context.confirmedTranscriptHash
		)
	);
}

/** Seal a join commit for the epoch in `context`. */
export function sealJoinCommit(
	context: Parameters<typeof joinSealKey>[0],
	commitBase64: string
): string {
	return encryptGroupPayloadWithKeyBase64(joinSealKey(context), commitBase64);
}

/** Open a payload sealed with the join key for `state`'s epoch; null unless it
 *  opens AND is an external commit (nothing else may use this seal). */
export function openJoinSeal(state: ClientState, sealedBase64: string): string | null {
	try {
		const opened = decryptGroupPayloadWithKeyBase64(
			bytesToBase64(joinSealKey(state.groupContext)),
			sealedBase64
		);
		if (opened === null) return null;
		const message = mlsMessageDecoder(base64ToBytes(opened), 0)?.[0];
		return message && inspectExternalCommit(message) ? opened : null;
	} catch {
		// Anything odd (a state without a transcript yet, junk) is "not a join".
		return null;
	}
}

// ── GroupInfo on the node (ADR 0011 §1) ─────────────────────────────────────

export async function exportGroupInfoBase64(state: ClientState): Promise<string> {
	const cipherSuite = await getCordnCipherSuite();
	const groupInfo = await createGroupInfoWithExternalPubAndRatchetTree(state, [], cipherSuite);
	return bytesToBase64(
		encode(mlsMessageEncoder, {
			version: protocolVersions.mls10,
			wireformat: wireformats.mls_group_info,
			groupInfo
		})
	);
}

export function decodeGroupInfoBase64(b64: string): GroupInfo | null {
	try {
		const decoded = mlsMessageDecoder(base64ToBytes(b64), 0);
		const message = decoded?.[0];
		if (!message || message.wireformat !== wireformats.mls_group_info) return null;
		return 'groupInfo' in message ? message.groupInfo : null;
	} catch {
		return null;
	}
}

export function groupIdOf(groupInfo: GroupInfo): string {
	return new TextDecoder().decode(groupInfo.groupContext.groupId);
}

export function bindingTemplate(params: {
	groupId: string;
	epoch: bigint;
	leafKeyHex: string;
	now?: number;
}) {
	return {
		kind: JOIN_BINDING_KIND,
		created_at: params.now ?? Math.floor(Date.now() / 1000),
		content: '',
		tags: [
			['group', params.groupId],
			['epoch', params.epoch.toString()],
			['leaf', params.leafKeyHex]
		]
	};
}

/** Build the external commit. `sign` signs the binding (the newcomer's one
 *  Allow). Returns the new state and the plain MLS commit (base64); the caller
 *  seals it with `joinSealKey(groupInfo.groupContext)`. */
export async function createExternalJoin(params: {
	groupInfo: GroupInfo;
	keyPackage: KeyPackage;
	privateKeys: PrivateKeyPackage;
	allow: NostrEvent;
	sign: (template: ReturnType<typeof bindingTemplate>) => Promise<NostrEvent>;
}): Promise<{ state: ClientState; commitBase64: string }> {
	const cipherSuite = await getCordnCipherSuite();
	const binding = await params.sign(
		bindingTemplate({
			groupId: groupIdOf(params.groupInfo),
			epoch: params.groupInfo.groupContext.epoch,
			leafKeyHex: bytesToHex(params.keyPackage.leafNode.signaturePublicKey)
		})
	);
	const { publicMessage, newState } = await joinGroupExternal({
		context: { cipherSuite, authService: unsafeTestingAuthenticationService },
		groupInfo: params.groupInfo,
		keyPackage: params.keyPackage,
		privateKeys: params.privateKeys,
		resync: false,
		authenticatedData: encodeJoinProof({ allow: params.allow, binding })
	});
	return {
		state: newState,
		commitBase64: bytesToBase64(
			encode(mlsMessageEncoder, {
				version: protocolVersions.mls10,
				wireformat: wireformats.mls_public_message,
				publicMessage
			})
		)
	};
}
