import { SvelteMap } from 'svelte/reactivity';
import type { ChatMessageReplyTarget, MessageTarget } from '$lib/chat/references';
import type { ChatMentionReference } from '$lib/components/chat/chat.types';

const drafts = new SvelteMap<string, string>();

/** The composer's armed reply, kept per group like the draft text. */
const draftReplies = new SvelteMap<string, ChatMessageReplyTarget>();

/** The composer's in-progress edit (target + original-text preview), kept per
 *  group like the draft: a remount mid-edit must not silently turn the edit
 *  into a brand-new message. */
const draftEdits = new SvelteMap<string, { target: MessageTarget; preview: string }>();

/** Picked @mentions, kept per group like the draft text — the serialized
 *  `nostr:` token lives in the draft, but the token only becomes a `p` tag
 *  through this list at send time. */
const draftMentions = new SvelteMap<string, ChatMentionReference[]>();

export function getChatDraftEdit(
	groupId: string
): { target: MessageTarget; preview: string } | null {
	return draftEdits.get(groupId) ?? null;
}

export function setChatDraftEdit(
	groupId: string,
	edit: { target: MessageTarget; preview: string } | null
): void {
	if (edit === null) {
		draftEdits.delete(groupId);
	} else {
		draftEdits.set(groupId, edit);
	}
}

export function getChatDraftMentions(groupId: string): ChatMentionReference[] {
	return draftMentions.get(groupId) ?? [];
}

export function setChatDraftMentions(groupId: string, mentions: ChatMentionReference[]): void {
	if (mentions.length === 0) {
		draftMentions.delete(groupId);
	} else {
		draftMentions.set(groupId, mentions);
	}
}

export function getChatDraftReply(groupId: string): ChatMessageReplyTarget | null {
	return draftReplies.get(groupId) ?? null;
}

export function setChatDraftReply(groupId: string, reply: ChatMessageReplyTarget | null): void {
	if (reply === null) {
		draftReplies.delete(groupId);
	} else {
		draftReplies.set(groupId, reply);
	}
}

export function getChatDraft(groupId: string): string {
	return drafts.get(groupId) ?? '';
}

export function getChatDraftPreview(groupId: string): string {
	const draft = drafts.get(groupId);
	if (!draft) return '';
	const trimmed = draft.trim();
	if (!trimmed) return '';
	return `Draft: ${trimmed}`;
}

export function setChatDraft(groupId: string, text: string): void {
	if (text === '') {
		drafts.delete(groupId);
	} else {
		drafts.set(groupId, text);
	}
}
