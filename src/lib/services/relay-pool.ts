import { RelayPool } from 'applesauce-relay';
import { TORII_NODE_BUILD } from '$lib/torii/build';

// Create a single relay pool instance for the entire application
export const relayPool = new RelayPool();

export const defaultRelays = [
	'wss://relay.contextvm.org',
	'wss://relay2.contextvm.org',
	'wss://relay.primal.net'
];

export const commonRelays = [
	'wss://relay.nostr.net',
	'wss://relay.ditto.pub/',
	'wss://nos.lol',
	'wss://nostr.mom',
	'wss://relay.primal.net'
];

// Torii builds (ADR 0006): no public profile relays; profiles come from the
// node agent through toriiProfiles. Empty here also stops relay-list lookups
// and the login dialog's profile prefetch from reaching public relays.
export const metadataRelays: string[] = TORII_NODE_BUILD
	? []
	: [
			'wss://nos.lol',
			'wss://relay.ditto.pub/',
			'wss://relay.primal.net',
			'wss://relay.nostr.net',
			'wss://profiles.nostr1.com/',
			'wss://nostr.wine'
		];
