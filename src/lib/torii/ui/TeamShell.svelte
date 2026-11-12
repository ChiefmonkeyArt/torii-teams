<script lang="ts">
	// Torii's own team UI (ADR 0005): project list + one chat per project.
	// Mounted by /chat/+layout in Torii builds; the engine effects stay there.
	import type { Snippet } from 'svelte';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { activeAccount, logout } from '$lib/services/accountManager.svelte';
	import { watchableGroupsSignature } from '$lib/services/chatGroupWatch.svelte';
	import { signerReadinessStore } from '$lib/services/signerReadiness.svelte';
	import { chatReconnectStatusStore } from '$lib/services/chatReconnectStatus.svelte';
	import MemberName from './MemberName.svelte';
	import TeamProjectList from './TeamProjectList.svelte';
	import DevicePanel from './DevicePanel.svelte';
	import TeamSignIn from './TeamSignIn.svelte';
	import {
		checkInvite,
		continuumClient,
		hasContinuumSession,
		projectChannels,
		projectGroup,
		refreshProjectChannels,
		renewContinuumSession,
		reportReady,
		reportReadyWaiting,
		requestSessionHandoff,
		signInToContinuum,
		signOutOfContinuum
	} from '../projectChannels.svelte';
	import {
		SYNC_INTERVAL_MS,
		WAIT_CHECK_MS,
		rosterSync,
		rosterSyncedReport,
		syncRosters
	} from '../rosterSync.svelte';
	import { OWNER_QUICK_MS, ownerQuickCheckDue, waitingKey } from '../rosterPlan';
	import {
		applyEmbedMode,
		initialShown,
		isEmbedded,
		navigateTarget,
		openComputersMessage,
		rosterChangedSlug,
		searchMessage,
		themeModeMessage,
		unreadReport,
		visibleMessage
	} from './embed';
	import { settled } from './settled.svelte';
	import { listChatGroups } from '$lib/services/chatGroups.svelte';
	import { getUnreadChatGroupMessageCount } from '$lib/services/chatGroupPresence.svelte';
	import { embedState, shellLayout } from './embedState.svelte';
	import { maintainReachability, reachabilityStore } from '$lib/services/chatKeyPackages.svelte';
	import { safeNormalizePubKey } from '$lib/utils';
	import { teamReachability } from '../teamReachability';
	import { getCoordinatorHealthTone } from '$lib/services/coordinatorHealth.svelte';
	import { chatServerDown, showReachabilityFix, SERVER_DOWN_TEXT } from '../serverDown';

	let { children }: { children: Snippet } = $props();

	let embedded = $state(false);
	// Before any child renders (ADR 0023 §2): a hidden frame must never mark
	// the first visible rows read.
	if (typeof window !== 'undefined') {
		embedState.on = isEmbedded(window, page.url);
		embedState.shown = initialShown(page.url);
	}
	onMount(() => {
		embedded = isEmbedded(window, page.url);
		embedState.on = embedded;
	});

	// Nostr sign-in leads straight into Continuum's challenge, once per account
	// per page load (a declined prompt leaves the Continue button). Inside
	// Continuum's Team view the owner is already signed in there, so ask it
	// for the session first: no second challenge (ADR 0008).
	const triedContinuumFor = new Set<string>();
	$effect(() => {
		const pubkey = $activeAccount?.pubkey;
		const status = projectChannels.status;
		if (!pubkey || status !== 'signed-out' || triedContinuumFor.has(pubkey)) return;
		triedContinuumFor.add(pubkey);
		void untrack(async () => {
			// A stored session (reload, new tab): no challenge, just load it.
			if (hasContinuumSession(pubkey)) return refreshProjectChannels({ force: true });
			if (embedded) {
				projectChannels.status = 'signing-in';
				if (await requestSessionHandoff()) return refreshProjectChannels({ force: true });
			}
			return signInToContinuum();
		});
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
	// ADR 0019: while a teammate on a project you own is not in its chat yet,
	// check every 15 s for up to 15 minutes after the list changed (or the
	// page opened), so someone who signs in is added in seconds. Continuum
	// reads only; the coordinator is asked only once they reported ready.
	const ownedWaiting = $derived.by(() => {
		const me = safeNormalizePubKey($activeAccount?.pubkey ?? '');
		const mine: Record<string, string[]> = {};
		for (const [slug, list] of Object.entries(rosterSync.waiting)) {
			if (me && projectChannels.owners[slug] === me) mine[slug] = list;
		}
		return waitingKey(mine);
	});
	let quickSince = Date.now();
	let quickAt = Date.now();
	$effect(() => {
		void ownedWaiting;
		quickSince = Date.now();
	});
	onMount(() => {
		const tick = () => {
			if (document.visibilityState !== 'visible') return;
			if (projectChannels.status === 'waiting') void checkInvite();
			else void refreshThenSync();
		};
		// Renewal is network only (no signer), so focus is safe here (ADR 0008).
		// So is asking whether the owner let us in (ADR 0009).
		const renew = () => {
			if (document.visibilityState !== 'visible') return;
			if (projectChannels.status === 'waiting') void checkInvite();
			else void renewContinuumSession();
		};
		window.addEventListener('focus', renew);
		document.addEventListener('visibilitychange', renew);
		const id = setInterval(() => {
			quickAt = Date.now();
			tick();
		}, SYNC_INTERVAL_MS);
		const quickId = setInterval(() => {
			if (document.visibilityState !== 'visible' || projectChannels.status !== 'ready') return;
			const now = Date.now();
			if (!ownerQuickCheckDue({ now, key: ownedWaiting, since: quickSince, lastAt: quickAt }))
				return;
			quickAt = now;
			void refreshThenSync();
		}, OWNER_QUICK_MS / 3);
		// Waiting to be let in (ADR 0010): ask more often so the chat opens soon
		// after the owner presses Let in. Network only; stops once in or refused.
		const waitId = setInterval(() => {
			if (document.visibilityState === 'visible' && projectChannels.status === 'waiting')
				void checkInvite();
		}, WAIT_CHECK_MS);
		const onMessage = (e: MessageEvent) => {
			const origin = continuumClient()?.origin;
			if (!origin || e.origin !== origin) return;
			const data = e.data as { type?: unknown } | null;
			if (data?.type === 'torii:roster-changed') {
				// ADR 0015: answer the parent with counts once the pass is done.
				const slug = rosterChangedSlug(e, window.parent, origin);
				const reply = (failed: boolean) => {
					if (slug) window.parent.postMessage(rosterSyncedReport(slug, failed), origin);
				};
				void refreshThenSync().then(
					() => reply(false),
					() => reply(true)
				);
			}
			// ADR 0021: Continuum's light or dark, and its Your computers button.
			const mode = themeModeMessage(e, window.parent, origin);
			if (mode) applyEmbedMode(document.documentElement, mode);
			if (openComputersMessage(e, window.parent, origin)) embedState.computers = true;
			// ADR 0023: shown/hidden (read-marking) and the strip's Search button.
			const shown = visibleMessage(e, window.parent, origin);
			if (shown !== null) embedState.shown = shown;
			if (searchMessage(e, window.parent, origin)) embedState.search = true;
			// Continuum's one frame (ADR 0010): show the project it asks for.
			const to = navigateTarget(e, window.parent, origin);
			if (to !== null) {
				const href = to ? resolve('/chat/p/[slug]', { slug: to }) : resolve('/chat');
				if (href !== page.url.pathname) void goto(href, { keepFocus: true, noScroll: true });
			}
		};
		window.addEventListener('message', onMessage);
		return () => {
			clearInterval(id);
			clearInterval(quickId);
			clearInterval(waitId);
			window.removeEventListener('message', onMessage);
			window.removeEventListener('focus', renew);
			document.removeEventListener('visibilitychange', renew);
		};
	});

	// Can the team add me? (ADR 0004). The startup pass can run before the node
	// file adds the node coordinator, so re-check once per account.
	const me = $derived(safeNormalizePubKey($activeAccount?.pubkey ?? ''));
	const node = $derived(safeNormalizePubKey(projectChannels.coordinator));
	const reach = $derived(teamReachability(node, me, reachabilityStore));
	// ADR 0020: a failed request since the last success = say so.
	// No server key yet: nothing to ask (the health lookup throws on '').
	const serverDown = $derived(node ? chatServerDown(node, getCoordinatorHealthTone(node)) : false);
	// ADR 0023 §6: only once it has held, so a check still settling never flashes.
	const fixSettled = settled(() => showReachabilityFix(reach, serverDown), false);
	const fixShown = $derived(fixSettled.current);

	// ADR 0023 §4: unread counts per project for Continuum's tab and sidebar.
	let lastUnread = '';
	$effect(() => {
		if (!embedded) return;
		// Reactive reads first: continuumClient() is a plain value, so an early
		// return on it would leave this effect with nothing to re-run on.
		void listChatGroups().length; // re-count when chats change
		const counts: Record<string, number> = {};
		for (const p of projectChannels.projects) {
			const group = projectGroup(p.slug);
			counts[p.slug] = group ? getUnreadChatGroupMessageCount(group.id) : 0;
		}
		const origin = continuumClient()?.origin;
		if (!origin) return;
		const report = unreadReport(counts);
		const key = JSON.stringify(report.counts);
		if (key === lastUnread) return;
		lastUnread = key;
		window.parent.postMessage(report, origin);
	});
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
	// Waiting on an invite: say we can be added, so the owner's "Let in" is enough.
	$effect(() => {
		if (reach !== 'ready' || projectChannels.status !== 'waiting') return;
		void untrack(() => reportReadyWaiting());
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
	const layout = $derived(shellLayout(embedded, onHome));

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
		<!-- Phones: the list is the home page; desktop: always beside the chat.
			Inside Continuum, no list: one project at a time (ADR 0017). -->
		{#if layout.list}
			<aside
				class="{onHome
					? 'flex w-full'
					: 'hidden'} min-h-0 flex-col border-border pt-safe md:flex md:w-64 md:shrink-0 md:border-r"
			>
				{#if !embedded}
					<div class="flex items-center gap-2 px-5 pt-4 pb-2 text-base font-semibold">
						<!-- ADR 0014: the tab's own icon, already loaded, so no extra bytes. -->
						<img
							src="/favicon.svg"
							alt=""
							aria-hidden="true"
							width="20"
							height="20"
							class="size-5 rounded"
							data-testid="teams-mark"
						/>Teams
					</div>
				{/if}
				<div class="min-h-0 flex-1 overflow-y-auto">
					<TeamProjectList />
				</div>
				<!-- ADR 0016: computers that may reach the team's private git. -->
				<DevicePanel />
				{#if fixShown}
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
				<!-- Embedded, Continuum's account menu is the one identity (ADR 0010). -->
				{#if !embedded}
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
				{/if}
			</aside>
		{/if}
		<main class="{layout.main} relative min-w-0 flex-1 flex-col pt-safe">
			<!-- ADR 0021 §3: inside Continuum, opened from its strip. -->
			{#if embedded}<DevicePanel variant="embed" />{/if}
			{#if signerReadinessStore.waiting}
				<div class="border-b border-border bg-muted/60 px-3 py-1 text-sm text-muted-foreground">
					Waiting for your Nostr signer…
				</div>
			{:else if serverDown}
				<div
					class="border-b border-border bg-destructive/10 px-3 py-1 text-sm text-destructive"
					role="status"
					data-testid="server-down"
				>
					{SERVER_DOWN_TEXT}
				</div>
			{:else if chatReconnectStatusStore.active}
				<div class="border-b border-border bg-muted/60 px-3 py-1 text-sm text-muted-foreground">
					{chatReconnectStatusStore.message}
				</div>
			{/if}
			{#if !layout.list && fixShown}
				<div class="flex items-center gap-2 border-b border-border px-3 py-1 text-sm">
					<p class="min-w-0 flex-1">
						Your team can't add you yet.{#if fixError}
							<span class="text-xs text-muted-foreground">{fixError}</span>{/if}
					</p>
					<button
						type="button"
						class="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60"
						disabled={fixing}
						onclick={fixReachability}>{fixing ? 'Fixing…' : 'Fix it'}</button
					>
				</div>
			{/if}
			<div class="min-h-0 flex-1">
				{#if teamRoute}{@render children()}{/if}
			</div>
		</main>
	{/if}
</div>
