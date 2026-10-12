import { describe, it, expect } from 'vitest';
import { buildProfileShareHint, buildProfileShareHints } from '$lib/utils/profileShareHint';

describe('profile share hints', () => {
	it('reports discoverability for the shared coordinator', () => {
		expect(buildProfileShareHint('discoverable', 'Default coordinator')).toEqual({
			tone: 'ok',
			text: 'People can start a chat with you on Default coordinator.'
		});
	});

	it('warns when no key package is published on the shared coordinator', () => {
		expect(buildProfileShareHint('missing', 'Relay A')).toMatchObject({
			tone: 'warn',
			text: expect.stringContaining("can't start a chat with you")
		});
		expect(buildProfileShareHint('missing', 'Relay A').text).toContain('Relay A');
	});

	it('warns without a coordinator name when nothing is published anywhere', () => {
		expect(buildProfileShareHint('missing')).toEqual({
			tone: 'warn',
			text: "You have no published key package — people can't start a chat with you from this link."
		});
	});

	it('stays muted while checking and warns when verification fails', () => {
		expect(buildProfileShareHint('checking').tone).toBe('muted');
		expect(buildProfileShareHint('unverified', 'Relay A').tone).toBe('warn');
		expect(buildProfileShareHint('unverified').text).toContain('coordinator may be unreachable');
	});

	it('keeps reachability per coordinator and fixes exactly that tab', () => {
		const coordA = 'aa'.repeat(32);
		const coordB = 'bb'.repeat(32);
		const fixed: string[] = [];
		const hints = buildProfileShareHints(
			[
				{ label: 'Coordinator A', coordinatorKey: coordA },
				{ label: 'Coordinator B', coordinatorKey: coordB },
				{ label: 'Coordinator C', coordinatorKey: 'cc'.repeat(32) }
			],
			// Reachable on A, missing on B, unverifiable on C — at the same time.
			[{ discoverable: true }, { discoverable: false }, { error: true }],
			(coordinatorKey) => ({
				label: 'Make me reachable',
				onAction: () => {
					fixed.push(coordinatorKey);
				}
			})
		);

		expect(hints[0].tone).toBe('ok');
		expect(hints[0].action).toBeUndefined();
		expect(hints[1].tone).toBe('warn');
		expect(hints[2].tone).toBe('warn');
		expect(hints[2].action).toBeUndefined();
		// The fix targets exactly the coordinator behind the unreachable tab.
		void hints[1].action?.onAction();
		expect(fixed).toEqual([coordB]);
	});
});
