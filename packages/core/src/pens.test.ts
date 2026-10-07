import { describe, expect, test } from "vitest";
import { DEFAULT_PALETTE, parseHpgl, penColour, usedPens } from "./index.ts";

describe("penColour", () => {
	test("pens 1–8 use the spec's named palette", () => {
		expect([1, 2, 3, 4, 5, 6, 7, 8].map(penColour)).toEqual([
			"#1a1a1a",
			"#e6194b",
			"#4363d8",
			"#3cb44b",
			"#f58231",
			"#911eb4",
			"#0aa2c0",
			"#9a6324",
		]);
		expect(DEFAULT_PALETTE).toHaveLength(8);
	});

	test("pens past 8 step the hue by the golden angle at S 65%, L 45%", () => {
		// Worked by hand: pen 9 = hsl(0°, 65%, 45%), pen 10 = hsl(137.508°, 65%, 45%).
		expect(penColour(9)).toBe("#bd2828");
		expect(penColour(10)).toBe("#28bd54");
	});

	test("every pen up to 255 gets its own colour, the same on every call", () => {
		const pens = Array.from({ length: 255 }, (_, i) => i + 1);
		const colours = pens.map(penColour);
		expect(new Set(colours).size).toBe(255);
		expect(colours.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
		expect(pens.map(penColour)).toEqual(colours);
	});
});

describe("usedPens", () => {
	test("lists the pens that drew on the page, ascending, once each; SP0 never", () => {
		const [page] = parseHpgl(
			"SP3;PD1,1;SP1;PD2,2;SP12;PD3,3;SP3;PD4,4;SP0;PD5,5;SP7;",
		).pages;
		expect(page && usedPens(page)).toEqual([1, 3, 12]);
	});
});
