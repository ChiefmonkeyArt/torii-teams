// Invite links (ADR 0009). The secret rides in the URL fragment, which no
// server ever sees. It is read once at startup, before any network request,
// moved to this tab's sessionStorage (so a signer login or reload keeps it)
// and the address bar is rewritten to /chat, so it never lands in history,
// screenshots of the address bar, or a Referer.

import { INVITE_ID_RE, INVITE_SECRET_RE, parseInviteLink, type InviteLink } from './continuumApi';

const KEY = 'torii.invite';

interface Win {
	location: { pathname: string; hash: string; search: string };
	history: { state: unknown; replaceState(state: unknown, unused: string, url: string): void };
	sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/** Take an invite from the address bar, if any. Returns true when one was taken. */
export function captureInvite(w: Win): boolean {
	const { pathname, hash, search } = w.location;
	if (!pathname.startsWith('/chat/join/')) return false;
	const link = parseInviteLink(pathname, hash);
	const embed = new URLSearchParams(search).get('embed') === '1' ? '?embed=1' : '';
	// Strip first, whatever the link looks like: a bad fragment must not stay either.
	w.history.replaceState(w.history.state, '', `/chat${embed}`);
	if (!link) return false;
	try {
		w.sessionStorage.setItem(KEY, JSON.stringify(link));
	} catch {
		return false;
	}
	return true;
}

/** The invite this tab is carrying, or null. */
export function heldInvite(storage: Pick<Storage, 'getItem'> | null): InviteLink | null {
	try {
		const raw = storage?.getItem(KEY);
		const v = raw ? (JSON.parse(raw) as InviteLink) : null;
		return v && INVITE_ID_RE.test(v.id) && INVITE_SECRET_RE.test(v.secret) ? v : null;
	} catch {
		return null;
	}
}

export function dropInvite(storage: Pick<Storage, 'removeItem'> | null): void {
	try {
		storage?.removeItem(KEY);
	} catch {
		/* nothing to drop */
	}
}
