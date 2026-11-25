// Torii Teams: which room members are someone's device (ADR 0025). Filled from
// kind-1013 claims as they arrive and from storage when a chat opens. A claim
// is checked once (the owner's signature) and then holds everywhere.
import { SvelteMap } from 'svelte/reactivity';
import type { StoredChatMessage } from '$lib/services/chatGroupMessages.svelte';
import { ChatKinds } from '$lib/chat/kinds';
import { parseDeviceClaim, type DeviceClaim } from './deviceClaim';

const claims = new SvelteMap<string, DeviceClaim>();
const loaded = new Set<string>();

export function deviceOf(pubkey: string | null | undefined): DeviceClaim | null {
	return (pubkey && claims.get(pubkey)) || null;
}

export function deviceOwner(pubkey: string): string | undefined {
	return claims.get(pubkey)?.owner;
}

export function noteDeviceClaims(messages: readonly StoredChatMessage[]): void {
	for (const m of messages) {
		if (m.kind !== ChatKinds.DeviceClaim) continue;
		const c = parseDeviceClaim(m.sender, m.kind, m.content);
		if (!c) continue;
		const old = claims.get(c.device);
		if (!old || old.owner !== c.owner || old.label !== c.label) claims.set(c.device, c);
	}
}

/** Reads a chat's stored claims once per session (the by-kind index). */
export async function loadDeviceClaims(
	storage: { getGroupMessagesOfKind(groupId: string, kind: number): Promise<StoredChatMessage[]> },
	groupId: string
): Promise<void> {
	if (loaded.has(groupId)) return;
	loaded.add(groupId);
	try {
		noteDeviceClaims(await storage.getGroupMessagesOfKind(groupId, ChatKinds.DeviceClaim));
	} catch {
		loaded.delete(groupId);
	}
}

export function resetDeviceClaims(): void {
	claims.clear();
	loaded.clear();
}
