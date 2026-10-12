import { SvelteMap } from 'svelte/reactivity';
import type { ChatMessageReplyTarget } from '$lib/chat/references';

const drafts = new SvelteMap<string, string>();

/** The composer's armed reply, kept per group like the draft text. */
const draftReplies = new SvelteMap<string, ChatMessageReplyTarget>();

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
