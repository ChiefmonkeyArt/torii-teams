<script lang="ts">
	// ADR 0023 §6: one calm loading ring, the same as Continuum's. The arc
	// sweeps round a faint track; reduced motion gets a slow pulse instead.
	let { label = 'Loading project' }: { label?: string } = $props();
</script>

<div
	class="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground"
	role="status"
	aria-live="polite"
	data-testid="team-loading"
>
	<svg class="team-ring size-10" viewBox="0 0 40 40" aria-hidden="true">
		<circle
			cx="20"
			cy="20"
			r="16"
			fill="none"
			stroke="currentColor"
			stroke-opacity=".18"
			stroke-width="3"
		/>
		<circle
			class="team-arc"
			cx="20"
			cy="20"
			r="16"
			fill="none"
			stroke="var(--primary)"
			stroke-width="3"
			stroke-linecap="round"
			stroke-dasharray="100.5"
		/>
	</svg>
	<p>{label}<span class="team-dots" aria-hidden="true"></span></p>
</div>

<style>
	.team-ring {
		animation: team-spin 1.4s linear infinite;
	}
	.team-arc {
		transform-origin: center;
		animation: team-sweep 1.4s ease-in-out infinite;
	}
	.team-dots::after {
		content: '';
		animation: team-dots 1.4s steps(4, end) infinite;
	}
	@keyframes team-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes team-sweep {
		0% {
			stroke-dashoffset: 95;
		}
		50% {
			stroke-dashoffset: 30;
			transform: rotate(120deg);
		}
		100% {
			stroke-dashoffset: 95;
			transform: rotate(360deg);
		}
	}
	@keyframes team-dots {
		0% {
			content: '';
		}
		25% {
			content: '.';
		}
		50% {
			content: '..';
		}
		75% {
			content: '...';
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.team-ring,
		.team-arc,
		.team-dots::after {
			animation: none;
		}
		.team-arc {
			stroke-dashoffset: 70;
			animation: team-pulse 2s ease-in-out infinite;
		}
		@keyframes team-pulse {
			50% {
				opacity: 0.4;
			}
		}
	}
</style>
