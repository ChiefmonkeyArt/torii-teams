<script lang="ts">
	// Signed out (ADR 0005, ADR 0008): one consent card and one button. The
	// card says up front that the signer asks once; the button's click starts
	// every signer call back to back (key, Continuum challenge, coordinator),
	// so there are no surprise prompts later.
	import { onMount } from 'svelte';
	import AccountLoginDialog from '$lib/components/AccountLoginDialog.svelte';
	import { activeAccount } from '$lib/services/accountManager.svelte';
	import { projectChannels, signInToContinuum } from '../projectChannels.svelte';
	import { detectSigner, signerHint, type SignerKind } from '../signerPermissions';

	let { embedded = false }: { embedded?: boolean } = $props();

	let signer = $state<SignerKind>('none');
	onMount(() => {
		signer = detectSigner(window as { nostr?: unknown });
	});
	const busy = $derived(
		projectChannels.status === 'signing-in' || projectChannels.status === 'loading'
	);
</script>

<div class="flex h-full items-center justify-center px-6">
	<div class="w-full max-w-xs space-y-4 text-center" data-testid="team-consent">
		{#if !embedded}<h1 class="text-xl font-semibold">Teams</h1>{/if}
		{#if busy}
			<p class="text-sm text-muted-foreground">Signing in…</p>
		{:else}
			<div class="space-y-1">
				<p class="font-medium">Sign in to your team</p>
				<p class="text-sm text-muted-foreground">Your signer will ask once.</p>
				<p class="text-xs text-muted-foreground" data-testid="signer-hint">{signerHint(signer)}</p>
			</div>
			{#if projectChannels.status === 'error'}
				<p class="text-sm text-muted-foreground">{projectChannels.error}</p>
			{/if}
			{#if !$activeAccount}
				<AccountLoginDialog triggerLabel="Sign in" triggerClass="w-full" />
			{:else}
				<button
					type="button"
					class="w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
					onclick={() => void signInToContinuum()}
					>{projectChannels.status === 'error' ? 'Try again' : 'Sign in'}</button
				>
			{/if}
		{/if}
	</div>
</div>
