<script module lang="ts">
	// Session-wide warm-image memory. The pinned HTMLImageElement keeps its
	// fetched bytes (and likely decoded bitmap) alive in the browser's memory
	// cache, so remounts (chat list rebuild, group open/close) paint the picture
	// on the first frame instead of re-fetching and popping it in.
	// Single source of truth for "this src is warm": an LRU-evicted src goes
	// cold again — never claim warm without pinned bytes, or a network fetch
	// would silently reintroduce the empty-circle redraw. Eviction only costs
	// a future re-preload. Same bound as the decoded MLS-state cache.
	const MAX_WARM_IMAGES = 32;
	const warmImages = new Map<string, HTMLImageElement>();
	function keepWarm(src: string, image: HTMLImageElement) {
		warmImages.delete(src);
		warmImages.set(src, image);
		if (warmImages.size > MAX_WARM_IMAGES) {
			const oldest = warmImages.keys().next().value;
			if (oldest !== undefined) warmImages.delete(oldest);
		}
	}
</script>

<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import type { HTMLImgAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import { AVATAR_STATUS_KEY, type AvatarStatusContext } from './avatar-context.js';

	let {
		ref = $bindable(null),
		src = undefined,
		class: className,
		style = undefined,
		...restProps
	}: WithElementRef<HTMLImgAttributes> = $props();

	const avatar = getContext<AvatarStatusContext>(AVATAR_STATUS_KEY);

	// Warm srcs decode synchronously with the first paint (the bitmap is in
	// the HTTP cache / keep-alive); cold ones stay async so a slow network
	// never blocks the surrounding UI.
	let decoding = $state<'async' | 'sync'>('async');

	// Warm srcs paint on the first frame; the preload effect below now only
	// serves first-time loads. Deliberately a one-shot read at mount.
	untrack(() => {
		if (src && warmImages.has(src)) {
			decoding = 'sync';
			avatar.set('loaded');
		}
	});

	// Preload with a detached image so the visible <img> never flashes a
	// half-loaded state. Cleanup detaches the handlers: nothing may fire (or
	// touch component state) after this component is destroyed.
	$effect(() => {
		if (!src) {
			avatar.set('error');
			return;
		}
		// Warm remount: pinned bytes already cover this src — a detached
		// re-preload would only duplicate the fetch/decode work.
		if (warmImages.has(src)) {
			decoding = 'sync';
			avatar.set('loaded');
			return;
		}
		decoding = 'async';
		const image = new Image();
		image.src = src;
		// A detached image is otherwise never rendered, so nothing forces its
		// decode — request it now so the pinned element holds decoded bytes.
		image.decode?.().catch(() => undefined);
		image.onload = () => {
			keepWarm(src, image);
			avatar.set('loaded');
		};
		image.onerror = () => avatar.set('error');
		return () => {
			image.onload = null;
			image.onerror = null;
		};
	});
</script>

<img
	bind:this={ref}
	{src}
	{decoding}
	data-slot="avatar-image"
	data-status={avatar.status}
	style:display={avatar.status === 'loaded' ? 'block' : 'none'}
	{style}
	class={cn('aspect-square size-full rounded-full object-cover', className)}
	onerror={() => {
		// A warm src can still die later (expired link, deleted avatar): drop it so
		// the fallback shows and the next mount re-probes instead of trusting it.
		if (src) warmImages.delete(src);
		avatar.set('error');
	}}
	{...restProps}
/>
