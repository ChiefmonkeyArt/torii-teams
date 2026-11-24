import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { deviceName, parseDeviceClaim, peopleOnly, DEVICE_NOTE_KIND } from './deviceClaim';

const ownerSk = generateSecretKey();
const OWNER = getPublicKey(ownerSk);
const DEVICE = getPublicKey(generateSecretKey());
const OTHER = getPublicKey(generateSecretKey());

function note(device: string, extra: string[][] = [], sk = ownerSk, kind = DEVICE_NOTE_KIND) {
	return JSON.stringify(
		finalizeEvent(
			{
				kind,
				created_at: 1764000000,
				tags: [['t', 'torii-teams-device'], ['p', device], ...extra],
				content: ''
			},
			sk
		)
	);
}

describe('device claims (ADR 0025)', () => {
	it('accepts an owner-signed note for the sender', () => {
		expect(parseDeviceClaim(DEVICE, 1013, note(DEVICE, [['label', 'Tab5']]))).toEqual({
			device: DEVICE,
			owner: OWNER,
			label: 'Tab5'
		});
	});

	it('cleans and caps the label, defaulting to Tab5', () => {
		expect(parseDeviceClaim(DEVICE, 1013, note(DEVICE))?.label).toBe('Tab5');
		expect(
			parseDeviceClaim(DEVICE, 1013, note(DEVICE, [['label', 'Kit\u0007chen ' + 'x'.repeat(40)]]))
				?.label
		).toHaveLength(24);
	});

	it('refuses a note for another device, a forged or wrong-kind note, or self-ownership', () => {
		expect(parseDeviceClaim(OTHER, 1013, note(DEVICE))).toBeNull();
		const forged = JSON.parse(note(DEVICE));
		forged.tags.push(['label', 'x']);
		expect(parseDeviceClaim(DEVICE, 1013, JSON.stringify(forged))).toBeNull();
		expect(parseDeviceClaim(DEVICE, 1013, note(DEVICE, [], ownerSk, 27531))).toBeNull();
		expect(parseDeviceClaim(OWNER, 1013, note(OWNER))).toBeNull();
		expect(parseDeviceClaim(DEVICE, 9, note(DEVICE))).toBeNull();
		expect(parseDeviceClaim(DEVICE, 1013, 'not json')).toBeNull();
	});

	it('leaves devices out of the people while their owner is a member', () => {
		const ownerOf = (pk: string) => (pk === DEVICE ? OWNER : undefined);
		expect(peopleOnly([OWNER, DEVICE, OTHER], ownerOf)).toEqual([OWNER, OTHER]);
		expect(peopleOnly([DEVICE, OTHER], ownerOf)).toEqual([DEVICE, OTHER]);
	});

	it('names the device after its owner', () => {
		expect(deviceName('Chiefmonkey', 'Tab5')).toBe("Chiefmonkey's Tab5");
	});
});
