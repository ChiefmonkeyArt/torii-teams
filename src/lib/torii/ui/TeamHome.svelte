<script lang="ts">
	// /chat in Torii builds (ADR 0005). Phones show the project list (TeamShell);
	// on desktop this pane opens the only project, or asks to pick one.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { projectChannels } from '../projectChannels.svelte';

	let wide = $state(false);
	onMount(() => {
		const mq = window.matchMedia('(min-width: 768px)');
		wide = mq.matches;
		const on = (e: MediaQueryListEvent) => (wide = e.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	$effect(() => {
		const only = projectChannels.projects.length === 1 ? projectChannels.projects[0].slug : '';
		if (wide && only) void goto(resolve('/chat/p/[slug]', { slug: only }), { replaceState: true });
	});
</script>

<div class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
	{projectChannels.projects.length ? 'Pick a project.' : ''}
</div>
