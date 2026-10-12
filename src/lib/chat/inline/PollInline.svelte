<script lang="ts">
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import Check from '@lucide/svelte/icons/check';

	import {
		buildPollTally,
		getMessagePollDefinition,
		samePollSelection,
		type PollOptionResult
	} from '$lib/chat/polls';
	import type { InlineBodyProps } from '$lib/chat/registry';
	import { listChatGroupMessages } from '$lib/services/chatGroups.svelte';
	import { manager } from '$lib/services/accountManager.svelte';
	import { cn, normalizePubKey } from '$lib/utils';

	/**
	 * Compact poll card (kind 1068) for the chat stream. The votes are this
	 * kind's sparse aggregate — self-queried here (README § Dense vs sparse),
	 * never folded by the shell. Tap-to-vote sends a complete-selection kind-1018
	 * replacement (latest per account wins); the selection shows optimistically
	 * until the confirmed response ingests.
	 */
	let { message, groupId = '', onVote }: InlineBodyProps = $props();

	const activePubkey = $derived.by(() => {
		const pubkey = manager.getActive()?.pubkey;
		return pubkey ? normalizePubKey(pubkey) : '';
	});

	// Wall clock only matters near `endsAt`; tick sparsely so an on-screen row
	// closes its own controls at the deadline (marmot gotcha: never wait for a
	// message to learn the poll closed).
	let now = $state(Math.floor(Date.now() / 1000));
	const storedMessages = $derived(groupId ? listChatGroupMessages(groupId) : []);
	const tally = $derived(
		groupId ? buildPollTally(storedMessages, message.eventId, activePubkey, now) : null
	);
	const definition = $derived(
		tally?.definition ?? getMessagePollDefinition(message.kind, message.text, message.tags ?? [])
	);

	$effect(() => {
		if (definition?.endsAt == null) return;
		const timer = setInterval(() => (now = Math.floor(Date.now() / 1000)), 30_000);
		return () => clearInterval(timer);
	});

	let pendingSelection = $state<string[] | null>(null);
	// Cleared once the stored tally reflects the pending vote (or another
	// device's newer vote superseded it — stored always wins over optimistic).
	$effect(() => {
		if (pendingSelection && tally && samePollSelection(tally.selection, pendingSelection)) {
			pendingSelection = null;
		}
	});

	const open = $derived(tally?.open ?? true);
	const participants = $derived(tally?.participants ?? 0);
	const options = $derived<PollOptionResult[]>(
		tally?.options ?? definition?.options.map((option) => ({ ...option, votes: 0 })) ?? []
	);
	const selection = $derived(pendingSelection ?? tally?.selection ?? []);

	function handleVote(optionId: string) {
		// Votes only against a confirmed, open poll (a queued poll bubble has no
		// event id to target yet).
		if (!open || !tally || !definition || !onVote) return;
		let next: string[];
		if (definition.pollType === 'singlechoice') {
			if (selection.includes(optionId)) return; // re-tap keeps the vote; no unvote
			next = [optionId];
		} else {
			next = selection.includes(optionId)
				? selection.filter((id) => id !== optionId)
				: [...selection, optionId];
			if (next.length === 0) return; // empty selection is not an unvote
		}
		pendingSelection = next;
		void Promise.resolve(onVote(message, next)).then((ok) => {
			if (ok === false && pendingSelection && samePollSelection(pendingSelection, next)) {
				pendingSelection = null;
			}
		});
	}
</script>

{#if !definition}
	<div class="rounded-2xl border border-dashed px-3 py-2 text-sm text-muted-foreground italic">
		Unsupported poll
	</div>
{:else}
	<div class="mt-1 w-full max-w-md rounded-2xl border border-border/70 bg-card/60 p-3">
		<div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
			<BarChart3 class="size-3.5" />
			<span>Poll</span>
			{#if !open}
				<span class="rounded-full border border-border px-1.5 py-px text-[10px] uppercase"
					>Closed</span
				>
			{/if}
		</div>
		<p class="mt-1 text-sm font-semibold break-words whitespace-pre-wrap">
			{definition.question}
		</p>
		<div class="mt-2 flex flex-col gap-1.5">
			{#each options as option (option.id)}
				{@const picked = selection.includes(option.id)}
				{@const share = participants > 0 ? option.votes / participants : 0}
				<button
					type="button"
					disabled={!open || !tally}
					onclick={() => handleVote(option.id)}
					class={cn(
						'relative flex w-full items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-1.5 text-left text-sm transition-colors',
						picked
							? 'border-primary/50 bg-primary/15 ring-1 ring-primary/30'
							: 'border-border/70 bg-background/40 hover:bg-muted/60',
						!open && 'cursor-default opacity-90'
					)}
					aria-pressed={picked}
					aria-label={`Vote "${option.label}"${picked ? ' (selected)' : ''}`}
				>
					<span
						class="absolute inset-y-0 left-0 bg-primary/10"
						style={`width: ${Math.round(share * 100)}%`}
					></span>
					<span class="relative flex min-w-0 flex-1 items-center gap-1.5">
						<Check class={cn('size-3.5 shrink-0', picked ? 'opacity-100' : 'opacity-0')} />
						<span class="truncate">{option.label}</span>
					</span>
					<span class="relative shrink-0 text-xs text-muted-foreground tabular-nums">
						{option.votes}
					</span>
				</button>
			{/each}
		</div>
		<p class="mt-2 text-xs text-muted-foreground">
			{participants} vote{participants === 1 ? '' : 's'}{definition.pollType === 'multiplechoice'
				? ' · multiple options allowed'
				: ''}
		</p>
	</div>
{/if}
