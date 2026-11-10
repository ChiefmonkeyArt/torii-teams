// ADR 0017: inside Continuum, Teams shows one project at a time. TeamShell
// sets `on` from isEmbedded(); the home pane and chat header read it.
export const embedState = $state({ on: false });

/** ADR 0017 §1: framed, no project list; the chat pane always fills the width. */
export function shellLayout(embedded: boolean, onHome: boolean) {
	if (embedded) return { list: false, main: 'flex' };
	return { list: true, main: onHome ? 'hidden md:flex' : 'flex' };
}
