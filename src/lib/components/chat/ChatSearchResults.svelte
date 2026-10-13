<script lang="ts">
	import ChatGroupAvatar from './ChatGroupAvatar.svelte';
	import ProfileCard from '$lib/components/ProfileCard.svelte';
	import { getChatGroup } from '$lib/services/chatGroups.svelte';
	import type { ChatContentSearchResults } from '$lib/services/chatContentSearch';
	import type { ChatMessageSearchResult } from '$lib/services/chatMessageSearch';

	let {
		results,
		query,
		onSelectPerson,
		onSelectGroup,
		onSelectMessage
	}: {
		results: ChatContentSearchResults;
		query: string;
		onSelectPerson: (pubkey: string) => void;
		onSelectGroup: (groupId: string) => void;
		onSelectMessage: (result: ChatMessageSearchResult) => void;
	} = $props();

	function formatSearchResultTime(createdAt: number) {
		return new Date(createdAt).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

{#snippet sectionLabel(label: string)}
	<p class="px-1 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
		{label}
	</p>
{/snippet}

<div class="space-y-2">
	<div class="flex items-center justify-between px-1">
		<p class="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
			Search results
		</p>
		<p class="text-xs text-muted-foreground">Top matches</p>
	</div>

	{#if results.people.length === 0 && results.groups.length === 0 && results.messages.length === 0}
		<div
			class="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground"
		>
			No results found for “{query}”.
		</div>
	{:else}
		{#if results.people.length > 0}
			{@render sectionLabel('People')}
			<div class="space-y-1">
				{#each results.people as person (person.pubkey)}
					<button
						type="button"
						onclick={() => onSelectPerson(person.pubkey)}
						class="block w-full rounded-xl border border-transparent px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground"
					>
						<ProfileCard
							pubkey={person.pubkey}
							mode="inline"
							showInlineAvatar={true}
							profileLink={false}
						/>
					</button>
				{/each}
			</div>
		{/if}

		{#if results.groups.length > 0}
			{@render sectionLabel('Groups')}
			<div class="space-y-1">
				{#each results.groups as result (`${result.group.id}`)}
					<button
						type="button"
						onclick={() => onSelectGroup(result.group.id)}
						class="block w-full rounded-xl border border-transparent px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground"
					>
						<div class="flex min-w-0 items-center gap-2">
							<ChatGroupAvatar
								group={result.group}
								class="h-5 w-5 shrink-0"
								fallbackClass="text-[9px] font-medium"
							/>
							<p class="truncate font-medium text-foreground">{result.title}</p>
						</div>
					</button>
				{/each}
			</div>
		{/if}

		{#if results.messages.length > 0}
			{@render sectionLabel('Messages')}
			<div class="space-y-1">
				{#each results.messages as result (result.messageKey)}
					{@const group = getChatGroup(result.groupId)}
					<button
						type="button"
						onclick={() => onSelectMessage(result)}
						class="block w-full rounded-xl border border-transparent px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground"
					>
						<div class="flex items-start justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2">
								{#if group}
									<ChatGroupAvatar
										{group}
										class="h-5 w-5 shrink-0"
										fallbackClass="text-[9px] font-medium"
									/>
								{/if}
								<p class="truncate font-medium text-foreground">{result.groupTitle}</p>
							</div>
							<p class="shrink-0 text-[10px] text-muted-foreground">
								{formatSearchResultTime(result.createdAt)}
							</p>
						</div>
						<p class="mt-1 line-clamp-2 text-xs leading-5">{result.snippet}</p>
						<div class="mt-1 min-w-0 truncate">
							<ProfileCard
								pubkey={result.sender}
								mode="inline"
								showInlineAvatar={true}
								profileLink={false}
							/>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>
