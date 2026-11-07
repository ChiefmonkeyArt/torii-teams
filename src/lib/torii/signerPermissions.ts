// Torii Teams: everything the signer is asked for, in one place (ADR 0008).
// A remote signer (NIP-46) gets this list at connect, so one approval covers
// every later call; the browser-extension hint asks for "Always allow".
// signerPermissions.test.ts fails when a new signing call site appears.

/** Continuum team sign-in challenge (NIP-42 style auth event). */
export const CONTINUUM_AUTH_KIND = 22242;
/** ContextVM messages to the node's Cordn coordinator (CTXVM_MESSAGES_KIND). */
export const COORDINATOR_KIND = 25910;
/** Multi-device tip record (MULTI_DEVICE_TIP_KIND). */
export const DEVICE_TIP_KIND = 30078;

/** Binds a newcomer's self-join to their key (ADR 0011). */
export const JOIN_BINDING_KIND = 27099;
export const TEAM_SIGNED_KINDS = [
	CONTINUUM_AUTH_KIND,
	COORDINATOR_KIND,
	JOIN_BINDING_KIND,
	DEVICE_TIP_KIND
] as const;

export const TEAM_SIGNER_PERMISSIONS: string[] = [
	'get_public_key',
	...TEAM_SIGNED_KINDS.map((k) => `sign_event:${k}`),
	'nip44_encrypt',
	'nip44_decrypt'
];

export type SignerKind = 'extension' | 'remote' | 'none';

/** Which signer this browser will use, for the consent card's hint. */
export function detectSigner(win: { nostr?: unknown } | undefined): SignerKind {
	return win && win.nostr && typeof win.nostr === 'object' ? 'extension' : win ? 'remote' : 'none';
}

export function signerHint(kind: SignerKind): string {
	if (kind === 'extension') return "When your extension asks, choose 'Always allow' for this site.";
	return 'Your remote signer gets every permission Teams needs in one request. Approve it once.';
}
