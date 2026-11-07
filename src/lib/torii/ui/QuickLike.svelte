<script lang="ts">
	/**
	 * One tap likes a message (👍), press and hold opens the emoji row
	 * (ADR 0010 §5, owner 2026-11-07: "1 tap thumbs up long hold emoji row").
	 * Right-click opens the emoji row too. Tapping again removes the like.
	 */
	import { onDestroy } from 'svelte';

	let {
		active = false,
		onLike,
		onHold,
		holdMs = 450
	}: {
		active?: boolean;
		onLike: () => void | Promise<void>;
		onHold: (touch: boolean) => void;
		holdMs?: number;
	} = $props();

	let timer: ReturnType<typeof setTimeout> | null = null;
	let held = false;
	let opened = false;
	let touchHold = false;
	let startX = 0;
	let startY = 0;

	function clearTimer() {
		if (timer) clearTimeout(timer);
		timer = null;
	}

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		// The bubble's own long-press/swipe must not start from this button.
		e.stopPropagation();
		held = false;
		opened = false;
		startX = e.clientX;
		startY = e.clientY;
		clearTimer();
		touchHold = e.pointerType !== 'mouse';
		// The row opens on release: opened mid-press, the release would count
		// as a click outside and close it straight away.
		timer = setTimeout(() => {
			timer = null;
			held = true;
			navigator.vibrate?.(10);
		}, holdMs);
	}

	function openRow(touch: boolean) {
		if (opened) return;
		opened = true;
		onHold(touch);
	}

	function up() {
		clearTimer();
		if (held) openRow(touchHold);
	}

	function move(e: PointerEvent) {
		if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) clearTimer();
	}

	function click(e: MouseEvent) {
		e.stopPropagation();
		if (held) {
			held = false;
			opened = false;
			return;
		}
		void onLike();
	}

	function menu(e: MouseEvent) {
		e.preventDefault();
		// A touch long-press can end here instead of in pointerup.
		const touch = held && touchHold;
		clearTimer();
		openRow(touch);
		if (!held) opened = false;
	}

	onDestroy(clearTimer);
</script>

<button
	type="button"
	data-testid="quick-like"
	class="quick-like inline-flex size-7 items-center justify-center rounded-full text-sm transition-[transform,opacity] select-none [-webkit-touch-callout:none] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
	class:active
	aria-pressed={active}
	aria-label={active ? 'Remove your thumbs up' : 'Thumbs up. Press and hold for more'}
	title={active ? 'Remove your thumbs up' : 'Thumbs up (press and hold for more)'}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onpointerleave={clearTimer}
	onclick={click}
	oncontextmenu={menu}><span aria-hidden="true">👍</span></button
>

<style>
	.quick-like {
		opacity: 0.55;
		filter: grayscale(1);
		touch-action: manipulation;
	}
	.quick-like:hover,
	.quick-like:focus-visible,
	.quick-like.active {
		opacity: 1;
		filter: none;
	}
	.quick-like:active {
		transform: scale(1.2);
	}
</style>
