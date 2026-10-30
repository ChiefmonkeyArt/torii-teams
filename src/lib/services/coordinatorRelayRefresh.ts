import { browser } from '$app/environment';
import {
	getChatCoordinator,
	listKnownCoordinatorKeys,
	markCoordinatorRelaysChecked,
	upsertChatCoordinator
} from '$lib/services/chatCoordinators.svelte';
import {
	fetchAnnouncedCoordinatorRelays,
	verifyCoordinatorRelays
} from '$lib/services/chatRuntime';
import { errorMessage, normalizePubKey } from '$lib/utils';

/**
 * Automatic coordinator relay refresh (kind:10002 / CEP-17).
 *
 * Coordinators can move to a new relay set; a stored set is otherwise frozen
 * for the lifetime of the entry and a moved coordinator stays unreachable
 * until a human clicks "Refetch relays". This module heals that automatically,
 * non-intrusively and bounded:
 *
 *   - Staleness sweep: a coordinator whose stored set was last checked over
 *     {@link RELAYS_STALE_AFTER_MS} ago gets one cheap kind:10002 read. Equal
 *     announcement → stamp only (a healthy set is never swapped).
 *   - Outage: the watch retry ladder (a coordinator down past a long rung)
 *     triggers the same refresh ignoring the TTL, capped by
 *     {@link OUTAGE_REFRESH_MIN_INTERVAL_MS}.
 *   - Adoption happens only on VERIFIED change: the announced set differs AND
 *     the coordinator answers a full MCP connect on exactly the announced
 *     relays (`verifyCoordinatorRelays`), so the announced set is adopted
 *     verbatim. The SDK's own discovery/fallback answer is never evidence
 *     about this coordinator — a stale app-default fallback can never be
 *     re-adopted as if it were the coordinator's move.
 *
 * Isolation: everything is per coordinator — the in-flight guard, the stamp
 * clock, the store writes, and error containment (every entry point is
 * no-throw; one coordinator's failure never delays or dents another).
 */

/** Healthy staleness TTL: how long ago a coordinator's relays were last checked. */
const RELAYS_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Outage-triggered refresh cadence floor per coordinator. */
const OUTAGE_REFRESH_MIN_INTERVAL_MS = 15 * 60 * 1000;

/** One refresh at a time per coordinator (never a cross-coordinator lock). */
const refreshInFlight = new Set<string>();

function sameRelaySet(a: readonly string[], b: readonly string[]): boolean {
	const setA = new Set(a);
	const setB = new Set(b);
	return setA.size === setB.size && [...setA].every((url) => setB.has(url));
}

/**
 * Check one coordinator's relays and adopt a verified new set if the
 * announcement changed. Resolves `true` only when the stored set was replaced.
 * Never rejects; always bumps the staleness stamp once a check actually ran
 * (the stamp is "last attempt", so the gates below need no separate timers).
 */
async function refreshCoordinatorRelays(
	coordinatorKey: string,
	reason: 'stale' | 'outage'
): Promise<boolean> {
	const normalized = normalizePubKey(coordinatorKey);
	if (refreshInFlight.has(normalized)) return false;
	const stored = getChatCoordinator(normalized);
	// No stored relays = already auto-resolving per client construction
	// (SDK hints → discovery → fallback); nothing to heal here.
	if (!stored?.relays.length) return false;
	// Opportunistic only: hidden-tab refetches and mid-suspension client swaps
	// are noise, matching the visible-only rules of the failure recorders.
	if (browser && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
		return false;
	}
	refreshInFlight.add(normalized);
	try {
		const announced = await fetchAnnouncedCoordinatorRelays(normalized);
		// No announcement (self-hosted static config): our set is all there is.
		if (!announced.length) return false;
		// Unchanged announcement: a working set is never swapped.
		if (sameRelaySet(announced, stored.relays)) return false;
		// Changed: adopt only a set the coordinator actually answered a full MCP
		// connect on, exactly as announced. On any failure the current set is kept.
		if (!(await verifyCoordinatorRelays(normalized, announced))) return false;
		upsertChatCoordinator({ pubkey: normalized, relays: announced });
		console.debug('[coordinator] relays refreshed', {
			coordinatorKey: normalized,
			reason,
			relays: announced
		});
		return true;
	} catch (error) {
		console.debug('[coordinator] relay refresh failed', {
			coordinatorKey: normalized,
			reason,
			detail: errorMessage(error)
		});
		return false;
	} finally {
		refreshInFlight.delete(normalized);
		markCoordinatorRelaysChecked(normalized);
	}
}

/**
 * Staleness sweep: one check per known coordinator whose stored set is older
 * than {@link RELAYS_STALE_AFTER_MS}. Runs off the watch heartbeat (no extra
 * timer); each coordinator refreshes independently and no-throw. Resolves
 * when every check has settled (callers fire-and-forget).
 */
export async function sweepStaleCoordinatorRelays(): Promise<void> {
	try {
		const now = Date.now();
		const pending: Promise<boolean>[] = [];
		for (const coordinatorKey of listKnownCoordinatorKeys()) {
			const stored = getChatCoordinator(coordinatorKey);
			if (!stored?.relays.length) continue;
			const resolvedAt = stored.relaysResolvedAt ?? 0;
			if (now - resolvedAt < RELAYS_STALE_AFTER_MS) continue;
			// One independent promise per coordinator: a slow or broken one is
			// contained in its own outcome and never delays the others.
			pending.push(refreshCoordinatorRelays(coordinatorKey, 'stale'));
		}
		await Promise.allSettled(pending);
	} catch (error) {
		console.debug('[coordinator] relay sweep failed', { detail: errorMessage(error) });
	}
}

/**
 * Opportunistic heal for a coordinator that is failing repeatedly (watch
 * retry ladder passed the long rung): re-resolve relays ignoring the TTL,
 * capped to one attempt per {@link OUTAGE_REFRESH_MIN_INTERVAL_MS} per
 * coordinator. Resolves `true` when relays were adopted — the caller may then
 * clear ITS OWN coordinator's backoff and re-tick. Never rejects.
 */
export function maybeRefreshCoordinatorRelaysOnOutage(coordinatorKey: string): Promise<boolean> {
	try {
		const normalized = normalizePubKey(coordinatorKey);
		const stored = getChatCoordinator(normalized);
		if (!stored?.relays.length) return Promise.resolve(false);
		const resolvedAt = stored.relaysResolvedAt ?? 0;
		if (Date.now() - resolvedAt < OUTAGE_REFRESH_MIN_INTERVAL_MS) return Promise.resolve(false);
		// Boundary catch: even a stamp write failing (localStorage quota) must not
		// leak a rejection into the watch ladder.
		return refreshCoordinatorRelays(normalized, 'outage').catch(() => false);
	} catch (error) {
		console.debug('[coordinator] outage relay refresh failed', {
			coordinatorKey,
			detail: errorMessage(error)
		});
		return Promise.resolve(false);
	}
}
