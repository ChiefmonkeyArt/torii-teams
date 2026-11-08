// ADR 0013: how strongly the shisa pair takes on the theme's colour.
// A theme with a real colour (navy, purple, green, yellow) gets a 35% wash
// of its primary; a grey or near-grey primary (Classic, Soft) gets none,
// because a grey wash only dulls the art.

export const SHISA_TINT = 0.35;
const MIN_SATURATION = 0.2;

/** HSL saturation (0..1) of `#rgb` or `#rrggbb[aa]`; null if not a hex colour. */
export function hexSaturation(hex: string): number | null {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
	if (!m) return null;
	let h = m[1];
	if (h.length === 3) h = [...h].map((c) => c + c).join('');
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return 0;
	return d / (1 - Math.abs(2 * l - 1));
}

/** The wash strength for a theme's primary colour: SHISA_TINT or 0. */
export function shisaTint(primary: string): number {
	const s = hexSaturation(primary);
	return s !== null && s >= MIN_SATURATION ? SHISA_TINT : 0;
}
