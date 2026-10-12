<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { POLL_MAX_OPTIONS, validatePollDraft, type PollDraft } from '$lib/chat/polls';
	import { cn } from '$lib/utils';

	/**
	 * Poll composer (Signal-shaped): a question, options that grow as the last
	 * one is filled, and an "allow selecting multiple options" switch mapping to
	 * NIP-88 `polltype`. The optional end time maps to `endsAt`; "Never" omits
	 * the tag. The draft is validated with the same rules the send path enforces.
	 */
	let {
		open = $bindable(false),
		onCreate = () => {}
	}: {
		open?: boolean;
		onCreate?: (draft: PollDraft) => void;
	} = $props();

	let question = $state('');
	let optionLabels = $state<string[]>(['', '']);
	let multipleChoice = $state(false);
	let endsIn = $state<'never' | '1h' | '1d' | '3d' | '7d'>('1d');

	// bits-ui dialog content unmounts after the close animation: reset on open
	// so every session starts from the same two empty option rows.
	$effect(() => {
		if (open) {
			question = '';
			optionLabels = ['', ''];
			multipleChoice = false;
			endsIn = '1d';
		}
	});

	// Trailing empty rows are placeholders (Signal's "a third appears once the
	// second is filled"); only non-empty trailing-trimmed labels are sent.
	const activeLabels = $derived.by(() => {
		const labels = [...optionLabels];
		while (labels.length > 0 && labels[labels.length - 1].trim() === '') labels.pop();
		return labels.map((label) => label.trim());
	});

	// Grow the visible rows one ahead of typing, up to the NIP-88 bound.
	$effect(() => {
		if (optionLabels.length < POLL_MAX_OPTIONS && optionLabels.at(-1)?.trim()) {
			optionLabels = [...optionLabels, ''];
		}
	});

	const END_OPTIONS = ['never', '1h', '1d', '3d', '7d'] as const;
	const END_SECONDS: Record<(typeof END_OPTIONS)[number], number | null> = {
		never: null,
		'1h': 3600,
		'1d': 24 * 3600,
		'3d': 3 * 24 * 3600,
		'7d': 7 * 24 * 3600
	};

	const draft = $derived.by<PollDraft | null>(() => {
		const endsSeconds = END_SECONDS[endsIn];
		const candidate: PollDraft = {
			question: question.trim(),
			optionLabels: activeLabels,
			pollType: multipleChoice ? 'multiplechoice' : 'singlechoice',
			endsAt: endsSeconds === null ? null : Math.floor(Date.now() / 1000) + endsSeconds
		};
		return validatePollDraft(candidate, Date.now() / 1000) === null ? candidate : null;
	});

	function handleCreate() {
		if (!draft) return;
		onCreate(draft);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] w-[min(calc(100vw-1.5rem),28rem)] sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create poll</Dialog.Title>
			<Dialog.Description>Ask a question with two to ten options.</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				handleCreate();
			}}
		>
			<div class="flex flex-col gap-1.5">
				<Label for="poll-question">Question</Label>
				<Input id="poll-question" bind:value={question} placeholder="Pineapple on pizza?" />
			</div>

			<div class="flex flex-col gap-1.5">
				<Label>Options</Label>
				{#each optionLabels as label, index (`${index}`)}
					<Input
						value={label}
						oninput={(event) => (optionLabels[index] = event.currentTarget.value)}
						placeholder={`Option ${index + 1}`}
					/>
				{/each}
			</div>

			<div class="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
				<Label for="poll-multiple" class="text-sm font-normal"
					>Allow selecting multiple options</Label
				>
				<Switch id="poll-multiple" bind:checked={multipleChoice} />
			</div>

			<div class="flex flex-col gap-1.5">
				<Label>Ends</Label>
				<div class="flex flex-wrap gap-1.5">
					{#each END_OPTIONS as duration (duration)}
						<button
							type="button"
							onclick={() => (endsIn = duration)}
							class={cn(
								'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
								endsIn === duration
									? 'border-primary/50 bg-primary/15 text-foreground ring-1 ring-primary/30'
									: 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
							)}
						>
							{duration === 'never' ? 'Never' : duration}
						</button>
					{/each}
				</div>
			</div>

			<Button type="submit" disabled={!draft} class="mt-1 w-full">Create poll</Button>
		</form>
	</Dialog.Content>
</Dialog.Root>
