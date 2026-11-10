// "Your computers" (ADR 0016): each person signs one note listing up to 3 of
// their own FIPS computers, so the node's private git lets them in. Pure
// helpers here; the client sends, the panel shows.
//   GET /api/team/devices        -> {devices:[{npub,label}], listed, max, node:{npub|null, git}}
//   PUT /api/team/devices {event} kind 27531, t=torii-teams-devices,
//                                 content {v:1, devices:[{npub,label}]} (full list)
import type { EventTemplate } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

export const DEVICE_KIND = 27531;
export const DEVICE_TAG = 'torii-teams-devices';
export const MAX_DEVICES = 3;
export const MAX_LABEL = 32;
const NPUB_RE = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;
const GIT_RE = /^[a-z0-9.-]{1,64}:[0-9]{1,5}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export interface Device {
	npub: string;
	label: string;
}

export interface MyDevices {
	devices: Device[];
	/** False when this person is on no project here (nothing to save). */
	listed: boolean;
	max: number;
	/** This node's FIPS name, or null when FIPS isn't on the node. */
	nodeNpub: string | null;
	git: string;
}

export function isFipsName(value: string): boolean {
	if (!NPUB_RE.test(value)) return false;
	try {
		return nip19.decode(value).type === 'npub';
	} catch {
		return false;
	}
}

/** A plain-text reason, or '' when the entry can be added to `list`. */
export function checkNewDevice(list: Device[], npub: string, label: string): string {
	if (list.length >= MAX_DEVICES) return `Up to ${MAX_DEVICES} computers.`;
	if (!isFipsName(npub)) return 'That is not a FIPS name. It starts with npub1.';
	if (list.some((d) => d.npub === npub)) return 'That computer is already here.';
	if (label.length > MAX_LABEL || CONTROL_RE.test(label))
		return `Names are up to ${MAX_LABEL} plain characters.`;
	return '';
}

export function deviceNoteTemplate(devices: Device[], createdAt: number): EventTemplate {
	return {
		kind: DEVICE_KIND,
		created_at: createdAt,
		tags: [['t', DEVICE_TAG]],
		content: JSON.stringify({
			v: 1,
			devices: devices.map((d) => ({ npub: d.npub, label: d.label }))
		})
	};
}

function parseDevice(raw: unknown): Device | null {
	const d = raw as { npub?: unknown; label?: unknown } | null;
	if (!d || typeof d.npub !== 'string' || !NPUB_RE.test(d.npub)) return null;
	const label = typeof d.label === 'string' ? d.label.slice(0, MAX_LABEL) : '';
	return { npub: d.npub, label: CONTROL_RE.test(label) ? '' : label };
}

export function parseMyDevices(raw: unknown): MyDevices | null {
	const r = raw as {
		devices?: unknown;
		listed?: unknown;
		max?: unknown;
		node?: { npub?: unknown; git?: unknown } | null;
	} | null;
	if (!r || !Array.isArray(r.devices) || typeof r.listed !== 'boolean') return null;
	const devices = r.devices.slice(0, MAX_DEVICES).map(parseDevice);
	if (devices.some((d) => !d)) return null;
	const nodeNpub =
		typeof r.node?.npub === 'string' && NPUB_RE.test(r.node.npub) ? r.node.npub : null;
	const git =
		typeof r.node?.git === 'string' && GIT_RE.test(r.node.git)
			? r.node.git
			: 'torii-teams.fips:7334';
	const max =
		Number.isInteger(r.max) && (r.max as number) > 0
			? Math.min(r.max as number, MAX_DEVICES)
			: MAX_DEVICES;
	return { devices: devices as Device[], listed: r.listed, max, nodeNpub, git };
}

/** The line a member adds to their FIPS hosts file: `<shortname> <node npub>`. */
export function hostsLine(git: string, nodeNpub: string): string {
	return `${git.split('.')[0]} ${nodeNpub}`;
}

/** Friendly text for a refused save (Continuum's short codes). */
export function saveError(code: string | null, status: number): string {
	if (status === 403) return "You're not on a project here any more.";
	if (code === 'stale') return 'A newer list was saved elsewhere. Reload and try again.';
	if (code === 'clock') return "This computer's clock is off. Fix it and try again.";
	if (code === 'too_many') return `Up to ${MAX_DEVICES} computers.`;
	if (code === 'bad_npub') return 'That is not a FIPS name. It starts with npub1.';
	if (code === 'bad_label') return `Names are up to ${MAX_LABEL} plain characters.`;
	return status === 0 ? "Couldn't reach your node. Try again." : "Couldn't save. Try again.";
}
