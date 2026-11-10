<script lang="ts">
	// "Your computers" (ADR 0016): the FIPS computers that may reach this
	// node's private git. Each change signs the full list with your signer.
	import { ContinuumError } from '../continuumApi';
	import { checkNewDevice, hostsLine, saveError, type Device, type MyDevices } from '../devices';
	import { loadMyDevices, saveMyDevices } from '../projectChannels.svelte';

	// ADR 0017 §3: `header` is a small button with the panel as a dropdown.
	let { variant = 'list' }: { variant?: 'list' | 'header' } = $props();
	const inHeader = $derived(variant === 'header');

	let open = $state(false);
	let mine = $state<MyDevices | null>(null);
	let loadError = $state('');
	let busy = $state(false);
	let error = $state('');
	let npub = $state('');
	let label = $state('');
	let copied = $state('');

	async function load() {
		loadError = '';
		try {
			mine = await loadMyDevices();
			if (!mine) loadError = "Couldn't reach your node.";
		} catch {
			loadError = "Couldn't reach your node.";
		}
	}

	function toggle() {
		open = !open;
		if (open) void load();
	}

	async function save(next: Device[]) {
		busy = true;
		error = '';
		try {
			await saveMyDevices(next);
			mine = mine ? { ...mine, devices: next } : mine;
			return true;
		} catch (e) {
			error =
				e instanceof ContinuumError ? saveError(e.code, e.status) : "Couldn't save. Try again.";
			return false;
		} finally {
			busy = false;
		}
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (!mine) return;
		const n = npub.trim();
		const l = label.trim();
		error = checkNewDevice(mine.devices, n, l);
		if (error) return;
		if (await save([...mine.devices, { npub: n, label: l }])) {
			npub = '';
			label = '';
		}
	}

	const remove = (d: Device) => mine && save(mine.devices.filter((x) => x.npub !== d.npub));

	async function copy(what: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
		} catch {
			copied = '';
		}
	}

	const short = (n: string) => `${n.slice(0, 12)}…${n.slice(-6)}`;
</script>

<div class={inHeader ? 'text-sm' : 'border-t border-border px-3 py-2 text-sm'}>
	<button
		type="button"
		class="{inHeader
			? 'px-1.5 text-xs'
			: 'w-full px-2 text-left'} rounded-md py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
		aria-expanded={open}
		onclick={toggle}>Your computers</button
	>
	{#if open}
		<div
			class="{inHeader
				? 'absolute top-full right-0 z-20 mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-background p-3 shadow'
				: 'mt-2'} flex flex-col gap-2"
			data-testid="device-panel"
		>
			{#if loadError}
				<p class="text-xs text-muted-foreground">{loadError}</p>
			{:else if !mine}
				<p class="text-xs text-muted-foreground">Loading…</p>
			{:else if !mine.nodeNpub}
				<p class="text-xs text-muted-foreground" data-testid="device-no-fips">
					This node has no FIPS mesh, so there's no private git to reach.
				</p>
			{:else if !mine.listed}
				<p class="text-xs text-muted-foreground" data-testid="device-not-listed">
					You're not on a project here, so there's nothing to add.
				</p>
			{:else}
				<p class="text-xs text-muted-foreground">
					Computers here can reach the team's private git over FIPS. Phones can't yet.
				</p>
				{#if mine.devices.length}
					<ul class="flex flex-col gap-1">
						{#each mine.devices as d (d.npub)}
							<li class="flex items-center gap-2">
								<span class="min-w-0 flex-1 truncate" title={d.npub}
									>{d.label || short(d.npub)}</span
								>
								<button
									type="button"
									class="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
									disabled={busy}
									onclick={() => remove(d)}>Remove</button
								>
							</li>
						{/each}
					</ul>
				{/if}
				{#if mine.devices.length < mine.max}
					<form class="flex flex-col gap-1" onsubmit={add}>
						<input
							class="rounded-md border border-border bg-background px-2 py-1 text-xs"
							placeholder="FIPS name (npub1…, from fipsctl show)"
							aria-label="FIPS name"
							autocomplete="off"
							spellcheck="false"
							maxlength="63"
							bind:value={npub}
						/>
						<input
							class="rounded-md border border-border bg-background px-2 py-1 text-xs"
							placeholder="Name, e.g. Laptop (optional)"
							aria-label="Computer name"
							maxlength="32"
							bind:value={label}
						/>
						<button
							type="submit"
							class="self-start rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60"
							disabled={busy || !npub.trim()}>{busy ? 'Saving…' : 'Add computer'}</button
						>
					</form>
				{:else}
					<p class="text-xs text-muted-foreground">That's the most: {mine.max} computers.</p>
				{/if}
				{#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
				<div class="flex flex-col gap-1 border-t border-border pt-2 text-xs">
					<div class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate">Git: http://{mine.git}</span>
						<button
							type="button"
							class="rounded-md px-2 py-0.5 hover:bg-muted"
							onclick={() => copy('git', `http://${mine!.git}`)}
							>{copied === 'git' ? 'Copied' : 'Copy'}</button
						>
					</div>
					<div class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate" title={mine.nodeNpub}
							>Node: {short(mine.nodeNpub)}</span
						>
						<button
							type="button"
							class="rounded-md px-2 py-0.5 hover:bg-muted"
							onclick={() => copy('node', mine!.nodeNpub!)}
							>{copied === 'node' ? 'Copied' : 'Copy'}</button
						>
					</div>
					<p class="text-muted-foreground">
						Add this line to your FIPS hosts file:
						<code class="break-all" data-testid="device-hosts"
							>{hostsLine(mine.git, mine.nodeNpub)}</code
						>
					</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
