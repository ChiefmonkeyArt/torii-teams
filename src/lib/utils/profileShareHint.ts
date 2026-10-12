/**
 * Share-dialog reachability hints: is the person scanning this QR actually able
 * to start a chat with the sharer? Pure text building — the caller supplies the
 * verified state (key-package listing + coordinator health) and wires actions.
 */

export type ProfileShareHintState = 'checking' | 'discoverable' | 'missing' | 'unverified';

export interface ProfileShareHint {
	tone: 'ok' | 'warn' | 'muted';
	text: string;
	action?: { label: string; onAction: () => void };
}

export function buildProfileShareHint(
	state: ProfileShareHintState,
	label?: string
): ProfileShareHint {
	switch (state) {
		case 'checking':
			return { tone: 'muted', text: 'Checking if you are discoverable…' };
		case 'discoverable':
			return {
				tone: 'ok',
				text: `People can start a chat with you${label ? ` on ${label}` : ''}.`
			};
		case 'unverified':
			return {
				tone: 'warn',
				text: `Can't verify your key package${label ? ` on ${label}` : ''} — the coordinator may be unreachable.`
			};
		case 'missing':
			return label
				? {
						tone: 'warn',
						text: `No key package on ${label} — people can't start a chat with you from this link.`
					}
				: {
						tone: 'warn',
						text: "You have no published key package — people can't start a chat with you from this link."
					};
	}
}
