import { expect, test } from 'vitest';
import { shellLayout } from './embedState.svelte';

test('ADR 0017: framed in Continuum, no project list and the chat fills the width', () => {
	expect(shellLayout(true, true)).toEqual({ list: false, main: 'flex' });
	expect(shellLayout(true, false)).toEqual({ list: false, main: 'flex' });
});

test('standalone: the list stays, and on phones it is the home page (as in torii.17)', () => {
	expect(shellLayout(false, true)).toEqual({ list: true, main: 'hidden md:flex' });
	expect(shellLayout(false, false)).toEqual({ list: true, main: 'flex' });
});
