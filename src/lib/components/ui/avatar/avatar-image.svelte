<script module lang="ts">
	// Session-wide "this src has loaded" memory: remounts (e.g. the chat list
	// rebuilding after a settings round-trip) would otherwise hide every image
	// behind the detached-preload round trip and flash the fallback first.
	const loadedSrcs = new Set<string>();

	// Decoded-bitmap keep-alive: holding the decoded HTMLImageElement pins its
	// bitmap so remounts paint warm srcs on the first frame instead of the
	// WebView re-decoding (and popping) them. Bounded LRU — re-set refreshes
	// recency, eviction only costs a future re-decode.
	const MAX_KEPT_IMAGES = 64;
	const keptImages = new Map<string, HTMLImageElement>();
	function keepDecoded(src: string, image: HTMLImageElement) {
		keptImages.delete(src);
		keptImages.set(src, image);
		if (keptImages.size > MAX_KEPT_IMAGES) {
			const oldest = keptImages.keys().next().value;
			if (oldest !== undefined) keptImages.delete(oldest);
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
		if (src && loadedSrcs.has(src)) {
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
		// Warm remount: the caches already hold this bitmap — a detached
		// re-preload would only duplicate the fetch/decode work.
		if (loadedSrcs.has(src)) {
			decoding = 'sync';
			avatar.set('loaded');
			return;
		}
		decoding = 'async';
		const image = new Image();
		image.src = src;
		// A detached image is otherwise never rendered, so nothing forces its
		// decode — request it now so the keep-alive below holds a decoded bitmap.
		image.decode?.().catch(() => undefined);
		image.onload = () => {
			loadedSrcs.add(src);
			keepDecoded(src, image);
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
		if (src) loadedSrcs.delete(src);
		avatar.set('error');
	}}
	{...restProps}
/>
