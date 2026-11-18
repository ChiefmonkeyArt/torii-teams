import { describe, expect, it } from 'vitest';
import { aiAskHint, aiMemberOf, slugOfDescription } from './aiMember';
import { parseAiMember } from './continuumApi';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ai = { pubkey: A, name: 'Continuum AI', label: 'Local · llama3.2:1b' };

describe('aiMember (ADR 0024)', () => {
	it('finds the AI by pubkey across projects', () => {
		expect(aiMemberOf({ web: ai }, A)).toEqual(ai);
		expect(aiMemberOf({ web: ai }, B)).toBeNull();
		expect(aiMemberOf({}, null)).toBeNull();
	});

	it('reads the project slug marker', () => {
		expect(slugOfDescription('torii:project=website')).toBe('website');
		expect(slugOfDescription('Chat torii:project=a-b')).toBe('a-b');
		expect(slugOfDescription('torii:project=Bad!')).toBeNull();
		expect(slugOfDescription(7)).toBeNull();
	});

	it('warns only a non-asker who mentions the AI', () => {
		expect(aiAskHint(ai, 'contributor', [A])).toMatch(/Only Owners and Maintainers/);
		expect(aiAskHint(ai, null, [A])).toMatch(/Only Owners/);
		expect(aiAskHint(ai, 'owner', [A])).toBeNull();
		expect(aiAskHint(ai, 'maintainer', [A])).toBeNull();
		expect(aiAskHint(ai, 'contributor', [B])).toBeNull();
		expect(aiAskHint(null, 'contributor', [A])).toBeNull();
	});

	it('takes the roster ai only when it is a listed agent', () => {
		const agents = new Set([A]);
		expect(parseAiMember({ pubkey: A, name: 'X\u0007', label: 'Routstr · m' }, agents)).toEqual({
			pubkey: A,
			name: 'X',
			label: 'Routstr · m'
		});
		expect(parseAiMember({ pubkey: B, label: 'x' }, agents)).toBeNull();
		expect(parseAiMember({ pubkey: 'zz' }, agents)).toBeNull();
		expect(parseAiMember(null, agents)).toBeNull();
		expect(parseAiMember({ pubkey: A }, agents)?.name).toBe('Continuum AI');
	});
});
