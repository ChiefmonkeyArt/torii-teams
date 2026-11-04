<script lang="ts">
	// Signed out (ADR 0005): one line and one button. Nostr sign-in, then the
	// Continuum challenge is signed straight away by TeamShell.
	import AccountLoginDialog from '$lib/components/AccountLoginDialog.svelte';
	import { activeAccount } from '$lib/services/accountManager.svelte';
	import { projectChannels, signInToContinuum } from '../projectChannels.svelte';

	let { embedded = false }: { embedded?: boolean } = $props();
</script>

<div class="flex h-full items-center justify-center px-6">
	<div class="w-full max-w-xs space-y-4 text-center">
		{#if !embedded}<h1 class="text-xl font-semibold">Teams</h1>{/if}
		{#if !$activeAccount}
			<p class="text-sm text-muted-foreground">Sign in so your team can add you.</p>
			<AccountLoginDialog triggerLabel="Sign in" triggerClass="w-full" />
		{:else if projectChannels.status === 'signing-in' || projectChannels.status === 'loading'}
			<p class="text-sm text-muted-foreground">Signing in…</p>
		{:else if projectChannels.status === 'error'}
			<p class="text-sm text-muted-foreground">{projectChannels.error}</p>
			<button
				type="button"
				class="w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
				onclick={() => void signInToContinuum()}>Try again</button
			>
		{:else}
			<p class="text-sm text-muted-foreground">Confirm it's you to see your projects.</p>
			<button
				type="button"
				class="w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
				onclick={() => void signInToContinuum()}>Continue</button
			>
		{/if}
	</div>
</div>
