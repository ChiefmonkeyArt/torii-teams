// Torii Teams: device members (ADR 0025). A device such as a Tab5 joins a room
// with its own key and posts, as a kind-1013 room message, a note signed by its
// owner's main key:
//   {kind: 27532, pubkey: owner, tags: [["t","torii-teams-device"],["p",device],["label","Tab5"]]}
// The note is only ever sent inside the room, never to relays. Pure rules here.
import { verifyEvent, type NostrEvent } from 'nostr-tools';
import { ChatKinds } from '$lib/chat/kinds';

export const DEVICE_NOTE_KIND = 27532;
export const DEVICE_NOTE_TAG = 'torii-teams-device';
export const MAX_DEVICE_LABEL = 24;
const HEX64 = /^[0-9a-f]{64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export interface DeviceClaim {
	device: string;
	owner: string;
	label: string;
}

const tagValue = (tags: string[][], name: string) => tags.find((t) => t[0] === name)?.[1];

/**
 * The claim in a room message, or null. `sender` is the room member who sent
 * it (the MLS-authenticated author); the owner's signature must cover that
 * exact key, so a member can't claim someone else's device or owner.
 */
export function parseDeviceClaim(
	sender: string,
	kind: number,
	content: string
): DeviceClaim | null {
	if (kind !== ChatKinds.DeviceClaim || !HEX64.test(sender) || content.length > 4096) return null;
	let note: NostrEvent;
	try {
		note = JSON.parse(content) as NostrEvent;
	} catch {
		return null;
	}
	if (!note || note.kind !== DEVICE_NOTE_KIND || !Array.isArray(note.tags)) return null;
	if (!HEX64.test(note.pubkey ?? '') || note.pubkey === sender) return null;
	if (tagValue(note.tags, 't') !== DEVICE_NOTE_TAG || tagValue(note.tags, 'p') !== sender)
		return null;
	if (!verifyEvent(note)) return null;
	const raw = tagValue(note.tags, 'label') ?? 'Tab5';
	const label = raw.replace(CONTROL_RE, '').trim().slice(0, MAX_DEVICE_LABEL) || 'Tab5';
	return { device: sender, owner: note.pubkey, label };
}

/**
 * The people in a member list: devices whose owner is also a member drop out.
 * Roster sync and seat counts use this, so a person's Tab5 is never removed
 * for not being on the roster, and never takes a seat. A device whose owner
 * has left stays in the list, so it is removed with them.
 */
export function peopleOnly(
	members: string[],
	ownerOf: (pubkey: string) => string | undefined
): string[] {
	const set = new Set(members);
	return members.filter((pk) => {
		const owner = ownerOf(pk);
		return !owner || !set.has(owner);
	});
}

/** "Chiefmonkey's Tab5". */
export function deviceName(ownerName: string, label: string): string {
	return `${ownerName}'s ${label}`;
}
