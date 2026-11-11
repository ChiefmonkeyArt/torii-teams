// Torii Teams (ADR 0020): say when the node's chat server (coordinator) is
// unreachable, instead of letting messages look sent. Pure rules; the shell
// wires them to coordinatorHealth and the reachability check.
import type { CoordinatorHealthStatus } from '$lib/services/coordinatorHealth.svelte';
import type { TeamReachability } from './teamReachability';

export const SERVER_DOWN_TEXT = "Chat server is down. Messages won't send until it's back.";

/** Down only on evidence: a failed request since the last success. */
export function chatServerDown(nodeCoordinator: string, tone: CoordinatorHealthStatus): boolean {
	return nodeCoordinator.trim() !== '' && tone === 'degraded';
}

/** "Your team can't add you yet / Fix it" cannot help while the server is down. */
export function showReachabilityFix(reach: TeamReachability, serverDown: boolean): boolean {
	return reach === 'missing' && !serverDown;
}
