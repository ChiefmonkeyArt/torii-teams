// Torii Teams (ADR 0004): can the team add this member to a project chat yet?
// A project owner can only add someone whose key package is on the node's
// coordinator, and a key package is only published once the member signs in.
// Pure helpers so the rules are unit-tested; the page wires them to the stores.
import { DEFAULT_CHAT_COORDINATOR_PUBKEY } from '$lib/constants/chat';

export type TeamReachability = 'checking' | 'ready' | 'missing';

export interface ReachabilitySnapshot {
	checked: boolean;
	ownerPubkey: string;
	uncoveredCoordinatorKeys: readonly string[];
	coveredCoordinatorKeys: readonly string[];
}

/**
 * - ready: the node coordinator verified it serves a key package for us.
 * - missing: it verified it serves none (publish failed or was opted out).
 * - checking: no verified answer yet, another account's summary, or no node.
 */
export function teamReachability(
	nodeCoordinator: string,
	ownerPubkey: string,
	store: ReachabilitySnapshot
): TeamReachability {
	const node = nodeCoordinator.trim().toLowerCase();
	if (!node || !ownerPubkey || !store.checked || store.ownerPubkey !== ownerPubkey) {
		return 'checking';
	}
	if (store.coveredCoordinatorKeys.includes(node)) return 'ready';
	if (store.uncoveredCoordinatorKeys.includes(node)) return 'missing';
	return 'checking';
}

/** Per-member, per-browser flag: the "Your team can now add you" note was dismissed. */
export function teamReadyAckKey(ownerPubkey: string): string {
	return `torii.teamReadyAck:${ownerPubkey}`;
}

/**
 * One-off cleanup (torii.4): torii.2 seeded Cordn's public coordinator as a
 * non-default "Default coordinator". Only that exact seed is dropped; a
 * coordinator the member added or flagged themselves is kept.
 */
export function isSeededCordnCoordinator(entry: {
	pubkey: string;
	label: string;
	isDefault: boolean;
}): boolean {
	return (
		entry.pubkey === DEFAULT_CHAT_COORDINATOR_PUBKEY &&
		entry.label === 'Default coordinator' &&
		!entry.isDefault
	);
}

/**
 * Torii builds: the automatic reachability pass covers Cordn's public
 * coordinator only when the member deliberately uses it (stored by hand or a
 * group lives there). A key package that once went there is not a reason to
 * keep contacting it.
 */
export function shouldAutoCover(
	coordinatorKey: string,
	nodeBuild: boolean,
	deliberateKeys: ReadonlySet<string>
): boolean {
	if (!nodeBuild || coordinatorKey !== DEFAULT_CHAT_COORDINATOR_PUBKEY) return true;
	return deliberateKeys.has(coordinatorKey);
}
