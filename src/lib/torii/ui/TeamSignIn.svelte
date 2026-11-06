<script lang="ts">
	// Signed out (ADR 0005, ADR 0008): one consent card and one button. The
	// card says up front that the signer asks once; the button's click starts
	// every signer call back to back (key, Continuum challenge, coordinator),
	// so there are no surprise prompts later. An invite link (ADR 0009) only
	// changes the words: the same one signature claims it, and while the owner
	// decides this card waits without any button that could prompt the signer.
	// ADR 0010: an invite shows the shisa pair (animated for a personal link)
	// and says plainly whether you go straight in or wait to be let in.
	import { onMount } from 'svelte';
	import AccountLoginDialog from '$lib/components/AccountLoginDialog.svelte';
	import { activeAccount } from '$lib/services/accountManager.svelte';
	import { INVITE_GONE } from '../continuumApi';
	import { projectChannels, signInToContinuum } from '../projectChannels.svelte';
	import { detectSigner, signerHint, type SignerKind } from '../signerPermissions';
	import ShisaWelcome from './ShisaWelcome.svelte';

	let { embedded = false }: { embedded?: boolean } = $props();

	let signer = $state<SignerKind>('none');
	onMount(() => {
		signer = detectSigner(window as { nostr?: unknown });
	});
	const busy = $derived(
		projectChannels.status === 'signing-in' || projectChannels.status === 'loading'
	);
	const invite = $derived(projectChannels.invite);
	const owner = $derived(invite?.ownerName || 'The owner');
	const asked = $derived(invite?.ownerName || 'the owner');
	const project = $derived(invite?.projectName || 'their project');
</script>

<div class="flex h-full items-center justify-center px-6">
	<div class="w-full max-w-xs space-y-4 text-center" data-testid="team-consent">
		{#if invite && projectChannels.status !== 'error'}
			<ShisaWelcome lively={Boolean(invite.personal) || projectChannels.status === 'waiting'} />
		{:else if !embedded}<h1 class="text-xl font-semibold">Teams</h1>{/if}
		{#if projectChannels.status === 'waiting'}
			<div class="space-y-1" data-testid="invite-waiting">
				<p class="font-medium">Asked {asked} to let you in to {project}.</p>
				<p class="text-sm text-muted-foreground">
					This page opens the chat by itself when they do. You can close it and come back to this
					link later.
				</p>
			</div>
		{:else if projectChannels.status === 'error' && projectChannels.error === INVITE_GONE}
			<!-- A dead or declined link: one plain line, nothing that prompts the signer.
			     Reloading the page offers a normal sign-in. -->
			<p class="text-sm text-muted-foreground" data-testid="invite-gone">{INVITE_GONE}</p>
		{:else if busy}
			<p class="text-sm text-muted-foreground">Signing in…</p>
		{:else}
			<div class="space-y-1">
				{#if invite}
					<p class="font-medium" data-testid="invite-from">{owner} invited you to {project}</p>
					<p class="text-sm text-muted-foreground" data-testid="invite-how">
						{invite.straightIn
							? 'Sign in and you are straight in.'
							: `Sign in, then ${asked} lets you in.`}
					</p>
				{:else}
					<p class="font-medium">Sign in to your team</p>
				{/if}
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
