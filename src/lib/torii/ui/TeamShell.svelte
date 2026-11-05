<script lang="ts">
	// Torii's own team UI (ADR 0005): project list + one chat per project.
	// Mounted by /chat/+layout in Torii builds; the engine effects stay there.
	import type { Snippet } from 'svelte';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { activeAccount, logout } from '$lib/services/accountManager.svelte';
	import { watchableGroupsSignature } from '$lib/services/chatGroupWatch.svelte';
	import { signerReadinessStore } from '$lib/services/signerReadiness.svelte';
	import { chatReconnectStatusStore } from '$lib/services/chatReconnectStatus.svelte';
	import MemberName from './MemberName.svelte';
	import TeamProjectList from './TeamProjectList.svelte';
	import TeamSignIn from './TeamSignIn.svelte';
	import {
		continuumClient,
		projectChannels,
		refreshProjectChannels,
		reportReady,
		signInToContinuum,
		signOutOfContinuum
	} from '../projectChannels.svelte';
	import { SYNC_INTERVAL_MS, syncRosters } from '../rosterSync.svelte';
	import { isEmbedded } from './embed';
	import { maintainReachability, reachabilityStore } from '$lib/services/chatKeyPackages.svelte';
	import { safeNormalizePubKey } from '$lib/utils';
	import { teamReachability } from '../teamReachability';

	let { children }: { children: Snippet } = $props();

	let embedded = $state(false);
	onMount(() => {
		embedded = isEmbedded(window, page.url);
	});

	// Nostr sign-in leads straight into Continuum's challenge, once per account
	// per page load (a declined prompt leaves the Continue button).
	const triedContinuumFor = new Set<string>();
	$effect(() => {
		const pubkey = $activeAccount?.pubkey;
		const status = projectChannels.status;
		if (!pubkey || status !== 'signed-out' || triedContinuumFor.has(pubkey)) return;
		triedContinuumFor.add(pubkey);
		void untrack(() => signInToContinuum());
	});

	// Roster ⇄ chat membership: on load, when chats change, and a paced check
	// while visible. Never on window focus: closing a signer popup refocuses
	// the page, which would open the next popup (endless prompts, torii.4).
	const groupsKey = $derived(watchableGroupsSignature());
	$effect(() => {
		void groupsKey;
		if (projectChannels.status !== 'ready' || !$activeAccount) return;
		void untrack(() => syncRosters());
	});
	// ADR 0006: every tick also re-reads /api/team/me and the rosters quietly
	// (bearer only, no signer), so a new project, teammate or "added" shows up
	// without a reload. Continuum's Team page posts `torii:roster-changed`
	// after a save, which does the same at once.
	const refreshThenSync = async () => {
		await refreshProjectChannels({ force: true, quiet: true });
		await syncRosters();
	};
	onMount(() => {
		const tick = () => {
			if (document.visibilityState === 'visible') void refreshThenSync();
		};
		const id = setInterval(tick, SYNC_INTERVAL_MS);
		const onMessage = (e: MessageEvent) => {
			const origin = continuumClient()?.origin;
			if (!origin || e.origin !== origin) return;
			const data = e.data as { type?: unknown } | null;
			if (data?.type === 'torii:roster-changed') void refreshThenSync();
		};
		window.addEventListener('message', onMessage);
		return () => {
			clearInterval(id);
			window.removeEventListener('message', onMessage);
		};
	});

	// Can the team add me? (ADR 0004). The startup pass can run before the node
	// file adds the node coordinator, so re-check once per account.
	const me = $derived(safeNormalizePubKey($activeAccount?.pubkey ?? ''));
	const node = $derived(safeNormalizePubKey(projectChannels.coordinator));
	const reach = $derived(teamReachability(node, me, reachabilityStore));
	let recheckedFor = '';
	$effect(() => {
		if (!node || !me || recheckedFor === me) return;
		if (!reachabilityStore.checked || reachabilityStore.ownerPubkey !== me) return;
		if (reach !== 'checking') return;
		recheckedFor = me;
		void maintainReachability().catch(() => undefined);
	});
	// Ready only once our key package is confirmed on the node coordinator.
	$effect(() => {
		if (reach !== 'ready' || projectChannels.status !== 'ready' || projectChannels.ready !== false)
			return;
		void untrack(() => reportReady());
	});
	let fixing = $state(false);
	let fixError = $state('');
	async function fixReachability() {
		fixing = true;
		fixError = '';
		try {
			await maintainReachability({ publish: true });
			if (teamReachability(node, me, reachabilityStore) !== 'ready')
				fixError = 'Still not reachable.';
		} catch (error) {
			fixError = error instanceof Error ? error.message : String(error);
		} finally {
			fixing = false;
		}
	}

	// A new account (sign-in, switch): load its projects with any stored session.
	$effect(() => {
		void $activeAccount?.pubkey;
		void untrack(() => refreshProjectChannels());
	});

	const ready = $derived(Boolean($activeAccount) && projectChannels.status === 'ready');
	const onHome = $derived(page.url.pathname === resolve('/chat'));
	// Only the team routes render here; the root layout redirects the rest.
	const teamRoute = $derived(onHome || page.url.pathname.startsWith(resolve('/chat/p')));

	function signOut() {
		signOutOfContinuum();
		logout();
	}
</script>

<div class="flex h-dvh min-h-dvh bg-background pr-inset pl-inset text-foreground">
	{#if !ready}
		<main class="min-w-0 flex-1 pt-safe">
			<TeamSignIn {embedded} />
		</main>
	{:else}
		<!-- Phones: the list is the home page; desktop: always beside the chat. -->
		<aside
			class="{onHome
				? 'flex w-full'
				: 'hidden'} min-h-0 flex-col border-border pt-safe md:flex md:w-64 md:shrink-0 md:border-r"
		>
			{#if !embedded}
				<div class="px-5 pt-4 pb-2 text-base font-semibold">Teams</div>
			{/if}
			<div class="min-h-0 flex-1 overflow-y-auto">
				<TeamProjectList />
			</div>
			{#if reach === 'missing'}
				<div class="border-t border-border px-3 py-2 text-sm">
					<p>Your team can't add you yet.</p>
					{#if fixError}<p class="text-xs text-muted-foreground">{fixError}</p>{/if}
					<button
						type="button"
						class="mt-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60"
						disabled={fixing}
						onclick={fixReachability}>{fixing ? 'Fixing…' : 'Fix it'}</button
					>
				</div>
			{/if}
			<div class="flex items-center gap-2 border-t border-border px-3 py-2 text-sm">
				<span class="min-w-0 flex-1">
					<MemberName pubkey={$activeAccount!.pubkey} />
				</span>
				<button
					type="button"
					class="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={signOut}>Sign out</button
				>
			</div>
		</aside>
		<main class="{onHome ? 'hidden md:flex' : 'flex'} relative min-w-0 flex-1 flex-col pt-safe">
			{#if signerReadinessStore.waiting}
				<div class="border-b border-border bg-muted/60 px-3 py-1 text-sm text-muted-foreground">
					Waiting for your Nostr signer…
				</div>
			{:else if chatReconnectStatusStore.active}
				<div class="border-b border-border bg-muted/60 px-3 py-1 text-sm text-muted-foreground">
					{chatReconnectStatusStore.message}
				</div>
			{/if}
			<div class="min-h-0 flex-1">
				{#if teamRoute}{@render children()}{/if}
			</div>
		</main>
	{/if}
</div>
