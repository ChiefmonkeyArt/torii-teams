<script lang="ts">
	import AccountLoginDialog from '$lib/components/AccountLoginDialog.svelte';
	import ChatGroupListItem from '$lib/components/chat/ChatGroupListItem.svelte';
	import ChatMobileSidebarButton from '$lib/components/chat/ChatMobileSidebarButton.svelte';
	import ChatSearchBar from '$lib/components/chat/ChatSearchBar.svelte';
	import NewsListItem from '$lib/components/news/NewsListItem.svelte';
	import * as Card from '$lib/components/ui/card';
	import { browser } from '$app/environment';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { isAndroidNative } from '$lib/services/nativeBridge';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import { resolve } from '$app/paths';
	import { activeAccount } from '$lib/services/accountManager.svelte';
	import { DEFAULT_CHAT_COORDINATOR_PUBKEY } from '$lib/constants/chat';
	import { TORII_NODE_BUILD } from '$lib/torii/build';
	import TeamHome from '$lib/torii/ui/TeamHome.svelte';
	import { projectChannels } from '$lib/torii/projectChannels.svelte';
	import { migrationBannerStore } from '$lib/services/migrationBanner.svelte';
	import { listChatGroups } from '$lib/services/chatGroups.svelte';
	import { getUnreadNewsCount, isNewsItemUnread } from '$lib/news/newsReadState.svelte';
	import { getNewsFeedItems } from '$lib/news/feedItems';
	import { maintainReachability, reachabilityStore } from '$lib/services/chatKeyPackages.svelte';
	import { getCoordinatorLabel } from '$lib/services/chatCoordinators.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getChatGroupSummary,
		markAllChatGroupsRead
	} from '$lib/services/chatGroupPresence.svelte';
	import { getGroupActivityAt } from '$lib/components/chat/chatGroupDisplay';
	import { isChatGroupPinned } from '$lib/services/chatGroupPins.svelte';
	import { buildGroupSharePath } from '$lib/utils/groupShareLink';
	import { safeNormalizePubKey } from '$lib/utils';
	import { groupRouteId } from '$lib/services/chatGroupLinks.svelte';
	import { pullToRefresh } from '$lib/actions/pullToRefresh';
	import { refreshChatFeedAction } from '$lib/services/chatUiActions.svelte';
	import { appUpdateStore, reloadForUpdate } from '$lib/services/appUpdate.svelte';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import { teamReachability, teamReadyAckKey } from '$lib/torii/teamReachability';

	// Pull-to-refresh on the chat list (native shell + standalone PWA only — a plain
	// browser tab keeps the browser's own PTR as the emergency reload). When a web
	// deploy is already known, the pull installs it instead of refreshing data.
	const chatListPullToRefresh = {
		onRefresh: async () => {
			if (appUpdateStore.available) {
				reloadForUpdate();
				return;
			}
			await refreshChatFeedAction();
		},
		label: () => (appUpdateStore.available ? 'Release to update' : null)
	};

	const groups = $derived.by(() => listChatGroups());
	const newsUnreadCount = $derived.by(() => getUnreadNewsCount());
	const newsFeedItems = getNewsFeedItems();
	// News sorts exactly like a chat: its "last activity" is the newest unread
	// release's date (or the newest release once read), so livelier chats
	// naturally bubble above it and it never pins.
	const newsActivityAt = $derived.by(() => {
		const pool = newsFeedItems.filter(isNewsItemUnread);
		const items = pool.length > 0 ? pool : newsFeedItems;
		return items.reduce((latest, item) => Math.max(latest, item.createdAt), 0);
	});
	// Rows sort exactly like chats: pinned groups hold the top, then unread
	// items bubble up (newest first within the tier); read items settle by their
	// last activity. News participates with the same rule, so it is never pinned
	// above a group with newer unread activity.
	type FeedRow =
		| { kind: 'news'; unread: boolean; activityAt: number }
		| {
				kind: 'group';
				group: ReturnType<typeof listChatGroups>[number];
				unread: boolean;
				activityAt: number;
		  };
	const feedRows = $derived.by(() => {
		const rows: FeedRow[] = groups.map((group) => {
			const summary = getChatGroupSummary(group.id, $activeAccount?.pubkey);
			return {
				kind: 'group' as const,
				group,
				unread: summary.unreadCount > 0 || summary.unreadReferenceCount > 0,
				activityAt: getGroupActivityAt(group)
			};
		});
		if (newsFeedItems.length > 0) {
			rows.push({
				kind: 'news',
				unread: newsUnreadCount > 0,
				activityAt: newsActivityAt
			});
		}
		const isRowPinned = (row: FeedRow) => row.kind === 'group' && isChatGroupPinned(row.group.id);
		return rows.sort(
			(a, b) =>
				Number(isRowPinned(b)) - Number(isRowPinned(a)) ||
				Number(b.unread) - Number(a.unread) ||
				b.activityAt - a.activityAt
		);
	});
	const hasUnreadChats = $derived(feedRows.some((row) => row.kind === 'group' && row.unread));
	const hasAccount = $derived.by(() => Boolean($activeAccount));
	// Web-only storage disclaimer: browser storage is the source of truth on web,
	// so warn once (dismiss is permanent — the fact is about the browser, not the
	// account). Hidden entirely in the Android native app, where it is false.
	const WEB_STORAGE_DISCLAIMER_KEY = 'cordn.webStorageDisclaimerDismissed';
	let storageDisclaimerDismissed = $state(
		browser ? localStorage.getItem(WEB_STORAGE_DISCLAIMER_KEY) === '1' : false
	);
	const showStorageDisclaimer = $derived.by(
		() => hasAccount && !isAndroidNative() && !storageDisclaimerDismissed
	);
	function dismissStorageDisclaimer() {
		localStorage.setItem(WEB_STORAGE_DISCLAIMER_KEY, '1');
		storageDisclaimerDismissed = true;
	}
	const hasGroups = $derived.by(() => groups.length > 0);
	// Reachability callout: shown while any known coordinator VERIFIES that no
	// key package for the active identity is published there — people on that
	// coordinator cannot invite the user. Truth comes from the maintain pass's
	// verified summary (an unreachable coordinator never triggers), and with
	// auto-publish on the callout doubles as its failure surface. Dismiss is
	// permanent and per browser (like the storage disclaimer) — republishing
	// later stays possible via the key-package config page. Suppressed when the
	// migration banner detects the identity is already reachable from another
	// device — that case has its own (link/restore) UX and publishing here would
	// trigger a destructive last-resort take-over.
	// ponytail: dismissal is global, not per-account; key it by pubkey if
	// multi-account users complain about the callout staying hidden.
	const REACHABILITY_DISMISSED_KEY = 'cordn.reachabilityCalloutDismissed';
	let reachabilityCalloutDismissed = $state(
		browser ? localStorage.getItem(REACHABILITY_DISMISSED_KEY) === '1' : false
	);
	function dismissReachabilityCallout() {
		localStorage.setItem(REACHABILITY_DISMISSED_KEY, '1');
		reachabilityCalloutDismissed = true;
	}
	// Torii build: the node coordinator has its own team card below (ADR 0004).
	const nodeCoordinatorKey = $derived(
		TORII_NODE_BUILD ? safeNormalizePubKey(projectChannels.coordinator) : ''
	);
	const uncoveredOtherKeys = $derived(
		reachabilityStore.uncoveredCoordinatorKeys.filter((key) => key !== nodeCoordinatorKey)
	);
	const uncoveredCoordinatorLabels = $derived.by(() =>
		uncoveredOtherKeys.map((key) => getCoordinatorLabel(key))
	);
	const activePubkeyHex = $derived(safeNormalizePubKey($activeAccount?.pubkey ?? ''));
	const teamState = $derived(
		teamReachability(nodeCoordinatorKey, activePubkeyHex, reachabilityStore)
	);
	let teamReadyAcked = $state<Record<string, boolean>>({});
	const teamReadyDismissed = $derived(
		Boolean(activePubkeyHex) &&
			(teamReadyAcked[activePubkeyHex] ??
				(browser && localStorage.getItem(teamReadyAckKey(activePubkeyHex)) === '1'))
	);
	// The startup pass can run before the node file adds the node coordinator
	// (first visit): re-check once per account when it left the node unverified.
	let teamRecheckedFor = '';
	$effect(() => {
		const node = nodeCoordinatorKey;
		const owner = activePubkeyHex;
		if (!node || !owner || teamRecheckedFor === owner) return;
		if (!reachabilityStore.checked || reachabilityStore.ownerPubkey !== owner) return;
		if (
			reachabilityStore.coveredCoordinatorKeys.includes(node) ||
			reachabilityStore.uncoveredCoordinatorKeys.includes(node)
		) {
			return;
		}
		teamRecheckedFor = owner;
		void maintainReachability().catch(() => undefined);
	});
	function dismissTeamReady() {
		if (!activePubkeyHex) return;
		localStorage.setItem(teamReadyAckKey(activePubkeyHex), '1');
		teamReadyAcked = { ...teamReadyAcked, [activePubkeyHex]: true };
	}
	const showReachabilityCallout = $derived.by(
		() =>
			hasAccount &&
			reachabilityStore.checked &&
			reachabilityStore.ownerPubkey === safeNormalizePubKey($activeAccount?.pubkey ?? '') &&
			uncoveredOtherKeys.length > 0 &&
			!migrationBannerStore.detected &&
			!reachabilityCalloutDismissed
	);
	// ponytail: no anti-flash gate, so a multi-device user on a brand-new device may
	// see this callout briefly before migrationBannerStore.detected settles. Add a
	// probeComplete flag to migrationBannerStore if it bothers anyone.

	// Official Cordn discussion group. Encoded as a cordn1 ref (coordinator packed
	// in) plus the `m=` name preview; the default coordinator is embedded, not
	// omitted, so the link is self-contained and portable across clients.
	const CORDN_GROUP_ID = '48ea0377-8a10-4383-9129-a928ceae0232';
	const cordnGroupHref = buildGroupSharePath({
		groupId: CORDN_GROUP_ID,
		coordinatorKey: DEFAULT_CHAT_COORDINATOR_PUBKEY,
		metadata: { name: 'Cordn' }
	});
	const inCordnGroup = $derived.by(() => groups.some((group) => group.id === CORDN_GROUP_ID));
	let makingReachable = $state(false);
	let reachabilityError = $state('');

	async function makeReachable() {
		try {
			makingReachable = true;
			reachabilityError = '';
			// Explicit action overrides the auto-publish opt-out.
			await maintainReachability({ publish: true });
			if (reachabilityStore.uncoveredCoordinatorKeys.length > 0) {
				const labels = reachabilityStore.uncoveredCoordinatorKeys.map(getCoordinatorLabel);
				reachabilityError = `Still unreachable on ${labels.join(', ')}.`;
				return;
			}
			toast.success('You are reachable', {
				description: 'Others can now start private conversations with you.'
			});
		} catch (error) {
			reachabilityError = error instanceof Error ? error.message : 'Failed to publish key package';
		} finally {
			makingReachable = false;
		}
	}

	function getGroupHref(groupId: string) {
		return resolve('/chat/[id]', { id: groupRouteId(groupId) });
	}
</script>

<svelte:head>
	{#if !TORII_NODE_BUILD}<meta name="description" content="Your Cordn chats." />{/if}
</svelte:head>

{#if TORII_NODE_BUILD}
	<TeamHome />
{:else}
	<div class="flex h-full min-h-0 flex-col bg-background text-foreground">
		<header class="border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-6">
			<div class="mx-auto flex w-full max-w-6xl items-center gap-3">
				<ChatMobileSidebarButton />
				{#if hasAccount}
					<h1 class="text-lg font-semibold tracking-tight">Chats</h1>
					<div class="ml-auto flex items-center gap-2">
						{#if hasUnreadChats}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="h-9 w-9 shrink-0 rounded-lg"
								aria-label="Mark all chats read"
								title="Mark all chats read"
								onclick={markAllChatGroupsRead}
							>
								<CheckCheck class="size-4" />
							</Button>
						{/if}
						<ChatSearchBar />
					</div>
				{/if}
			</div>
		</header>

		<div
			class="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8"
			use:pullToRefresh={chatListPullToRefresh}
		>
			{#if hasAccount}
				<div class="mx-auto flex max-w-6xl flex-col gap-6">
					{#if nodeCoordinatorKey && teamState === 'missing'}
						<Card.Root class="border-amber-500/40 bg-amber-500/5" data-torii-team="missing">
							<Card.Header class="space-y-1.5">
								<Card.Title>Your team can't add you yet</Card.Title>
								<Card.Description>
									This node doesn't have your chat key yet, so nobody can add you to a project chat.
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-3">
								{#if reachabilityError}
									<p class="text-sm text-destructive">{reachabilityError}</p>
								{/if}
								<Button onclick={makeReachable} disabled={makingReachable}>
									{#if makingReachable}
										<Spinner class="mr-2 size-4" />
									{/if}
									{makingReachable ? 'Setting up…' : 'Fix it now'}
								</Button>
							</Card.Content>
						</Card.Root>
					{:else if nodeCoordinatorKey && teamState === 'checking'}
						<div
							class="flex items-center gap-2 rounded-2xl border border-border p-4 text-sm text-muted-foreground"
							data-torii-team="checking"
						>
							<Spinner class="size-4" />
							Getting you ready so your team can add you…
						</div>
					{:else if nodeCoordinatorKey && teamState === 'ready' && !teamReadyDismissed}
						<Card.Root class="border-emerald-500/40 bg-emerald-500/5" data-torii-team="ready">
							<Card.Header class="space-y-1.5">
								<Card.Title>Your team can now add you</Card.Title>
								<Card.Description>
									A project owner can add you to the project chat. It shows up on the left when they
									do.
								</Card.Description>
							</Card.Header>
							<Card.Content>
								<Button variant="ghost" onclick={dismissTeamReady}>Got it</Button>
							</Card.Content>
						</Card.Root>
					{/if}
					{#if showStorageDisclaimer}
						<Card.Root class="border-amber-500/40 bg-amber-500/5">
							<Card.Header class="space-y-1.5">
								<Card.Title class="flex items-center gap-2">
									<TriangleAlert class="size-4 text-amber-500" />
									Your chats live in this browser
								</Card.Title>
								<Card.Description>
									Cordn on the web keeps your chats, contacts, and settings in this browser's
									storage. Clearing browser data will delete them, and they won't show up in other
									browsers. Back up from Settings, or use the Android app, which keeps your data in
									its own storage.
								</Card.Description>
							</Card.Header>
							<Card.Content class="flex flex-wrap items-center gap-3">
								<Button href={resolve('/chat/config/backup')}>Back up your data</Button>
								<a
									href="https://zapstore.dev/apps/naddr1qqxk7un89e3k7unydchxzursqyv8wumn8ghj7un9d3shjtn6v9c8xar0wfjjuer9wcpzps7xmxansh7cyl8ak3wexws73n8jjpd7xpr8z50dtl34dgg22f0fqvzqqqr7pv6zvfm6"
									target="_blank"
									rel="noreferrer"
									class="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
								>
									Get the app
								</a>
								<Button variant="ghost" class="ml-auto" onclick={dismissStorageDisclaimer}>
									Dismiss
								</Button>
							</Card.Content>
						</Card.Root>
					{/if}
					{#if showReachabilityCallout}
						<Card.Root>
							<Card.Header class="space-y-1.5">
								<Card.Title>You're not reachable everywhere</Card.Title>
								<Card.Description>
									You can join and create chats, but people on {uncoveredCoordinatorLabels.join(
										', '
									)}
									can't start a private conversation with you until a key package is published there.
									It only takes a second.
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-3">
								{#if reachabilityError}
									<p class="text-sm text-destructive">{reachabilityError}</p>
								{/if}
								<div class="flex flex-wrap items-center gap-3">
									<Button onclick={makeReachable} disabled={makingReachable}>
										{#if makingReachable}
											<Spinner class="mr-2 size-4" />
										{/if}
										{makingReachable ? 'Setting up…' : 'Make me reachable'}
									</Button>
									<Button variant="ghost" class="ml-auto" onclick={dismissReachabilityCallout}>
										Dismiss
									</Button>
								</div>
							</Card.Content>
						</Card.Root>
					{/if}

					<!-- Flat feed: group/news rows are self-sufficient bordered cards — no
	     outer card chrome or duplicate "Chats" heading (the page header owns
	     it), so the content surface stays as wide as possible. -->
					{#if projectChannels.status !== 'off'}
						<!-- Torii node: the sidebar is the project list (ADR 0002); no
						     other groups, News or upstream group links here. -->
						<div
							class="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground"
						>
							Pick a project on the left to open its chat.
						</div>
					{:else if feedRows.length > 0}
						<div class="space-y-3">
							{#each feedRows as row (row.kind === 'news' ? 'news' : row.group.id)}
								{#if row.kind === 'news'}
									<NewsListItem
										href={resolve('/chat/news')}
										variant="card"
										unreadCount={newsUnreadCount}
									/>
								{:else}
									{@const summary = getChatGroupSummary(row.group.id, $activeAccount?.pubkey)}
									<ChatGroupListItem
										group={row.group}
										href={getGroupHref(row.group.id)}
										preview={summary.preview}
										unreadCount={summary.unreadCount}
										unreadReferenceCount={summary.unreadReferenceCount}
									/>
								{/if}
							{/each}
						</div>
					{/if}
					{#if !hasGroups && projectChannels.status === 'off'}
						<div
							class="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground"
						>
							No chats yet. Create one or join the Cordn group to get started.
						</div>
					{/if}

					<div class="flex flex-wrap items-center gap-2">
						{#if projectChannels.status === 'off'}
							<Button
								href={resolve('/chat/create-group')}
								variant={hasGroups ? 'outline' : 'default'}
							>
								Create group
							</Button>
						{/if}
						{#if !inCordnGroup && !TORII_NODE_BUILD}
							<Button href={cordnGroupHref} variant="outline">Join Cordn group</Button>
						{/if}
						<a
							href={resolve('/chat/config')}
							class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
						>
							Manage coordinators &amp; key packages →
						</a>
					</div>
				</div>
			{:else}
				<!-- Logged-out home is the last step of the landing page: one job (get an
				     identity), zero dead ends. The login dialog pre-selects the best tab. -->
				<div
					class="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-6 py-8 text-center"
				>
					<div class="space-y-3">
						<h1 class="text-2xl font-semibold tracking-tight">
							{TORII_NODE_BUILD ? 'Welcome to your team' : 'Welcome to Cordn'}
						</h1>
						<p class="text-sm text-muted-foreground">
							{#if TORII_NODE_BUILD}
								Sign in so your team can add you. Just visiting isn't enough: signing in puts your
								chat key on this node.
							{:else}
								Private group messaging, end-to-end encrypted. Your identity is a key you hold — no
								email, no phone number.
							{/if}
						</p>
					</div>
					<AccountLoginDialog
						triggerLabel={TORII_NODE_BUILD ? 'Sign in' : 'Get started'}
						triggerVariant="default"
						triggerClass="h-11 px-8 text-base"
					/>
					{#if !TORII_NODE_BUILD}
						<a
							href={resolve('/')}
							class="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
						>
							What is Cordn?
						</a>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}
