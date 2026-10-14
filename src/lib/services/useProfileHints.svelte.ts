import { SvelteSet } from 'svelte/reactivity';
import { eventStore } from '$lib/services/eventStore';
import { ensureProfileLoaded } from '$lib/queries/chatProfileQueries';
import { ProfileModel } from 'applesauce-core/models';
import type { ProfileContent } from 'applesauce-core/helpers';

export type ProfileHints = Record<string, ProfileContent>;

// Session-wide profile cache, keyed by pubkey: survives component remounts, so
// a rebuilt chat list paints real avatars on the first frame instead of
// fallback-then-pop (the $effect below runs after first paint — too late to
// seed a mount). Metadata rarely changes; the live subscription still updates it.
const profileContentCache = new Map<string, ProfileContent>();

export interface UseProfileHintsOptions {
	/** When non-empty, triggers a deduplicated profile metadata fetch for each pubkey. */
	relays?: string[];
}

/**
 * Shared Svelte rune that manages profile hint subscriptions for a reactive list of pubkeys.
 *
 * Subscribes to `eventStore.model(ProfileModel, pubkey)` for each unique pubkey and,
 * when `relays` is provided, triggers a deduplicated metadata fetch via
 * `ensureProfileLoaded` so the live store populates.
 */
export function useProfileHints(
	getPubkeys: () => string[],
	opts: UseProfileHintsOptions = {}
): ProfileHints {
	const hints = $state<ProfileHints>({});

	// Synchronous warm seed for the initial pubkey set (the reactive tail of the
	// list is the effect's job).
	for (const pubkey of getPubkeys()) {
		const cached = profileContentCache.get(pubkey);
		if (cached) hints[pubkey] = cached;
	}

	$effect(() => {
		const pubkeys = [...new SvelteSet(getPubkeys())];
		if (pubkeys.length === 0) return;

		const relays = opts.relays ?? [];

		const subscriptions = pubkeys.flatMap((pubkey) => {
			const subs: Array<{ unsubscribe: () => void }> = [];

			subs.push(
				eventStore.model(ProfileModel, pubkey).subscribe((profile) => {
					const next: ProfileContent = {
						name: profile?.name,
						displayName: profile?.display_name,
						nip05: profile?.nip05,
						picture: profile?.picture
					};
					const prev = hints[pubkey];
					if (
						prev?.name === next.name &&
						prev?.displayName === next.displayName &&
						prev?.nip05 === next.nip05 &&
						prev?.picture === next.picture
					) {
						return;
					}
					hints[pubkey] = next;
					profileContentCache.set(pubkey, next);
				})
			);

			if (relays.length > 0) {
				ensureProfileLoaded(pubkey);
			}

			return subs;
		});

		return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
	});

	return hints;
}
