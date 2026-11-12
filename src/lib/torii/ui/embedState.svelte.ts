// ADR 0017: inside Continuum, Teams shows one project at a time. TeamShell
// sets `on` from isEmbedded(); the home pane and chat header read it.
// ADR 0021 §3: `computers` opens Your computers from Continuum's strip.
// ADR 0023: `shown` is Continuum's torii:visible (true until it says);
// `search` opens the chat's search from Continuum's strip.
export const embedState = $state({ on: false, computers: false, shown: true, search: false });

/** ADR 0017 §1: framed, no project list; the chat pane always fills the width. */
export function shellLayout(embedded: boolean, onHome: boolean) {
	if (embedded) return { list: false, main: 'flex' };
	return { list: true, main: onHome ? 'hidden md:flex' : 'flex' };
}
