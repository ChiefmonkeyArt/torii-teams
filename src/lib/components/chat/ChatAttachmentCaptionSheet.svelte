<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Spinner } from '$lib/components/ui/spinner';
	import { formatBytes } from '$lib/utils';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	/**
	 * Caption editor for one staged attachment, opened by tapping its chip.
	 * Statelessly shows whatever the parent feeds it: the FIRST chip's caption
	 * is the composer draft itself (the parent routes `onCaptionChange` there),
	 * later chips own their caption. Escape and the overlay close the sheet
	 * (the sheet root handles both); Enter inserts a newline — captions are
	 * multiline, sending stays in the composer.
	 */
	let {
		open = $bindable(false),
		attachment = null,
		caption = '',
		index = 0,
		total = 1,
		onCaptionChange = () => {},
		onPrev = () => {},
		onNext = () => {},
		onRemove = () => {}
	}: {
		open?: boolean;
		attachment?: { previewUrl: string; file: File; processing: boolean } | null;
		caption?: string;
		index?: number;
		total?: number;
		onCaptionChange?: (text: string) => void;
		onPrev?: () => void;
		onNext?: () => void;
		onRemove?: () => void;
	} = $props();

	let textareaRef: HTMLTextAreaElement | null = $state(null);

	// Focus the box each time the sheet (re)opens for a file: the chip was
	// tapped precisely to write, so the keyboard should already be coming up.
	$effect(() => {
		if (open && attachment && textareaRef) {
			const length = textareaRef.value.length;
			textareaRef.focus();
			textareaRef.setSelectionRange(length, length);
		}
	});
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="bottom" class="mx-auto max-w-lg pb-safe">
		<Sheet.Header>
			<Sheet.Title class="truncate">{attachment?.file.name ?? 'Attachment'}</Sheet.Title>
			<Sheet.Description class="sr-only">
				Add a caption to this attachment ({index + 1} of {total})
			</Sheet.Description>
		</Sheet.Header>
		{#if attachment}
			<div class="flex items-center justify-between gap-2 px-6">
				<Button
					variant="ghost"
					size="icon"
					class="size-8 shrink-0 rounded-lg"
					disabled={index <= 0}
					onclick={onPrev}
					aria-label="Previous attachment"
				>
					<ChevronLeft class="size-4" />
				</Button>
				<span class="text-xs text-muted-foreground tabular-nums">{index + 1} / {total}</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-8 shrink-0 rounded-lg"
					disabled={index >= total - 1}
					onclick={onNext}
					aria-label="Next attachment"
				>
					<ChevronRight class="size-4" />
				</Button>
			</div>
			<div class="relative mx-auto mt-2 w-full max-w-sm px-6">
				{#if attachment.previewUrl}
					<img
						src={attachment.previewUrl}
						alt={attachment.file.name}
						class="mx-auto max-h-56 rounded-xl object-contain"
					/>
				{:else}
					<div class="flex h-24 items-center justify-center rounded-xl bg-muted">
						<Paperclip class="size-8 text-muted-foreground" />
					</div>
				{/if}
				{#if attachment.processing}
					<div
						class="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70"
					>
						<Spinner class="size-5" aria-label="Preparing attachment" />
					</div>
				{/if}
			</div>
			<p class="mt-2 px-6 text-center text-xs text-muted-foreground">
				{formatBytes(attachment.file.size)}
			</p>
			<Textarea
				bind:ref={textareaRef}
				value={caption}
				rows={3}
				placeholder={total > 1 ? 'Add a caption for this file…' : 'Add a caption…'}
				oninput={(event) => onCaptionChange((event.currentTarget as HTMLTextAreaElement).value)}
				class="mx-6 mt-3 mb-2 field-sizing-fixed min-h-20 w-[calc(100%-3rem)]"
			/>
			<div class="flex items-center justify-between gap-2 px-6 pb-2">
				<Button variant="ghost" class="text-destructive hover:text-destructive" onclick={onRemove}>
					<Trash2 class="size-4" />
					Remove
				</Button>
				<Button onclick={() => (open = false)}>Done</Button>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
