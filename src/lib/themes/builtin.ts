import type { ThemeDefinition } from './types';

/**
 * Built-in themes. Values are hex so the native color picker, the editor, and
 * the contrast checker share one canonical format (8-digit hex carries alpha).
 * `classic` is a lossless conversion of the original shadcn neutral palette;
 * `soft` is the lower-contrast default (body text ~9.4:1 light / ~8.2:1 dark,
 * all muted/status pairs ≥ 4.5:1 WCAG AA). The rest of the lineup keeps the
 * same AA bar — the invariants test enforces it for every built-in pair.
 * Catppuccin ports the official Latte/Mocha palette (MIT).
 *
 * layout.css `:root`/`.dark` mirror `soft` so the pre-JS paint matches the
 * default; any other active theme is injected at runtime with higher
 * specificity (`:root:root`) — keep these values and layout.css in sync.
 */

export const CLASSIC_THEME: ThemeDefinition = {
	id: 'classic',
	name: 'Classic',
	light: {
		background: '#ffffff',
		foreground: '#0a0a0a',
		card: '#ffffff',
		'card-foreground': '#0a0a0a',
		popover: '#ffffff',
		'popover-foreground': '#0a0a0a',
		primary: '#171717',
		'primary-foreground': '#fafafa',
		secondary: '#f5f5f5',
		'secondary-foreground': '#171717',
		muted: '#f5f5f5',
		'muted-foreground': '#737373',
		accent: '#f5f5f5',
		'accent-foreground': '#171717',
		destructive: '#e7000b',
		border: '#e5e5e5',
		input: '#e5e5e5',
		ring: '#a1a1a1',
		radius: '0.625rem'
	},
	dark: {
		background: '#0a0a0a',
		foreground: '#fafafa',
		card: '#171717',
		'card-foreground': '#fafafa',
		popover: '#171717',
		'popover-foreground': '#fafafa',
		primary: '#e5e5e5',
		'primary-foreground': '#171717',
		secondary: '#262626',
		'secondary-foreground': '#fafafa',
		muted: '#262626',
		'muted-foreground': '#a1a1a1',
		accent: '#262626',
		'accent-foreground': '#fafafa',
		destructive: '#ff6467',
		border: '#ffffff1a',
		input: '#ffffff26',
		ring: '#737373',
		radius: '0.625rem'
	}
};

export const SOFT_THEME: ThemeDefinition = {
	id: 'soft',
	name: 'Soft',
	light: {
		background: '#f5f5f2',
		foreground: '#41413d',
		card: '#fbfbf9',
		'card-foreground': '#41413d',
		popover: '#fbfbf9',
		'popover-foreground': '#41413d',
		primary: '#45443f',
		'primary-foreground': '#fafaf7',
		secondary: '#e9e9e4',
		'secondary-foreground': '#45443f',
		muted: '#e9e9e4',
		'muted-foreground': '#6f6f67',
		accent: '#e9e9e4',
		'accent-foreground': '#45443f',
		destructive: '#b0413e',
		border: '#dcdcd6',
		input: '#dcdcd6',
		ring: '#8f8f86',
		radius: '0.625rem'
	},
	dark: {
		background: '#22272b',
		foreground: '#b8c0c7',
		card: '#272d31',
		'card-foreground': '#b8c0c7',
		popover: '#2b3236',
		'popover-foreground': '#b8c0c7',
		primary: '#c3cbd2',
		'primary-foreground': '#23282c',
		secondary: '#33393e',
		'secondary-foreground': '#d6dce1',
		muted: '#33393e',
		'muted-foreground': '#8b959d',
		accent: '#33393e',
		'accent-foreground': '#d6dce1',
		destructive: '#d1787a',
		border: '#3d444a',
		input: '#434b52',
		ring: '#79848d',
		radius: '0.625rem'
	}
};

export const MATRIX_THEME: ThemeDefinition = {
	id: 'matrix',
	name: 'Matrix',
	light: {
		background: '#f2f7f0',
		foreground: '#26332a',
		card: '#f8fbf7',
		'card-foreground': '#26332a',
		popover: '#fbfdfa',
		'popover-foreground': '#26332a',
		primary: '#1f7a45',
		'primary-foreground': '#f0fbf3',
		secondary: '#e3ede2',
		'secondary-foreground': '#2b3b30',
		muted: '#e6efe5',
		'muted-foreground': '#5c7261',
		accent: '#dfeadd',
		'accent-foreground': '#26332a',
		destructive: '#b3362f',
		border: '#d3e0d3',
		input: '#c6d6c6',
		ring: '#4f9e6b',
		radius: '0.125rem'
	},
	dark: {
		background: '#0b0f0c',
		foreground: '#b8e6c1',
		card: '#101511',
		'card-foreground': '#b8e6c1',
		popover: '#131a14',
		'popover-foreground': '#b8e6c1',
		primary: '#57c47a',
		'primary-foreground': '#08120b',
		secondary: '#16211a',
		'secondary-foreground': '#a3d8ad',
		muted: '#131b15',
		'muted-foreground': '#7fa88a',
		accent: '#1a2b1f',
		'accent-foreground': '#b8e6c1',
		destructive: '#e06c75',
		border: '#1f2d24',
		input: '#24352a',
		ring: '#57c47a',
		radius: '0.125rem'
	}
};
export const CYPHERPUNK_THEME: ThemeDefinition = {
	id: 'cypherpunk',
	name: 'Cypherpunk',
	light: {
		background: '#faf7ec',
		foreground: '#1c1b16',
		card: '#fffdf3',
		'card-foreground': '#1c1b16',
		popover: '#fffef8',
		'popover-foreground': '#1c1b16',
		primary: '#f2d024',
		'primary-foreground': '#141405',
		secondary: '#efe9d3',
		'secondary-foreground': '#3a382c',
		muted: '#f0ecda',
		'muted-foreground': '#6b6858',
		accent: '#1c1b16',
		'accent-foreground': '#f2d024',
		destructive: '#b3261e',
		border: '#e2dbbf',
		input: '#d8d0b0',
		ring: '#141410',
		radius: '0rem'
	},
	dark: {
		background: '#0d0d0b',
		foreground: '#e8e6df',
		card: '#141412',
		'card-foreground': '#e8e6df',
		popover: '#181816',
		'popover-foreground': '#e8e6df',
		primary: '#f2d024',
		'primary-foreground': '#141405',
		secondary: '#1f1f1c',
		'secondary-foreground': '#d8d5cb',
		muted: '#1a1a18',
		'muted-foreground': '#9a978c',
		accent: '#2b2b1e',
		'accent-foreground': '#e3dfb8',
		destructive: '#e05b5b',
		border: '#26261f',
		input: '#2c2c24',
		ring: '#f2d024',
		radius: '0rem'
	}
};
export const NAVY_THEME: ThemeDefinition = {
	id: 'navy',
	name: 'Navy',
	light: {
		background: '#eef2f9',
		foreground: '#24304a',
		card: '#f7f9fd',
		'card-foreground': '#24304a',
		popover: '#fbfcfe',
		'popover-foreground': '#24304a',
		primary: '#1f3f7a',
		'primary-foreground': '#f0f5fd',
		secondary: '#dfe7f4',
		'secondary-foreground': '#2b3b5c',
		muted: '#e3eaf5',
		'muted-foreground': '#5a6a88',
		accent: '#d9e4f6',
		'accent-foreground': '#1f3f7a',
		destructive: '#b3362f',
		border: '#d3ddef',
		input: '#c8d5ea',
		ring: '#4a71b5',
		radius: '0.625rem'
	},
	dark: {
		background: '#101a2b',
		foreground: '#c3cede',
		card: '#16213a',
		'card-foreground': '#c3cede',
		popover: '#1a2745',
		'popover-foreground': '#c3cede',
		primary: '#8fb0dd',
		'primary-foreground': '#0e1830',
		secondary: '#1d2a4a',
		'secondary-foreground': '#cdd9ec',
		muted: '#1a2440',
		'muted-foreground': '#8598b8',
		accent: '#22325a',
		'accent-foreground': '#d3def0',
		destructive: '#e08585',
		border: '#263456',
		input: '#2c3c62',
		ring: '#8fb0dd',
		radius: '0.625rem'
	}
};
export const WARM_PAPER_THEME: ThemeDefinition = {
	id: 'warm-paper',
	name: 'Warm Paper',
	light: {
		background: '#f7f1e3',
		foreground: '#3b352a',
		card: '#fcf7ec',
		'card-foreground': '#3b352a',
		popover: '#fefbf4',
		'popover-foreground': '#3b352a',
		primary: '#6f5b38',
		'primary-foreground': '#faf5ea',
		secondary: '#efe6d2',
		'secondary-foreground': '#4a4232',
		muted: '#f0e8d6',
		'muted-foreground': '#6f6552',
		accent: '#eadfc6',
		'accent-foreground': '#4a4232',
		destructive: '#a83a2e',
		border: '#e2d7bd',
		input: '#d9cba9',
		ring: '#a08d64',
		radius: '0.5rem'
	},
	dark: {
		background: '#201b14',
		foreground: '#d6cbb8',
		card: '#262019',
		'card-foreground': '#d6cbb8',
		popover: '#2b241b',
		'popover-foreground': '#d6cbb8',
		primary: '#d3b981',
		'primary-foreground': '#241d10',
		secondary: '#322a20',
		'secondary-foreground': '#ded2ba',
		muted: '#2c251c',
		'muted-foreground': '#9c8f77',
		accent: '#3a3023',
		'accent-foreground': '#e2d6bd',
		destructive: '#d98a7a',
		border: '#3a3125',
		input: '#443a2b',
		ring: '#b09767',
		radius: '0.5rem'
	}
};
export const CATPPUCCIN_THEME: ThemeDefinition = {
	id: 'catppuccin',
	name: 'Catppuccin',
	light: {
		background: '#eff1f5',
		foreground: '#4c4f69',
		card: '#e6e9ef',
		'card-foreground': '#4c4f69',
		popover: '#dce0e8',
		'popover-foreground': '#4c4f69',
		primary: '#8839ef',
		'primary-foreground': '#eff1f5',
		secondary: '#dce0e8',
		'secondary-foreground': '#5c5f78',
		muted: '#e6e9ef',
		'muted-foreground': '#64677d',
		accent: '#ccd0da',
		'accent-foreground': '#4c4f69',
		destructive: '#d20f39',
		border: '#ccd0da',
		input: '#bcc0cc',
		ring: '#8839ef',
		radius: '0.625rem'
	},
	dark: {
		background: '#1e1e2e',
		foreground: '#cdd6f4',
		card: '#181825',
		'card-foreground': '#cdd6f4',
		popover: '#11111b',
		'popover-foreground': '#cdd6f4',
		primary: '#cba6f7',
		'primary-foreground': '#1e1e2e',
		secondary: '#313244',
		'secondary-foreground': '#cdd6f4',
		muted: '#313244',
		'muted-foreground': '#9399b2',
		accent: '#45475a',
		'accent-foreground': '#cdd6f4',
		destructive: '#f38ba8',
		border: '#45475a',
		input: '#585b70',
		ring: '#cba6f7',
		radius: '0.625rem'
	}
};

/**
 * Ostrich — full nostr immersion: genuinely purple #221938 dark surfaces,
 * vivid #c084fc primary with plum text on it, lavender-cream light. The
 * bitcoin-orange focus ring (and the one-step-warm border/input hue) is the
 * ⚡ detail — ring/input/border are outside every CONTRAST_PAIR, so the orange
 * can't move AA. All pairs verified ≥4.5:1 in both variants.
 */
export const OSTRICH_THEME: ThemeDefinition = {
	id: 'ostrich',
	name: 'Ostrich',
	light: {
		background: '#f3eefb',
		foreground: '#322a4a',
		card: '#faf7ff',
		'card-foreground': '#322a4a',
		popover: '#fdfbff',
		'popover-foreground': '#322a4a',
		primary: '#7d3af0',
		'primary-foreground': '#f9f6ff',
		secondary: '#e9e1f7',
		'secondary-foreground': '#3a3157',
		muted: '#ece6f6',
		'muted-foreground': '#645a8a',
		accent: '#e2d5f8',
		'accent-foreground': '#3a3157',
		destructive: '#ab2d6b',
		border: '#d9c8e8',
		input: '#d2b6ea',
		ring: '#c96a00',
		radius: '0.75rem'
	},
	dark: {
		background: '#221938',
		foreground: '#eae2f6',
		card: '#292044',
		'card-foreground': '#eae2f6',
		popover: '#1c1531',
		'popover-foreground': '#efe8f9',
		primary: '#c084fc',
		'primary-foreground': '#201038',
		secondary: '#342a55',
		'secondary-foreground': '#ded3f0',
		muted: '#332952',
		'muted-foreground': '#aca0d0',
		accent: '#3d2f66',
		'accent-foreground': '#e5dcf4',
		destructive: '#e56ba1',
		border: '#473462',
		input: '#543b73',
		ring: '#f7931a',
		radius: '0.75rem'
	}
};

/**
 * ADR 0021: Continuum's own palette, used only inside Continuum's frame (never
 * in the gallery, never saved). Copied from torii-continuum
 * `src/styles/theme.css` (HSL in the comments); keep the two in step. The page
 * is Continuum's `--card`, so the frame reads as one of its cards; `card`
 * (other people's bubbles) is Continuum's `--secondary` / `--background`.
 * `accent` is a hover surface here, so it takes `--muted`, not Continuum's
 * orange. `app.html` carries the compiled CSS for the first paint.
 */
export const CONTINUUM_THEME: ThemeDefinition = {
	id: 'continuum',
	name: 'Continuum',
	softOwnBubbles: true,
	// ADR 0023: Continuum's font (src/styles/theme.css `--font-sans`) and bar.
	fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
	assistantBar: true,
	light: {
		background: '#ffffff', // 0 0% 100%
		foreground: '#26221d', // 36 14% 13%
		card: '#faf8f5', // 40 33% 97%
		'card-foreground': '#26221d', // 36 14% 13%
		popover: '#ffffff', // 0 0% 100%
		'popover-foreground': '#26221d', // 36 14% 13%
		primary: '#e18b09', // 36 92% 46%
		'primary-foreground': '#291f0f', // 36 45% 11%
		secondary: '#f1eee9', // 40 22% 93%
		'secondary-foreground': '#312d25', // 36 14% 17%
		muted: '#f3f1ec', // 40 22% 94%
		'muted-foreground': '#716b60', // 38 8% 41%
		accent: '#f3f1ec', // 40 22% 94%
		'accent-foreground': '#26221d', // 36 14% 13%
		destructive: '#bf2222', // 0 70% 44%
		border: '#eae5dc', // 38 26% 89%
		input: '#e4e0d7', // 40 20% 87%
		ring: '#e18b09', // 36 92% 46%
		radius: '0.75rem'
	},
	dark: {
		background: '#221f1c', // 32 10% 12%
		foreground: '#f0eeea', // 40 16% 93%
		card: '#322e2a', // 32 8% 18%
		'card-foreground': '#eeece7', // 40 16% 92%
		popover: '#221f1c', // 32 10% 12%
		'popover-foreground': '#f0eeea', // 40 16% 93%
		primary: '#f6ae31', // 38 92% 58%
		'primary-foreground': '#211a12', // 30 30% 10%
		secondary: '#322e2a', // 32 8% 18%
		'secondary-foreground': '#eeece7', // 40 16% 92%
		muted: '#34312d', // 32 8% 19%
		'muted-foreground': '#a6a096', // 38 8% 62%
		accent: '#34312d', // 32 8% 19%
		'accent-foreground': '#f0eeea', // 40 16% 93%
		destructive: '#e36363', // 0 70% 64% (Continuum's 52% is 3.5:1 here; AA needs 4.5)
		border: '#38332e', // 32 10% 20% (Continuum --card-border)
		input: '#48433d', // 32 8% 26%
		ring: '#f6ae31', // 38 92% 58%
		radius: '0.75rem'
	}
};

export const BUILTIN_THEMES: ThemeDefinition[] = [
	SOFT_THEME,
	CLASSIC_THEME,
	MATRIX_THEME,
	CYPHERPUNK_THEME,
	NAVY_THEME,
	WARM_PAPER_THEME,
	CATPPUCCIN_THEME,
	OSTRICH_THEME
];

export const DEFAULT_THEME_ID = SOFT_THEME.id;
