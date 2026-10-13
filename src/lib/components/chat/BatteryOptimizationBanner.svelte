<script lang="ts">
	import BatteryWarning from '@lucide/svelte/icons/battery-warning';
	import X from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import { App } from '@capacitor/app';
	import { LocalNotifications } from '@capacitor/local-notifications';
	import { CordnBackground } from 'cordn-background';
	import { Button } from '$lib/components/ui/button';
	import {
		BATTERY_EXEMPTION_ASKED_KEY,
		getDeliveryConfig,
		isAndroidNative
	} from '$lib/services/nativeBridge';

	const BATTERY_REMINDER_DISMISSED_KEY = 'cordn.batteryReminderDismissed';
	// Module load ≈ session start: compared against the ask timestamp so the reminder never
	// nags in the same session where the launch dialog was already shown (and maybe denied).
	const SESSION_START = Date.now();

	let visible = $state(false);

	async function refresh() {
		if (!isAndroidNative()) return;
		let show = !localStorage.getItem(BATTERY_REMINDER_DISMISSED_KEY);
		if (show) {
			const askedAt = Number(localStorage.getItem(BATTERY_EXEMPTION_ASKED_KEY) ?? 0);
			show = Boolean(askedAt) && askedAt < SESSION_START && getDeliveryConfig().mode !== 'off';
		}
		if (show) {
			try {
				// The battery ask is pointless while notifications are off — that banner is a
				// different problem — and pointless once exempted.
				show =
					(await LocalNotifications.checkPermissions()).display === 'granted' &&
					!(await CordnBackground.isBatteryExempted()).exempted;
			} catch {
				show = false;
			}
		}
		// Single assignment so a re-probe can hide the banner too (granting from it must hide it).
		visible = show;
	}

	onMount(() => {
		void refresh();
		// The exemption dialog opens as a separate task — re-probe on return, so granting hides
		// the banner (same pattern as Settings → Notifications).
		const handlePromise = App.addListener('appStateChange', ({ isActive }) => {
			if (isActive) void refresh();
		});
		return () => {
			void handlePromise.then((handle) => handle.remove());
		};
	});

	function dismiss() {
		localStorage.setItem(BATTERY_REMINDER_DISMISSED_KEY, '1');
		visible = false;
	}

	async function allowBackground() {
		try {
			await CordnBackground.requestBatteryExemption();
		} catch {
			// dialog failed to open — the banner stays for another attempt
		}
	}
</script>

{#if visible}
	<div
		class="flex flex-col gap-2 border-b border-border/60 bg-muted/40 px-4 py-2.5 text-sm sm:flex-row sm:items-center"
		role="status"
		aria-live="polite"
	>
		<BatteryWarning class="size-4 shrink-0" />
		<span class="min-w-0 flex-1">
			<span class="font-medium">Notifications can stop in the background.</span>
			<span class="text-muted-foreground">
				Android may pause Cordn to save battery — allow unrestricted background use to keep
				notifications reliable.
			</span>
		</span>
		<div class="flex shrink-0 items-center gap-2">
			<Button size="sm" onclick={allowBackground}>Allow background</Button>
			<button
				type="button"
				class="grid size-7 place-items-center rounded-full text-muted-foreground transition-opacity hover:opacity-100"
				aria-label="Dismiss battery reminder"
				onclick={dismiss}
			>
				<X class="size-4" />
			</button>
		</div>
	</div>
{/if}
