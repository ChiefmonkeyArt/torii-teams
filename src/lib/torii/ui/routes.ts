// Which routes a Torii build shows (ADR 0005): /chat and /chat/p/<slug> only.
// Everything else goes to /chat; a group link goes to its project.

export interface ToriiRouteInput {
	pathname: string;
	search: string;
	/** Projects are still loading for a signed-in member: wait before mapping a group link. */
	pending: boolean;
	/** Group id in a /chat/<id> path ('' when none). */
	groupId: string;
	projectForGroup: (groupId: string) => string | null;
}

/** Where to send the browser, or null to stay. Keeps ?embed=1. */
export function toriiRedirect(input: ToriiRouteInput): string | null {
	const { pathname } = input;
	if (pathname === '/chat' || /^\/chat\/p\/[a-z0-9][a-z0-9-]{0,62}$/.test(pathname)) return null;
	const embed = new URLSearchParams(input.search).get('embed') === '1' ? '?embed=1' : '';
	if (pathname.startsWith('/chat/')) {
		if (input.pending) return null; // decide once projects are known
		const slug = input.groupId ? input.projectForGroup(input.groupId) : null;
		return `${slug ? `/chat/p/${slug}` : '/chat'}${embed}`;
	}
	return `/chat${embed}`;
}
