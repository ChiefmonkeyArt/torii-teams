/**
 * Share-dialog reachability hints: is the person scanning this QR actually able
 * to start a chat with the sharer? Pure logic — the caller supplies the verified
 * state (key-package listing per coordinator) and wires actions; this builds the
 * hint text and maps states to one hint per share option.
 */

export type ProfileShareHintState = 'checking' | 'discoverable' | 'missing' | 'unverified';

export interface ProfileShareHintAction {
	label: string;
	/** Label while `onAction` runs (e.g. 'Setting up…'). Falls back to `label`. */
	pendingLabel?: string;
	onAction: () => void | Promise<void>;
}

/** One share option's coordinator reachability, from its key-package query. */
export interface ShareReachState {
	/** Query not settled yet (or not created for this option yet). */
	pending?: boolean;
	/** Coordinator call failed — reachability cannot be verified. */
	error?: boolean;
	/** The coordinator lists a key package for the sharing account. */
	discoverable?: boolean;
}

export interface ProfileShareHint {
	tone: 'ok' | 'warn' | 'muted';
	text: string;
	action?: ProfileShareHintAction;
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

/**
 * One hint per share option, each derived from ITS OWN coordinator's
 * key-package listing — reachability is per coordinator: a user can be
 * discoverable on one share tab and unreachable on the next. The action of a
 * 'missing' hint targets exactly the coordinator behind that tab.
 */
export function buildProfileShareHints(
	options: readonly { label: string; coordinatorKey: string }[],
	reach: readonly ShareReachState[],
	action: (coordinatorKey: string) => ProfileShareHintAction
): ProfileShareHint[] {
	return options.map((option, i) => {
		const state = reach[i];
		const kind: ProfileShareHintState =
			!state || state.pending
				? 'checking'
				: state.error
					? 'unverified'
					: state.discoverable
						? 'discoverable'
						: 'missing';
		const hint = buildProfileShareHint(kind, option.label);
		return kind === 'missing' ? { ...hint, action: action(option.coordinatorKey) } : hint;
	});
}
