<script lang="ts">
	// The invite welcome (ADR 0010): the shisa pair, AI on the left (closed
	// mouth), the human on the right (open-mouthed laugh, waving). Bundled
	// (no outside request), 40 KB, CSS-only motion that stops for
	// prefers-reduced-motion. `lively` adds the pop-in, the bob and the
	// twinkles (a personal invite or a fresh join); otherwise it sits still.
	import shisaPair from './shisa-pair.webp';

	let { lively = false, size = 200 }: { lively?: boolean; size?: number } = $props();
</script>

<div
	class="shisa-welcome"
	class:lively
	style:--shisa-w="{size}px"
	data-testid="shisa-welcome"
	aria-hidden="true"
>
	<span class="glow"></span>
	<img src={shisaPair} alt="" width="480" height="333" decoding="async" />
	{#if lively}
		<span class="spark s1"></span>
		<span class="spark s2"></span>
		<span class="spark s3"></span>
	{/if}
</div>

<style>
	.shisa-welcome {
		position: relative;
		width: var(--shisa-w);
		aspect-ratio: 480 / 333;
		margin: 0 auto 0.75rem;
	}
	img {
		position: relative;
		display: block;
		width: 100%;
		height: auto;
		user-select: none;
		pointer-events: none;
	}
	.glow {
		position: absolute;
		inset: 8% 4% -6%;
		border-radius: 50%;
		background: radial-gradient(closest-side, hsl(38 92% 56% / 0.32), transparent);
		filter: blur(6px);
	}
	.spark {
		position: absolute;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: hsl(42 100% 70%);
		box-shadow: 0 0 8px hsl(42 100% 62%);
		opacity: 0;
	}
	.s1 {
		left: 4%;
		top: 14%;
	}
	.s2 {
		right: 2%;
		top: 4%;
		width: 5px;
		height: 5px;
	}
	.s3 {
		right: 44%;
		top: -4%;
		width: 4px;
		height: 4px;
	}

	@media (prefers-reduced-motion: no-preference) {
		.lively img {
			animation:
				shisa-pop 700ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both,
				shisa-bob 3.6s ease-in-out 700ms infinite;
		}
		.lively .glow {
			animation: shisa-glow 3.6s ease-in-out infinite;
		}
		.lively .spark {
			animation: shisa-twinkle 2.4s ease-in-out infinite;
		}
		.lively .s2 {
			animation-delay: 0.8s;
		}
		.lively .s3 {
			animation-delay: 1.6s;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spark {
			display: none;
		}
	}
	@keyframes shisa-pop {
		from {
			opacity: 0;
			transform: translateY(18px) scale(0.86);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes shisa-bob {
		0%,
		100% {
			transform: translateY(0) rotate(0);
		}
		50% {
			transform: translateY(-5px) rotate(-0.6deg);
		}
	}
	@keyframes shisa-glow {
		0%,
		100% {
			opacity: 0.7;
		}
		50% {
			opacity: 1;
		}
	}
	@keyframes shisa-twinkle {
		0%,
		100% {
			opacity: 0;
			transform: scale(0.4);
		}
		45% {
			opacity: 1;
			transform: scale(1);
		}
		70% {
			opacity: 0;
			transform: scale(0.6);
		}
	}
</style>
