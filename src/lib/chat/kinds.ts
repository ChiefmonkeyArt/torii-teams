/**
 * Kind catalog and categorization for chat messages.
 *
 * Single source of truth for every kind number. Import from here — never inline
 * a magic number. See `src/lib/chat/README.md` for the rendering model.
 */

/** Synthetic, non-Nostr messages derived from MLS commits (member add/remove,
 *  metadata changes). Carried in the same `kind` field as real Nostr kinds. */
export const SYSTEM_MESSAGE_KIND = -1;

/** Real Nostr/Cordn application kinds rendered in the chat. */
export const ChatKinds = {
	Text: 9,
	ThreadReply: 1111,
	Reaction: 7,
	Edit: 1010,
	Deletion: 5,
	/** Group-scoped pin/unpin of an existing message. Carries an `op` tag
	 *  (`add` | `remove`); the active pin set is derived last-write-wins. */
	Pin: 1011,
	/** NIP-88 poll: `content` = question, `option`/`polltype`/`endsAt` tags.
	 *  See `src/lib/chat/polls.ts`. */
	Poll: 1068,
	/** NIP-88 poll response: `response` tags select option ids of the poll in
	 *  its `e` tag. Never renders as a row — it is the poll's sparse aggregate. */
	PollResponse: 1018
} as const;

/** Annotation kinds never render as a row — they mutate a primary message
 *  (reactions, edits, deletes) and are folded into its view model. */
const ANNOTATION_KINDS = new Set<number>([
	ChatKinds.Reaction,
	ChatKinds.Edit,
	ChatKinds.Deletion,
	ChatKinds.Pin
]);

export function isAnnotationKind(kind: number): boolean {
	return ANNOTATION_KINDS.has(kind);
}

export function isSystemKind(kind: number): boolean {
	return kind === SYSTEM_MESSAGE_KIND;
}

/** Kinds that never render as a stream row: annotation kinds plus
 *  kind-specific sparse aggregates (poll responses) that only feed their
 *  owning kind's renderer via a self-query. */
export function isStreamHiddenKind(kind: number): boolean {
	return isAnnotationKind(kind) || kind === ChatKinds.PollResponse;
}
