import { describe, expect, test } from 'vitest';
import {
	formatActivityLog,
	MULTI_DEVICE_ACTIVITY_CAP,
	prependActivity,
	type MultiDeviceActivityEntry
} from './multiDeviceActivity.svelte';

function entry(at: number): MultiDeviceActivityEntry {
	return { at, level: at % 2 ? 'warn' : 'info', text: `event ${at}` };
}

describe('multi-device activity log', () => {
	test('stays newest-first and capped', () => {
		let entries: MultiDeviceActivityEntry[] = [];
		for (let at = 0; at < MULTI_DEVICE_ACTIVITY_CAP + 5; at++) {
			entries = prependActivity(entries, entry(at));
		}

		expect(entries).toHaveLength(MULTI_DEVICE_ACTIVITY_CAP);
		expect(entries[0].text).toBe(`event ${MULTI_DEVICE_ACTIVITY_CAP + 4}`);
		expect(entries.at(-1)?.text).toBe('event 5');
	});

	test('copy format includes timestamp, level, and text', () => {
		expect(formatActivityLog([entry(0), entry(1)])).toBe(
			'1970-01-01T00:00:00.000Z INFO event 0\n1970-01-01T00:00:00.001Z WARN event 1'
		);
	});
});
