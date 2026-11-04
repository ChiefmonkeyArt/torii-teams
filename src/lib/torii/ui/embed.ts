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
