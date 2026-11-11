import { describe, expect, it } from 'vitest';
import { chatServerDown, showReachabilityFix, SERVER_DOWN_TEXT } from './serverDown';

const NODE = 'a'.repeat(64);

describe('chatServerDown (ADR 0020)', () => {
	it('is down only after a failed request', () => {
		expect(chatServerDown(NODE, 'degraded')).toBe(true);
		expect(chatServerDown(NODE, 'healthy')).toBe(false);
		expect(chatServerDown(NODE, 'unknown')).toBe(false);
	});
	it('needs a node coordinator', () => {
		expect(chatServerDown('', 'degraded')).toBe(false);
		expect(chatServerDown('  ', 'degraded')).toBe(false);
	});
	it('says plainly that messages will not send', () => {
		expect(SERVER_DOWN_TEXT).toBe("Chat server is down. Messages won't send until it's back.");
	});
});

describe('showReachabilityFix (ADR 0020)', () => {
	it('hides Fix it while the server is down', () => {
		expect(showReachabilityFix('missing', true)).toBe(false);
		expect(showReachabilityFix('missing', false)).toBe(true);
	});
	it('never shows unless the key package is missing', () => {
		expect(showReachabilityFix('ready', false)).toBe(false);
		expect(showReachabilityFix('checking', false)).toBe(false);
	});
});
