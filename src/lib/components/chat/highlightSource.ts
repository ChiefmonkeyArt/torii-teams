import { naddrEncode, neventEncode } from 'nostr-tools/nip19';

export interface HighlightSource {
	readonly label: string;
	readonly href?: string;
}

/**
 * Resolve a NIP-84 highlight's source reference to a card footer link.
 * Sources per the NIP: e/a tags for nostr events, r for URLs or free text,
 * i for NIP-73 structured sources. First usable tag wins; malformed
 * references (bad hex, broken a-tag coords) are skipped, not fatal — the
 * next source tag gets its chance. r tags carrying the `mention` attribute
 * come from the quote-highlight's comment text, not the highlighted source,
 * and are ignored.
 */
export function highlightSource(tags: string[][]): HighlightSource | null {
	for (const [name, value, attribute] of tags) {
		if (!value) continue;
		try {
			if (name === 'e') {
				return {
					label: 'Nostr event',
					href: `https://nostr.at/${neventEncode({ id: value })}`
				};
			}
			if (name === 'a') {
				const [kindRaw, pubkey, identifier] = value.split(':');
				const kind = Number(kindRaw);
				if (!Number.isFinite(kind) || !pubkey || !identifier) continue;
				return {
					label: 'Nostr article',
					href: `https://nostr.at/${naddrEncode({ kind, pubkey, identifier })}`
				};
			}
			if (name === 'r' || name === 'i') {
				if (attribute === 'mention') continue;
				if (/^https?:\/\//i.test(value)) {
					return { label: hostnameOf(value), href: value };
				}
				return { label: value };
			}
		} catch {
			// Malformed reference: fall through to the next source tag.
		}
	}
	return null;
}

function hostnameOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}
