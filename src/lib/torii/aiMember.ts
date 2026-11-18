// Torii Teams: the project AI member (ADR 0024). Continuum lists it on a
// project's roster as an agent; the roster reply names it and its model, so
// the chat can label its messages and say who may ask it. Pure rules here.

import type { AiMember } from './continuumApi';

const ASKERS = new Set(['owner', 'maintainer']);

/** The AI member for a pubkey, across projects, or null. */
export function aiMemberOf(
	ai: Readonly<Record<string, AiMember>>,
	pubkey: string | null | undefined
): AiMember | null {
	if (!pubkey) return null;
	for (const m of Object.values(ai)) if (m.pubkey === pubkey) return m;
	return null;
}

/** The project slug from a chat description marker, or null. */
export function slugOfDescription(description: unknown): string | null {
	if (typeof description !== 'string') return null;
	const m = description.match(/(?:^|\s)torii:project=([a-z0-9][a-z0-9-]{0,47})(?=$|\s)/);
	return m ? m[1] : null;
}

/**
 * A note under the composer when you @mention the project AI but your role
 * cannot ask it (ADR 0024 §3); null otherwise.
 */
export function aiAskHint(
	ai: AiMember | null | undefined,
	role: string | null | undefined,
	mentioned: readonly string[]
): string | null {
	if (!ai || !mentioned.includes(ai.pubkey)) return null;
	if (role && ASKERS.has(role)) return null;
	return `Only Owners and Maintainers can ask ${ai.name}. It won't answer this.`;
}
