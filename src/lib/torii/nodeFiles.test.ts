import { afterEach, describe, expect, it } from 'vitest';

import {
	ForeignMediaError,
	assertNodeFetch,
	isNodeFileUrl,
	nodeFilesAuth,
	nodeFilesUrl,
	nodeServers,
	setNodeFiles
} from './nodeFiles';

const FILES = 'https://teams.example.com/files';
const PUBLIC = ['https://blossom.primal.net/', 'https://cdn.hzrd149.com/'] as const;

afterEach(() => setNodeFiles(null));

describe('nodeFiles (ADR 0007)', () => {
	it('changes nothing without a node file server', () => {
		expect(nodeFilesUrl()).toBeNull();
		expect(nodeServers(PUBLIC)).toEqual([...PUBLIC]);
		expect(nodeFilesAuth(PUBLIC[0])).toBeUndefined();
		expect(isNodeFileUrl(`${FILES}/abc`)).toBe(false);
		expect(() => assertNodeFetch('https://blossom.primal.net/abc')).not.toThrow();
	});
	it('routes every server list to the node only', () => {
		setNodeFiles(`${FILES}/`, () => 'tok');
		expect(nodeFilesUrl()).toBe(FILES);
		expect(nodeServers(PUBLIC)).toEqual([FILES]);
		expect(nodeServers([])).toEqual([FILES]);
	});
	it('sends the session only to the node, null when signed out', () => {
		let token: string | null = 'tok';
		setNodeFiles(FILES, () => token);
		expect(nodeFilesAuth(`${FILES}/`)).toBe('tok');
		expect(nodeFilesAuth(PUBLIC[0])).toBeUndefined();
		expect(nodeFilesAuth('https://teams.example.com/filesx')).toBeUndefined();
		token = null;
		expect(nodeFilesAuth(FILES)).toBeNull();
	});
	it('refuses to fetch blobs stored elsewhere', () => {
		setNodeFiles(FILES, () => null);
		expect(isNodeFileUrl(`${FILES}/${'a'.repeat(64)}`)).toBe(true);
		expect(isNodeFileUrl('https://teams.example.com/filesevil/abc')).toBe(false);
		expect(isNodeFileUrl('https://evil.example/files/abc')).toBe(false);
		expect(() => assertNodeFetch(`${FILES}/abc`)).not.toThrow();
		expect(() => assertNodeFetch('https://blossom.primal.net/abc')).toThrow(ForeignMediaError);
	});
});
