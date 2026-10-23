import { eventStore } from '$lib/services/eventStore';
import { ensureProfileLoaded } from '$lib/queries/chatProfileQueries';
import { ProfileModel } from 'applesauce-core/models';
import type { ProfileContent } from 'applesauce-core/helpers';

export type ProfileHints = Record<string, ProfileContent>;

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
 *
 * The initial list is seeded synchronously during init: models replay their
 * cached value on subscribe (ReplaySubject), so profiles seen before resolve
 * before the first paint instead of flashing the fallback behind an effect that
 * only runs after mount — the chat-home 1:1 cards' avatar blink on back-nav
 * (same rationale as `useProfile`'s synchronous seed). A ReferenceError from the
 * seed is swallowed: callers' closures may read deriveds declared later in
 * their script (TDZ at init, fine inside the effect — see the probe test), and
 * those callers keep the effect-only behavior.
 */
export function useProfileHints(
	getPubkeys: () => string[],
	opts: UseProfileHintsOptions = {}
): ProfileHints {
	const hints = $state<ProfileHints>({});
	const subscriptions = new Map<string, { unsubscribe: () => void }>();
	const relays = opts.relays ?? [];

	function subscribePubkey(pubkey: string) {
		if (subscriptions.has(pubkey)) return;
		subscriptions.set(
			pubkey,
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
			})
		);
		if (relays.length > 0) {
			ensureProfileLoaded(pubkey);
		}
	}

	// Idempotent sync: subscribe new pubkeys, drop ones that left the list.
	function syncPubkeys(pubkeys: Iterable<string>) {
		const seen = new Set<string>();
		for (const pubkey of pubkeys) {
			if (!pubkey) continue;
			seen.add(pubkey);
			subscribePubkey(pubkey);
		}
		for (const [pubkey, subscription] of subscriptions) {
			if (!seen.has(pubkey)) {
				subscription.unsubscribe();
				subscriptions.delete(pubkey);
			}
		}
	}

	try {
		syncPubkeys(getPubkeys());
	} catch (error) {
		// TDZ from a closure reading later-declared deriveds — nothing was
		// subscribed yet, and the effect below reruns it once init completes.
		if (!(error instanceof ReferenceError)) throw error;
	}

	$effect(() => {
		syncPubkeys(getPubkeys());
		return () => {
			for (const subscription of subscriptions.values()) subscription.unsubscribe();
			subscriptions.clear();
		};
	});

	return hints;
}
