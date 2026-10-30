export interface MultiDeviceActivityEntry {
	at: number;
	level: 'info' | 'warn';
	text: string;
}

export const MULTI_DEVICE_ACTIVITY_CAP = 100;

/** Live per-owner projection; persisted copies remain on each owner config. */
export const multiDeviceActivity = $state<Record<string, MultiDeviceActivityEntry[]>>({});

/** Newest first, bounded so diagnostics cannot grow local storage without limit. */
export function prependActivity(
	entries: MultiDeviceActivityEntry[],
	entry: MultiDeviceActivityEntry
): MultiDeviceActivityEntry[] {
	return [entry, ...entries].slice(0, MULTI_DEVICE_ACTIVITY_CAP);
}

/** Merge overlapping config snapshots without dropping or reordering entries. */
export function mergeActivityLogs(
	incoming: MultiDeviceActivityEntry[],
	persisted: MultiDeviceActivityEntry[]
): MultiDeviceActivityEntry[] {
	const seen = new Set<string>();
	return [...incoming, ...persisted]
		.filter((entry) => {
			const key = `${entry.at}:${entry.level}:${entry.text}`;
			return seen.has(key) ? false : (seen.add(key), true);
		})
		.sort((a, b) => b.at - a.at)
		.slice(0, MULTI_DEVICE_ACTIVITY_CAP);
}

/** Stable, timezone-unambiguous text for bug reports. */
export function formatActivityLog(entries: MultiDeviceActivityEntry[]): string {
	return entries
		.map(
			(entry) => `${new Date(entry.at).toISOString()} ${entry.level.toUpperCase()} ${entry.text}`
		)
		.join('\n');
}
