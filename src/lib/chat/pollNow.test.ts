import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

// Each test re-imports the module fresh (module-level ticker state under
// test); under full-suite load that vite transform can exceed the default.
vi.setConfig({ testTimeout: 20_000 });

describe('pollNow shared ticker', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});

	test('ticks only while retained', async () => {
		const { pollNow, retainPollNow } = await import('./pollNow.svelte');
		const start = pollNow();
		// Unretained: the clock never advances.
		await vi.advanceTimersByTimeAsync(120_000);
		expect(pollNow()).toBe(start);

		const release = retainPollNow();
		// advanceTimersByTimeAsync also advances Date.now(), so the tick lands at
		// the 150s mark (the unretained 120s pre-roll included), not start+30.
		await vi.advanceTimersByTimeAsync(30_001);
		expect(pollNow()).toBe(start + 150);

		release();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(pollNow()).toBe(start + 150);
	});

	test('two retains keep the ticker armed until both release', async () => {
		const { pollNow, retainPollNow } = await import('./pollNow.svelte');
		const start = pollNow();
		const releaseA = retainPollNow();
		const releaseB = retainPollNow();
		releaseA();
		await vi.advanceTimersByTimeAsync(30_001);
		expect(pollNow()).toBe(start + 30);
		releaseB();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(pollNow()).toBe(start + 30);
	});
});
