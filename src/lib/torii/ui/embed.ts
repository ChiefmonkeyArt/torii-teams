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

/** ADR 0023 §2: Continuum shows or hides the frame (`torii:visible { on }`). */
export function visibleMessage(
	e: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
	parent: unknown,
	continuumOrigin: string | undefined
): boolean | null {
	const data = fromContinuum(e, parent, continuumOrigin);
	return data?.type === 'torii:visible' && typeof data.on === 'boolean' ? data.on : null;
}

/** ADR 0023 §2: Continuum starts a frame it has not shown yet with `&hidden=1`. */
export function initialShown(url: URL): boolean {
	return !(url.searchParams.get('embed') === '1' && url.searchParams.get('hidden') === '1');
}

/** ADR 0023 §8: Continuum's Search button opens this chat's search. */
export function searchMessage(
	e: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
	parent: unknown,
	continuumOrigin: string | undefined
): boolean {
	return fromContinuum(e, parent, continuumOrigin)?.type === 'torii:search';
}

/** ADR 0023 §4: unread counts per project, numbers only. */
export function unreadReport(counts: Record<string, number>): {
	type: 'torii:unread';
	counts: Record<string, number>;
} {
	const out: Record<string, number> = {};
	for (const [slug, n] of Object.entries(counts)) {
		if (SLUG_RE.test(slug) && Number.isFinite(n)) out[slug] = Math.max(0, Math.floor(n));
	}
	return { type: 'torii:unread', counts: out };
}

/** ADR 0023 §5: the project page shows its real state now. */
export function readyReport(slug: string): { type: 'torii:ready'; slug: string } | null {
	return SLUG_RE.test(slug) ? { type: 'torii:ready', slug } : null;
}

/**
 * ADR 0023 §6: "not on this project" only once the list has loaded; until
 * then, loading. Other statuses (signed out, waiting) are TeamShell's.
 */
export function projectPageState(
	status: string,
	onProject: boolean
): 'chat' | 'loading' | 'missing' {
	if (onProject) return 'chat';
	return status === 'ready' || status === 'error' ? 'missing' : 'loading';
}

/** ADR 0023 §6: a warning must hold this long before it shows; it hides at once. */
export const SETTLE_MS = 3000;

/** How long to wait before showing `next` (0 = now): only a new warning waits. */
export function settleDelay(
	shown: string | boolean,
	next: string | boolean,
	ms = SETTLE_MS
): number {
	return next && !shown ? ms : 0;
}

/** ADR 0023 §2: may a visible-row report mark messages read? */
export function canMarkRead(pageVisible: boolean, embedded: boolean, shown: boolean): boolean {
	return pageVisible && (!embedded || shown);
}
