import { describe, it, expect } from 'vitest';
import { buildProfileShareHint } from '$lib/utils/profileShareHint';

describe('buildProfileShareHint', () => {
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
});
