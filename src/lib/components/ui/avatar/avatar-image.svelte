<script module lang="ts">
	// Session-wide "this src has loaded" memory: remounts (chat list rebuild,
	// group open/close, mobile sidebar sheet) paint the picture on the first
	// frame instead of re-running the detached-preload round trip and flashing
	// the fallback first. Strings only, unbounded on purpose: a bounded LRU
	// (a past attempt) evicted older chats' avatars and reintroduced the
	// fallback flash on every remount — the exact blink this set exists to kill.
	const loadedSrcs = new Set<string>();
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

	// Warm srcs paint on the first frame; the preload effect below only
	// serves first-time loads. Deliberately a one-shot read at mount.
	untrack(() => {
		if (src && loadedSrcs.has(src)) avatar.set('loaded');
	});

	// Preload with a detached image so the visible <img> never flashes a
	// half-loaded state. Cleanup detaches the handlers: nothing may fire (or
	// touch component state) after this component is destroyed.
	$effect(() => {
		if (!src) {
			avatar.set('error');
			return;
		}
		// Warm remount: the session already showed this picture and the visible
		// <img> revalidates on its own (its onerror handles a since-dead URL),
		// so a detached re-preload would only duplicate the fetch/decode work.
		if (loadedSrcs.has(src)) return;
		const image = new Image();
		image.src = src;
		image.onload = () => {
			loadedSrcs.add(src);
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
