import { describe, expect, test } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
	base64ToBytes,
	createGroup,
	defaultProposalTypes,
	generateKeyPackage,
	mlsMessageDecoder,
	processMessage,
	unsafeTestingAuthenticationService,
	type ClientState
} from 'ts-mls';

import { createAdminAuthorizationCallback, listGroupMembers } from '$lib/services/chatAdminPolicy';
import {
	createCordnMetadataCapabilities,
	createCredential,
	getCordnCipherSuite,
	getCordnGroupMetadataExtension,
	makeCordnGroupMetadataExtension,
	removeMemberFromGroup
} from '$lib/services/chatMlsUtils';
import {
	createExternalJoin,
	decodeGroupInfoBase64,
	exportGroupInfoBase64,
	gateExternalJoin,
	readFloor,
	ROSTER_KIND
} from './externalJoin';
import {
	authenticatedDataOf,
	decodeRemovalProof,
	encodeRemovalProof,
	gateMemberRemoval,
	memberRemovalCommit,
	planMemberRemoval,
	REMOVE_GRACE_MS,
	REMOVE_STEP_MS,
	sameValue,
	verifyMemberRemoval
} from './memberRemoval';

const key = () => {
	const sk = generateSecretKey();
	return { sk, pk: getPublicKey(sk) };
};
const O = key(); // owner
const A = key(); // a teammate who stays
const X = key(); // the person the owner removed
const now = Math.floor(Date.now() / 1000);

function roster(members: string[], createdAt = now, slug = 'website', sk = O.sk) {
	return finalizeEvent(
		{
			kind: ROSTER_KIND,
			created_at: createdAt,
			content: '',
			tags: [['d', slug], ...members.map((m) => ['p', m, 'contributor'])]
		},
		sk
	);
}

const ctx = async () => ({
	cipherSuite: await getCordnCipherSuite(),
	authService: unsafeTestingAuthenticationService
});

async function kp(pk: string) {
	return generateKeyPackage({
		credential: createCredential(pk),
		capabilities: createCordnMetadataCapabilities(),
		cipherSuite: await getCordnCipherSuite()
	});
}

/** What every member runs: the join gate, the removal gate, the admin policy. */
function gate(state: ClientState, b64: string) {
	const message = mlsMessageDecoder(base64ToBytes(b64), 0)![0];
	const admin = createAdminAuthorizationCallback({
		state,
		metadata: getCordnGroupMetadataExtension(state)
	});
	return {
		message,
		callback: gateExternalJoin(state, message, gateMemberRemoval(state, message, admin))
	};
}

async function apply(state: ClientState, b64: string) {
	const { message, callback } = gate(state, b64);
	return (await processMessage({
		context: await ctx(),
		state,
		message: message as never,
		callback
	})) as { actionTaken: string; newState: ClientState };
}

async function selfJoin(state: ClientState, who: { sk: Uint8Array; pk: string }) {
	const groupInfo = decodeGroupInfoBase64(await exportGroupInfoBase64(state))!;
	const k = await kp(who.pk);
	return createExternalJoin({
		groupInfo,
		keyPackage: k.publicPackage,
		privateKeys: k.privatePackage,
		allow: roster([A.pk, X.pk], now - 3600),
		sign: async (t) => finalizeEvent(t, who.sk)
	});
}

/** Owner, A and X in one chat; returns each one's state. */
async function threeInChat() {
	const k = await kp(O.pk);
	let owner = await createGroup({
		context: await ctx(),
		groupId: new TextEncoder().encode('group-' + Math.random()),
		keyPackage: k.publicPackage,
		privateKeyPackage: k.privatePackage,
		extensions: [
			makeCordnGroupMetadataExtension({
				name: 'website',
				description: 'torii:project=website',
				adminPubkeys: [O.pk]
			})
		]
	});
	const a = await selfJoin(owner, A);
	owner = (await apply(owner, a.commitBase64)).newState;
	const x = await selfJoin(owner, X);
	owner = (await apply(owner, x.commitBase64)).newState;
	const aState = (await apply(a.state, x.commitBase64)).newState;
	return { owner, a: aState, x: x.state };
}

const pubkeys = (s: ClientState) => listGroupMembers(s).map((m) => m.stablePubkey);
const leafOf = (s: ClientState, pk: string) =>
	listGroupMembers(s).find((m) => m.stablePubkey === pk)!.leafIndex;

async function memberRemoves(state: ClientState, target: string, proof = roster([A.pk])) {
	const parts = memberRemovalCommit(state, leafOf(state, target), proof, A.pk);
	return removeMemberFromGroup({ state, removedLeafIndex: leafOf(state, target), ...parts });
}

describe('member removal (ADR 0012)', () => {
	test('a teammate removes someone the newest signed list leaves out; the owner accepts and the floor rises', async () => {
		const { owner, a } = await threeInChat();
		expect(pubkeys(owner).sort()).toEqual([O.pk, A.pk, X.pk].sort());
		const proof = roster([A.pk], now);
		const { commitMessageBase64, newState } = await memberRemoves(a, X.pk, proof);
		const message = mlsMessageDecoder(base64ToBytes(commitMessageBase64), 0)![0];
		expect(decodeRemovalProof(authenticatedDataOf(message))?.id).toBe(proof.id);

		const r = await apply(owner, commitMessageBase64);
		expect(r.actionTaken).toBe('accept');
		expect(pubkeys(r.newState).sort()).toEqual([O.pk, A.pk].sort());
		const meta = getCordnGroupMetadataExtension(r.newState)!;
		expect(readFloor(meta.description)).toBe(now);
		expect(meta.description).toContain('torii:project=website');
		expect(meta.adminPubkeys).toEqual([O.pk]);
		// Both sides agree on the result.
		expect(sameValue(r.newState.groupContext, newState.groupContext)).toBe(true);
	});

	test('without the proof the same removal is still an unauthorised admin action', async () => {
		const { owner, a } = await threeInChat();
		const { commitMessageBase64 } = await removeMemberFromGroup({
			state: a,
			removedLeafIndex: leafOf(a, X.pk)
		});
		const r = await apply(owner, commitMessageBase64);
		expect(r.actionTaken).toBe('reject');
		expect(pubkeys(r.newState)).toContain(X.pk);
	});

	test('the sender refuses to make a removal the others would skip', async () => {
		const { a } = await threeInChat();
		// X is still listed: not removable.
		expect(() => memberRemovalCommit(a, leafOf(a, X.pk), roster([A.pk, X.pk]), A.pk)).toThrow(
			/list keeps/
		);
		// The owner can never be removed by a member.
		expect(() => memberRemovalCommit(a, leafOf(a, O.pk), roster([A.pk]), A.pk)).toThrow(
			/list keeps/
		);
		// Signed by someone else.
		expect(() =>
			memberRemovalCommit(a, leafOf(a, X.pk), roster([A.pk], now, 'website', A.sk), A.pk)
		).toThrow(/owner/);
		// Another project's list.
		expect(() =>
			memberRemovalCommit(a, leafOf(a, X.pk), roster([A.pk], now, 'other'), A.pk)
		).toThrow(/another project/);
		// The committer must be on the list.
		expect(() => memberRemovalCommit(a, leafOf(a, X.pk), roster([]), A.pk)).toThrow(/committer/);
	});

	test('a list older than the floor cannot remove anyone', async () => {
		const { a } = await threeInChat();
		const meta = getCordnGroupMetadataExtension(a)!;
		const state = {
			...a,
			groupContext: {
				...a.groupContext,
				extensions: [
					makeCordnGroupMetadataExtension({
						...meta,
						description: `${meta.description} torii:floor=${now}`
					})
				]
			}
		} as ClientState;
		const v = verifyMemberRemoval(
			state,
			A.pk,
			[
				{
					proposal: {
						proposalType: defaultProposalTypes.remove,
						remove: { removed: leafOf(a, X.pk) }
					}
				}
			],
			encodeRemovalProof(roster([A.pk], now - 1))
		);
		expect(v).toEqual({ ok: false, reason: 'older than the member-list floor' });
	});

	test('only Removes and the exact floor change pass the check', async () => {
		const { a } = await threeInChat();
		const proof = encodeRemovalProof(roster([A.pk]));
		const remove = {
			proposal: { proposalType: defaultProposalTypes.remove, remove: { removed: leafOf(a, X.pk) } }
		};
		const meta = getCordnGroupMetadataExtension(a)!;
		const settings = (m: object) => ({
			proposal: {
				proposalType: defaultProposalTypes.group_context_extensions,
				groupContextExtensions: { extensions: [makeCordnGroupMetadataExtension({ ...meta, ...m })] }
			}
		});
		const check = (ps: object[]) => verifyMemberRemoval(a, A.pk, ps as never, proof);
		expect(check([remove])).toEqual({ ok: false, reason: 'must raise the floor' });
		expect(
			check([remove, settings({ description: `${meta.description} torii:floor=${now}` })]).ok
		).toBe(true);
		expect(
			check([remove, settings({ description: `${meta.description} torii:floor=${now + 1}` })])
		).toEqual({
			ok: false,
			reason: 'sets another floor'
		});
		expect(
			check([
				remove,
				settings({ name: 'renamed', description: `${meta.description} torii:floor=${now}` })
			])
		).toEqual({
			ok: false,
			reason: 'changes group settings'
		});
		expect(
			check([
				remove,
				settings({ adminPubkeys: [A.pk], description: `${meta.description} torii:floor=${now}` })
			])
		).toEqual({
			ok: false,
			reason: 'changes group settings'
		});
		expect(check([remove, { proposal: { proposalType: defaultProposalTypes.add } }])).toEqual({
			ok: false,
			reason: 'only removals are allowed'
		});
		expect(check([settings({ description: `${meta.description} torii:floor=${now}` })])).toEqual({
			ok: false,
			reason: 'removes nobody'
		});
		expect(verifyMemberRemoval(a, A.pk, [remove] as never, undefined)).toEqual({
			ok: false,
			reason: 'no removal proof'
		});
	});

	test('the gate never turns an accept into anything else, and leaves messages without a proof alone', async () => {
		const { a } = await threeInChat();
		const { commitMessageBase64 } = await memberRemoves(a, X.pk);
		const message = mlsMessageDecoder(base64ToBytes(commitMessageBase64), 0)![0];
		const inner = () => 'accept' as const;
		expect(
			gateMemberRemoval(a, message, inner)!({
				kind: 'commit',
				senderLeafIndex: 0,
				proposals: []
			} as never)
		).toBe('accept');
		const plain = await removeMemberFromGroup({ state: a, removedLeafIndex: leafOf(a, X.pk) });
		const plainMsg = mlsMessageDecoder(base64ToBytes(plain.commitMessageBase64), 0)![0];
		expect(gateMemberRemoval(a, plainMsg, inner)).toBe(inner);
	});

	test('proof encoding round-trips and rejects junk', () => {
		const e = roster([A.pk]);
		expect(JSON.stringify(decodeRemovalProof(encodeRemovalProof(e)))).toBe(
			JSON.stringify({
				id: e.id,
				pubkey: e.pubkey,
				created_at: e.created_at,
				kind: e.kind,
				tags: e.tags,
				content: e.content,
				sig: e.sig
			})
		);
		expect(decodeRemovalProof(new TextEncoder().encode('torii-join/1\n{}'))).toBeNull();
		expect(decodeRemovalProof(new TextEncoder().encode('torii-remove/1\nnot json'))).toBeNull();
		expect(decodeRemovalProof(new Uint8Array([0xff, 0xfe]))).toBeNull();
		expect(decodeRemovalProof(new Uint8Array(20000))).toBeNull();
	});
});

describe('who removes (ADR 0012 proposer side)', () => {
	const signed = roster([A.pk, 'c'.repeat(64)], now - 3600);
	const base = {
		me: A.pk,
		owner: O.pk,
		nodeMembers: [O.pk, A.pk, 'c'.repeat(64)],
		roster: signed,
		groupMembers: [O.pk, A.pk, 'c'.repeat(64), X.pk],
		description: 'torii:project=website',
		now: now * 1000
	};

	test('removes people off both the node list and the signed list, after the stagger', () => {
		expect(planMemberRemoval(base)).toEqual([X.pk]);
		// The owner's client never uses this path.
		expect(planMemberRemoval({ ...base, me: O.pk })).toEqual([]);
		// Too soon after the list was signed: the owner's client goes first.
		const fresh = roster([A.pk, 'c'.repeat(64)], now);
		expect(
			planMemberRemoval({ ...base, roster: fresh, now: now * 1000 + REMOVE_GRACE_MS - 1 })
		).toEqual([]);
		// Members wait their turn in pubkey order.
		const rank = [A.pk, 'c'.repeat(64)].sort().indexOf(A.pk);
		const turn = now * 1000 + REMOVE_GRACE_MS + rank * REMOVE_STEP_MS;
		expect(planMemberRemoval({ ...base, roster: fresh, now: turn })).toEqual([X.pk]);
		if (rank > 0) expect(planMemberRemoval({ ...base, roster: fresh, now: turn - 1 })).toEqual([]);
	});

	test('leaves straight-in newcomers (on the node, not yet signed) and recent attempts alone', () => {
		expect(planMemberRemoval({ ...base, nodeMembers: [...base.nodeMembers, X.pk] })).toEqual([]);
		expect(planMemberRemoval({ ...base, attemptedAt: { [X.pk]: base.now - 1000 } })).toEqual([]);
	});

	test('never empties a chat, never acts on a stale or foreign list', () => {
		expect(
			planMemberRemoval({
				...base,
				groupMembers: [...base.groupMembers, 'd'.repeat(64)],
				nodeMembers: [O.pk, A.pk],
				roster: roster([A.pk], now - 3600)
			})
		).toEqual([]);
		expect(
			planMemberRemoval({ ...base, roster: roster([A.pk], now - 3600, 'website', A.sk) })
		).toEqual([]);
		expect(
			planMemberRemoval({ ...base, description: `torii:project=website torii:floor=${now}` })
		).toEqual([]);
		expect(planMemberRemoval({ ...base, roster: roster(['c'.repeat(64)], now - 3600) })).toEqual(
			[]
		);
		expect(planMemberRemoval({ ...base, roster: null })).toEqual([]);
	});
});
