<script lang="ts">
	/**
	 * Torii Teams right-hand panel (J1 slice 2): the group's actions, the
	 * decision log, and the draft form for a new action. Everything here is
	 * read from the folded action log; buttons only emit operations — the
	 * shell sends them through the normal chat outbox.
	 */
	import { Button } from '$lib/components/ui/button';
	import MarkerName from '$lib/components/chat/MarkerName.svelte';
	import {
		ACTION_TYPES,
		decisionLog,
		groupForPanel,
		type Action,
		type ActionState,
		type ActionStatus,
		type RoleResolver
	} from '$lib/chat/actions';
	import {
		ACTION_STATUS_LABELS,
		ACTION_TYPE_LABELS,
		canChangeAction,
		canPromoteAction,
		formError,
		nextStatuses,
		removeSourceFromDraft,
		unixToDueInput,
		type ActionFormDraft
	} from './actionsView';
	import X from '@lucide/svelte/icons/x';
	import Eye from '@lucide/svelte/icons/eye';

	let {
		actionState,
		roleOf,
		me,
		members,
		draft = $bindable(null),
		onSave,
		onStatus,
		onPromote,
		onEdit,
		onAssign,
		onJump,
		onClose
	}: {
		actionState: ActionState;
		roleOf: RoleResolver;
		me: string;
		members: string[];
		draft?: ActionFormDraft | null;
		onSave: (draft: ActionFormDraft) => void;
		onStatus: (action: Action, status: ActionStatus) => void;
		onPromote: (action: Action) => void;
		onEdit: (action: Action) => void;
		onAssign: (action: Action) => void;
		onJump: (eventId: string) => void;
		onClose: () => void;
	} = $props();

	let tab = $state<'actions' | 'decisions'>('actions');
	let titleInput: HTMLInputElement | null = $state(null);

	const sections = $derived.by(() => {
		const g = groupForPanel(actionState);
		return [
			{ key: 'open', label: 'Open', items: g.open, startOpen: true },
			{ key: 'inProgress', label: 'In progress', items: g.inProgress, startOpen: true },
			{ key: 'jobs', label: 'Jobs', items: g.jobs, startOpen: true },
			{ key: 'done', label: 'Done', items: g.done, startOpen: false }
		];
	});
	const decisions = $derived(decisionLog(actionState));
	const error = $derived(draft ? formError(draft) : null);

	// Focus the title once when a draft opens (not on every edit), so Enter saves.
	const hasDraft = $derived(Boolean(draft));
	$effect(() => {
		if (hasDraft) titleInput?.focus();
	});

	function save(event?: SubmitEvent) {
		event?.preventDefault();
		if (!draft || error) return;
		onSave(draft);
	}

	// Reassign rather than mutate: works whether or not the parent's draft is
	// deep-reactive state.
	function patch(change: Partial<ActionFormDraft>) {
		if (draft) draft = { ...draft, ...change };
	}

	function cancel() {
		draft = null;
	}

	function dueLabel(due: number | null): string {
		if (!due) return '';
		return new Date(due * 1000).toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	}
</script>

<div class="flex h-full min-h-0 w-full flex-col bg-background text-foreground" data-torii-actions>
	<header class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
		<div class="flex items-center gap-1" role="tablist" aria-label="Actions views">
			<Button
				variant={tab === 'actions' ? 'secondary' : 'ghost'}
				size="sm"
				role="tab"
				aria-selected={tab === 'actions'}
				onclick={() => (tab = 'actions')}>Actions</Button
			>
			<Button
				variant={tab === 'decisions' ? 'secondary' : 'ghost'}
				size="sm"
				role="tab"
				aria-selected={tab === 'decisions'}
				onclick={() => (tab = 'decisions')}>Decisions</Button
			>
		</div>
		<Button variant="ghost" size="icon-sm" onclick={onClose} aria-label="Close actions">
			<X class="size-4" />
		</Button>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if draft}
			<form
				class="space-y-3 border-b border-border bg-muted/30 px-4 py-3"
				onsubmit={save}
				aria-label={draft.editing ? 'Edit action' : 'New action'}
			>
				<h3 class="text-xs font-semibold">{draft.editing ? 'Edit action' : 'New action'}</h3>
				<label class="block space-y-1 text-xs font-medium text-muted-foreground">
					<span>Title</span>
					<input
						bind:this={titleInput}
						value={draft.title}
						oninput={(e) => patch({ title: e.currentTarget.value })}
						maxlength="280"
						class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
						onkeydown={(e) => e.key === 'Escape' && cancel()}
					/>
				</label>

				<div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Type">
					{#each ACTION_TYPES as type (type)}
						<Button
							type="button"
							size="xs"
							variant={draft.type === type ? 'default' : 'outline'}
							role="radio"
							aria-checked={draft.type === type}
							onclick={() => patch({ type })}>{ACTION_TYPE_LABELS[type]}</Button
						>
					{/each}
				</div>

				<div class="space-y-1 text-xs font-medium text-muted-foreground">
					<span>Owner</span>
					<div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Owner">
						<Button
							type="button"
							size="xs"
							variant={draft.owner === '' ? 'default' : 'outline'}
							role="radio"
							aria-checked={draft.owner === ''}
							onclick={() => patch({ owner: '' })}>Nobody yet</Button
						>
						{#each members as pubkey (pubkey)}
							<Button
								type="button"
								size="xs"
								variant={draft.owner === pubkey ? 'default' : 'outline'}
								role="radio"
								aria-checked={draft.owner === pubkey}
								onclick={() => patch({ owner: pubkey })}
								><MarkerName {pubkey} />{pubkey === me ? ' (me)' : ''}</Button
							>
						{/each}
					</div>
				</div>

				<label class="block space-y-1 text-xs font-medium text-muted-foreground">
					<span>Due</span>
					<input
						type="date"
						value={draft.due}
						oninput={(e) => patch({ due: e.currentTarget.value })}
						class="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
					/>
				</label>

				<div class="space-y-1 text-xs text-muted-foreground">
					<span class="font-medium">From {draft.sources.length} message(s)</span>
					<ul class="space-y-1">
						{#each draft.sources as source (source.id)}
							<li class="flex items-center gap-2 rounded-lg bg-background px-2 py-1">
								<span class="min-w-0 flex-1 truncate text-foreground/90">{source.preview}</span>
								{#if !draft.editing}
									<Button
										type="button"
										size="icon-xs"
										variant="ghost"
										aria-label="Remove this message"
										onclick={() => draft && (draft = removeSourceFromDraft(draft, source.id))}
										><X /></Button
									>
								{/if}
							</li>
						{/each}
					</ul>
					{#if !draft.editing}
						<p>Tip: use “Make action” on more messages to add them.</p>
					{/if}
				</div>

				{#if error}
					<p class="text-xs text-destructive" role="alert">{error}</p>
				{/if}
				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onclick={cancel}>Cancel</Button>
					<Button type="submit" size="sm" disabled={Boolean(error)}>Save</Button>
				</div>
			</form>
		{/if}

		{#if tab === 'actions'}
			{#if actionState.actions.length === 0 && !draft}
				<p class="px-4 py-6 text-sm text-muted-foreground">
					Nothing to do yet. Open a message’s menu and choose “Make action”, or type
					<code>/action</code> in the composer.
				</p>
			{/if}
			{#each sections as section (section.key)}
				{#if section.items.length > 0}
					<details class="border-b border-border" open={section.startOpen}>
						<summary class="cursor-pointer px-4 py-2 text-xs font-semibold text-muted-foreground">
							{section.label} · {section.items.length}
						</summary>
						<ul class="space-y-2 px-3 pb-3">
							{#each section.items as action (action.id)}
								{@render actionCard(action)}
							{/each}
						</ul>
					</details>
				{/if}
			{/each}
		{:else}
			{#if decisions.length === 0}
				<p class="px-4 py-6 text-sm text-muted-foreground">No decisions recorded yet.</p>
			{/if}
			<ul class="space-y-2 px-3 py-3">
				{#each decisions as action (action.id)}
					{@render actionCard(action)}
				{/each}
			</ul>
		{/if}
	</div>
</div>

{#snippet actionCard(action: Action)}
	{@const editable = canChangeAction(action, me, roleOf)}
	<li class="rounded-xl border border-border bg-card px-3 py-2 text-sm" data-action-id={action.id}>
		<div class="flex items-start gap-2">
			<span
				class="mt-0.5 shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase"
				>{ACTION_TYPE_LABELS[action.type]}</span
			>
			<p class="min-w-0 flex-1 leading-5 break-words">{action.title}</p>
			{#if action.sources.length > 0}
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label="Show the message this came from"
					title="Show the message this came from"
					onclick={() => onJump(action.sources[0])}><Eye /></Button
				>
			{/if}
		</div>
		<p class="mt-1 text-xs text-muted-foreground">
			{ACTION_STATUS_LABELS[action.status]}{#if action.promoted}
				· job{/if}
			{#if action.owner}
				· <MarkerName pubkey={action.owner} />{/if}
			{#if action.due}
				· <time datetime={unixToDueInput(action.due)}>due {dueLabel(action.due)}</time>{/if}
		</p>
		{#if editable || canPromoteAction(action, me, roleOf)}
			<div class="mt-2 flex flex-wrap gap-1">
				{#if editable}
					<Button size="xs" variant="ghost" onclick={() => onEdit(action)}>Edit</Button>
					{#if action.owner !== me && (action.status === 'open' || action.status === 'in_progress')}
						<Button size="xs" variant="ghost" onclick={() => onAssign(action)}>Assign to me</Button>
					{/if}
					{#each nextStatuses(action.status) as next (next.status)}
						<Button size="xs" variant="outline" onclick={() => onStatus(action, next.status)}
							>{next.label}</Button
						>
					{/each}
				{/if}
				{#if canPromoteAction(action, me, roleOf)}
					<Button size="xs" variant="secondary" onclick={() => onPromote(action)}>Make job</Button>
				{/if}
			</div>
		{/if}
	</li>
{/snippet}
