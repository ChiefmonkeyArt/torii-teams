import { describe, expect, test } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
	createGroup,
	generateKeyPackage,
	getGroupMembers,
	mlsMessageDecoder,
	base64ToBytes,
	processMessage,
	unsafeTestingAuthenticationService,
	type ClientState
} from 'ts-mls';

import {
	createCordnMetadataCapabilities,
	createCredential,
	getCordnCipherSuite,
	getCordnGroupMetadataExtension,
	makeCordnGroupMetadataExtension
} from '$lib/services/chatMlsUtils';
import {
	createExternalJoin,
	decodeGroupInfoBase64,
	decodeJoinProof,
	encodeJoinProof,
	exportGroupInfoBase64,
	gateExternalJoin,
	inspectExternalCommit,
	joinSealKey,
	openJoinSeal,
	sealJoinCommit,
	readFloor,
	verifyExternalJoin,
	withFloor,
	GRANT_KIND,
	ROSTER_KIND
} from './externalJoin';

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const joinerSk = generateSecretKey();
const joiner = getPublicKey(joinerSk);
const now = Math.floor(Date.now() / 1000);

function roster(members: string[], createdAt = now, slug = 'website', sk = ownerSk) {
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

function grant(slug = 'website', createdAt = now) {
	return finalizeEvent(
		{
			kind: GRANT_KIND,
			created_at: createdAt,
			content: '',
			tags: [
				['project', slug],
				['invite', 'abcdefabcdefabcdef'],
				['role', 'contributor'],
				['uses', '3'],
				['expiration', String(createdAt + 86400)]
			]
		},
		ownerSk
	);
}

async function ownerGroup(description = 'torii:project=website'): Promise<ClientState> {
	const cipherSuite = await getCordnCipherSuite();
	const kp = await generateKeyPackage({
		credential: createCredential(owner),
		capabilities: createCordnMetadataCapabilities(),
		cipherSuite
	});
	return createGroup({
		context: { cipherSuite, authService: unsafeTestingAuthenticationService },
		groupId: new TextEncoder().encode('group-' + Math.random()),
		keyPackage: kp.publicPackage,
		privateKeyPackage: kp.privatePackage,
		extensions: [
			makeCordnGroupMetadataExtension({ name: 'website', description, adminPubkeys: [owner] })
		]
	});
}

async function join(state: ClientState, allow = roster([joiner]), sk = joinerSk, who = joiner) {
	const cipherSuite = await getCordnCipherSuite();
	const groupInfo = decodeGroupInfoBase64(await exportGroupInfoBase64(state))!;
	const kp = await generateKeyPackage({
		credential: createCredential(who),
		capabilities: createCordnMetadataCapabilities(),
		cipherSuite
	});
	return {
		groupInfo,
		...(await createExternalJoin({
			groupInfo,
			keyPackage: kp.publicPackage,
			privateKeys: kp.privatePackage,
			allow,
			sign: async (t) => finalizeEvent(t, sk)
		}))
	};
}

function groupFacts(state: ClientState) {
	const meta = getCordnGroupMetadataExtension(state);
	return {
		groupId: new TextDecoder().decode(state.groupContext.groupId),
		epoch: state.groupContext.epoch,
		name: meta?.name,
		description: meta?.description,
		adminPubkey: meta?.adminPubkeys?.[0]
	};
}

/** What a member's client does: check the proof, then process with a gate. */
async function memberProcesses(state: ClientState, commitBase64: string) {
	const cipherSuite = await getCordnCipherSuite();
	const message = mlsMessageDecoder(base64ToBytes(commitBase64), 0)![0];
	const commit = inspectExternalCommit(message);
	expect(commit).not.toBeNull();
	const verdict = verifyExternalJoin(groupFacts(state), commit!);
	const result = (await processMessage({
		context: { cipherSuite, authService: unsafeTestingAuthenticationService },
		state,
		message: message as never,
		callback: gateExternalJoin(state, message, () => 'accept')
	})) as { actionTaken: string; newState: ClientState };
	return { verdict, result };
}

describe('external join (ADR 0011)', () => {
	test('a listed newcomer joins from the GroupInfo; the owner accepts and both agree', async () => {
		const state = await ownerGroup();
		const joined = await join(state);
		expect(joined.state.groupContext.epoch).toBe(1n);
		const { verdict, result } = await memberProcesses(state, joined.commitBase64);
		expect(verdict).toEqual({ ok: true, via: 'roster' });
		expect(result.actionTaken).toBe('accept');
		expect(result.newState.groupContext.epoch).toBe(1n);
		expect(getGroupMembers(result.newState)).toHaveLength(2);
		// Same epoch secrets on both sides: the joiner reads what members send.
		expect(result.newState.keySchedule.epochAuthenticator).toEqual(
			joined.state.keySchedule.epochAuthenticator
		);
	});

	test('a straight-in grant is accepted as proof', async () => {
		const state = await ownerGroup();
		const joined = await join(state, grant());
		const { verdict, result } = await memberProcesses(state, joined.commitBase64);
		expect(verdict).toEqual({ ok: true, via: 'grant' });
		expect(result.actionTaken).toBe('accept');
	});

	test('someone not on the list is rejected and the group stays put', async () => {
		const state = await ownerGroup();
		const joined = await join(state, roster(['aa'.repeat(32)]));
		const { verdict, result } = await memberProcesses(state, joined.commitBase64);
		expect(verdict).toMatchObject({ ok: false, reason: 'not on the signed member list' });
		expect(result.actionTaken).toBe('reject');
		expect(result.newState.groupContext.epoch).toBe(0n);
	});

	test('a list not signed by the owner is rejected', async () => {
		const state = await ownerGroup();
		const joined = await join(state, roster([joiner], now, 'website', generateSecretKey()));
		const { verdict } = await memberProcesses(state, joined.commitBase64);
		expect(verdict).toMatchObject({ ok: false, reason: 'not signed by the owner' });
	});

	test('a list for another project is rejected', async () => {
		const state = await ownerGroup();
		const joined = await join(state, roster([joiner], now, 'other'));
		const { verdict } = await memberProcesses(state, joined.commitBase64);
		expect(verdict).toMatchObject({ ok: false, reason: 'roster is for another project' });
	});

	test('posing as a listed member with your own key is rejected', async () => {
		const state = await ownerGroup();
		// The impostor claims the joiner's identity but can only sign as itself.
		const joined = await join(state, roster([joiner]), generateSecretKey(), joiner);
		const { verdict } = await memberProcesses(state, joined.commitBase64);
		expect(verdict).toMatchObject({ ok: false, reason: 'bad binding signature' });
	});

	test('a list older than the member-list floor is rejected', async () => {
		const state = await ownerGroup(withFloor('torii:project=website', now + 10));
		const joined = await join(state, roster([joiner], now));
		const { verdict } = await memberProcesses(state, joined.commitBase64);
		expect(verdict).toMatchObject({ ok: false, reason: 'older than the member-list floor' });
	});

	test('the join seal key matches on both sides', async () => {
		const state = await ownerGroup();
		const info = decodeGroupInfoBase64(await exportGroupInfoBase64(state))!;
		expect(joinSealKey(info.groupContext)).toEqual(joinSealKey(state.groupContext));
		expect(joinSealKey(info.groupContext)).toHaveLength(32);
	});

	test('the join seal opens only an external commit', async () => {
		const state = await ownerGroup();
		const joined = await join(state);
		const sealed = sealJoinCommit(joined.groupInfo.groupContext, joined.commitBase64);
		expect(openJoinSeal(state, sealed)).toBe(joined.commitBase64);
		// The same key over anything else is refused.
		const junk = sealJoinCommit(state.groupContext, btoa('not an mls message'));
		expect(openJoinSeal(state, junk)).toBeNull();
		// A later epoch's member cannot open an old seal.
		const later = await memberProcesses(state, joined.commitBase64);
		expect(openJoinSeal(later.result.newState, sealed)).toBeNull();
	});

	test('the gate leaves member commits to the admin policy', async () => {
		const state = await ownerGroup();
		const inner = () => 'reject' as const;
		expect(gateExternalJoin(state, { wireformat: 2 } as never, inner)).toBe(inner);
	});

	test('an ordinary message is not an external commit', () => {
		expect(inspectExternalCommit({ wireformat: 2 } as never)).toBeNull();
	});
});

describe('proof and floor encoding', () => {
	test('round-trips a proof and refuses junk', () => {
		const allow = roster([joiner]);
		const binding = finalizeEvent(
			{ kind: 27099, created_at: now, content: '', tags: [] },
			joinerSk
		);
		expect(JSON.stringify(decodeJoinProof(encodeJoinProof({ allow, binding })))).toBe(
			JSON.stringify({ allow, binding })
		);
		expect(decodeJoinProof(new TextEncoder().encode('{"allow":1}'))).toBeNull();
		expect(decodeJoinProof(undefined)).toBeNull();
		expect(decodeJoinProof(new Uint8Array(20000))).toBeNull();
	});

	test('floor lives beside the project marker', () => {
		expect(readFloor('torii:project=website')).toBe(0);
		const d = withFloor('torii:project=website', 1700000000);
		expect(d).toBe('torii:project=website torii:floor=1700000000');
		expect(readFloor(d)).toBe(1700000000);
		expect(withFloor(d, 1800000000)).toBe('torii:project=website torii:floor=1800000000');
	});
});
