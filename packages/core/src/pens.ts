import type { Page } from "./geometry.ts";

/** ADR-0004 default colours for pens 1–8. */
export const DEFAULT_PALETTE: readonly string[] = [
	"#1a1a1a",
	"#e6194b",
	"#4363d8",
	"#3cb44b",
	"#f58231",
	"#911eb4",
	"#0aa2c0",
	"#9a6324",
];

const GOLDEN_ANGLE = 137.508; // degrees
const SATURATION = 0.65;
const LIGHTNESS = 0.45;

/**
 * Default colour of a pen, as `#rrggbb` (what `<input type="color">` takes).
 * Pens past 8 step the hue by the golden angle from 0° at fixed S/L.
 */
export function penColour(pen: number): string {
	const named = DEFAULT_PALETTE[pen - 1];
	if (named) return named;
	const hue = ((pen - 9) * GOLDEN_ANGLE) % 360;
	// HSL → RGB, the CSS Color 4 formula.
	const a = SATURATION * Math.min(LIGHTNESS, 1 - LIGHTNESS);
	const channel = (n: number) => {
		const k = (n + hue / 30) % 12;
		const v = LIGHTNESS - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(v * 255)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Pens that actually drew on the page, ascending. Pens selected but never put down are left out. */
export function usedPens(page: Page): number[] {
	return [...new Set(page.primitives.map((p) => p.pen))].sort((a, b) => a - b);
}
