// Torii Teams: set at build time by torii-release.yml (VITE_TORII_NODE_BUILD=1).
// A Torii node build never contacts Cordn's public coordinator on its own:
// no first-run seed, no migration probe, no fallback publish (ADR 0003).
// Dev and upstream-style builds (unset) keep Cordn's behaviour unchanged.
import { DEFAULT_CHAT_COORDINATOR_PUBKEY } from '$lib/constants/chat';

export const TORII_NODE_BUILD = import.meta.env.VITE_TORII_NODE_BUILD === '1';

/** The coordinator to use when none is given: Cordn's on upstream, '' on a node. */
export function upstreamFallbackCoordinator(): string {
	return TORII_NODE_BUILD ? '' : DEFAULT_CHAT_COORDINATOR_PUBKEY;
}
