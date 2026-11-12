// Embedded in Continuum (framed at <app>/chat?embed=1): hide the app title,
// Continuum's card already names it. Framing alone also counts.
export function isEmbedded(win: Pick<Window, 'self' | 'top'>, url: URL): boolean {
	if (url.searchParams.get('embed') === '1') return true;
	try {
		return win.self !== win.top;
	} catch {
		return true; // cross-origin parent
	}
}

const NAV_RE = /^\/chat(?:\/p\/([a-z0-9][a-z0-9-]{0,47}))?$/;

/**
 * Continuum shows a project in its one Teams frame with `torii:navigate`
 * (ADR 0010). Only from the parent window at Continuum's exact origin, and
 * only to `/chat` or `/chat/p/<slug>`; anything else is ignored.
 * @returns the project slug, '' for the project list, or null to ignore
 */
export function navigateTarget(
	e: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
	parent: unknown,
	continuumOrigin: string | undefined
): string | null {
	if (!continuumOrigin || e.origin !== continuumOrigin || e.source !== parent) return null;
	const data = e.data as { type?: unknown; path?: unknown } | null;
	if (data?.type !== 'torii:navigate' || typeof data.path !== 'string') return null;
	const m = NAV_RE.exec(data.path);
	return m ? (m[1] ?? '') : null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * Continuum's `torii:roster-changed` from the parent window at its exact
 * origin (ADR 0015): the project slug to answer for, or null to not answer.
 */
export function rosterChangedSlug(
	e: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
	parent: unknown,
	continuumOrigin: string | undefined
): string | null {
	if (!continuumOrigin || e.origin !== continuumOrigin || e.source !== parent) return null;
	if (parent === null || parent === undefined) return null;
	const data = e.data as { type?: unknown; slug?: unknown } | null;
	if (data?.type !== 'torii:roster-changed' || typeof data.slug !== 'string') return null;
	return SLUG_RE.test(data.slug) ? data.slug : null;
}

/**
 * ADR 0015: how many people are still in the project's chat but not on the
 * signed list (never the owner). Counts only; no keys leave the frame.
 */
export function rosterSyncedAnswer(input: {
	slug: string;
	me: string;
	owner: string | null | undefined;
	roster: readonly string[] | undefined;
	groupMembers: readonly string[] | null | undefined;
	failed: boolean;
}): { type: 'torii:roster-synced'; slug: string; left: number; error: boolean } {
	const { slug, me, owner, roster, groupMembers, failed } = input;
	if (!me || owner !== me || !roster || !groupMembers)
		return { type: 'torii:roster-synced', slug, left: 0, error: true };
	const left = groupMembers.filter((pk) => pk !== me && !roster.includes(pk)).length;
	return { type: 'torii:roster-synced', slug, left, error: failed };
}

export type EmbedMode = 'dark' | 'light';
const isMode = (v: unknown): v is EmbedMode => v === 'dark' || v === 'light';

/** A message from the parent window at Continuum's exact origin, or null. */
function fromContinuum(
	e: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
	parent: unknown,
	continuumOrigin: string | undefined
): { type?: unknown; [k: string]: unknown } | null {
	if (!continuumOrigin || e.origin !== continuumOrigin || e.source !== parent) return null;
	if (parent === null || parent === undefined) return null;
	const data = e.data as { type?: unknown } | null;
	return data && typeof data === 'object' ? data : null;
}

/** ADR 0021 §2: Continuum's light or dark, from the frame address (`&mode=`). */
export function embedModeFromUrl(url: URL): EmbedMode | null {
	if (url.searchParams.get('embed') !== '1') return null;
	const m = url.searchParams.get('mode');
	return isMode(m) ? m : null;
}

/** ADR 0021 §2: `torii:theme { mode }` when the owner switches; only one word. */
export function themeModeMessage(
	e: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
	parent: unknown,
	continuumOrigin: string | undefined
): EmbedMode | null {
	const data = fromContinuum(e, parent, continuumOrigin);
	return data?.type === 'torii:theme' && isMode(data.mode) ? data.mode : null;
}

/** ADR 0021 §3: Continuum's Your computers button. */
export function openComputersMessage(
	e: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
	parent: unknown,
	continuumOrigin: string | undefined
): boolean {
	return fromContinuum(e, parent, continuumOrigin)?.type === 'torii:open-computers';
}

/** ADR 0021 §2: the frame has no mode-watcher; Continuum's choice sets `.dark`. */
export function applyEmbedMode(root: Pick<HTMLElement, 'classList'>, mode: EmbedMode) {
	root.classList.toggle('dark', mode === 'dark');
}

/**
 * ADR 0021 §4: who is really in the chat, for Continuum's strip. Two numbers;
 * no keys or names leave the frame.
 */
export function membersReport(
	slug: string,
	members: readonly string[],
	waiting: readonly string[]
): { type: 'torii:members'; slug: string; joined: number; waiting: number } | null {
	if (!SLUG_RE.test(slug)) return null;
	return { type: 'torii:members', slug, joined: members.length, waiting: waiting.length };
}
