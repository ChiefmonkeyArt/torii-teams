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
