<script lang="ts">
	// Test stand-in for AccountLoginDialog (TeamSignIn.svelte.test.ts).
	let {
		triggerLabel = 'Sign in',
		triggerClass = ''
	}: { triggerLabel?: string; triggerClass?: string } = $props();
</script>

<button type="button" class={triggerClass} data-testid="login-stub">{triggerLabel}</button>
