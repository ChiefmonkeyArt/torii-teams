import { nip19 } from 'nostr-tools';
import type { ProfileContent } from 'applesauce-core/helpers';
import { TORII_NODE_BUILD } from '$lib/torii/build';

/**
 * Single display-name fallback chain for kind-0 profiles:
 * name → display_name → nip05 → truncated npub. Shared by ProfileCard,
 * system-message name chips, and coordinator label resolution so every
 * surface degrades identically. Returns undefined only when there is
 * neither profile data nor a pubkey to abbreviate.
 */
export function profileDisplayName(
	profile: ProfileContent | undefined,
	pubkey?: string,
	preferDisplay = TORII_NODE_BUILD
): string | undefined {
	return (
		pickProfileName(profile?.name, profile?.display_name, profile?.nip05, preferDisplay) ||
		(pubkey ? `${nip19.npubEncode(pubkey).slice(0, 12)}…` : undefined)
	);
}

/**
 * Torii Teams (ADR 0006): a node build shows the person's chosen display
 * name first ("Max Member"), falling back to the short handle; upstream
 * Cordn keeps name → display_name. Blank strings fall through.
 */
export function pickProfileName(
	name: string | undefined,
	displayName: string | undefined,
	nip05: string | undefined,
	preferDisplay = TORII_NODE_BUILD
): string | undefined {
	const first = preferDisplay ? displayName || name : name || displayName;
	return first || nip05 || undefined;
}
