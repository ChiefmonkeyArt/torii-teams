// ADR 0023 §6: a warning shows only after it has held for SETTLE_MS, so a
// state that is still loading never flashes. It hides (or changes) at once.
import { untrack } from 'svelte';
import { SETTLE_MS, settleDelay } from './embed';

export function settled<T extends string | boolean>(get: () => T, empty: T, ms = SETTLE_MS) {
	let value = $state<T>(empty);
	$effect(() => {
		const next = get();
		const wait = settleDelay(
			untrack(() => value),
			next,
			ms
		);
		if (!wait) {
			value = next;
			return;
		}
		const id = setTimeout(() => (value = next), wait);
		return () => clearTimeout(id);
	});
	return {
		get current() {
			return value;
		}
	};
}
