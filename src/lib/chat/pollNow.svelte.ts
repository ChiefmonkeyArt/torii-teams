import { browser } from '$app/environment';

/**
 * Shared coarse clock for poll countdowns ("2m left"), refcounted so the one
 * 30s interval exists only while at least one poll is mounted. A busy history
 * can hold many polls on screen at once; one interval per poll (the old
 * pattern) kept N timers alive for a seconds-granular label.
 */
let currentNow = $state(Math.floor(Date.now() / 1000));
let refs = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/** Reactive read of the shared clock (seconds). Call inside a template or
 *  $derived so the consumer re-renders when the ticker advances. */
export function pollNow(): number {
	return currentNow;
}

/** Retain the shared ticker; returns the release function. */
export function retainPollNow(): () => void {
	refs += 1;
	if (!timer && browser) {
		timer = setInterval(() => (currentNow = Math.floor(Date.now() / 1000)), 30_000);
	}
	return () => {
		refs -= 1;
		if (refs <= 0) {
			refs = 0;
			if (timer) clearInterval(timer);
			timer = undefined;
		}
	};
}
