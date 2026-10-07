import { parseHpgl, penColour } from "@hpgl-viewer/core";
import { describe, expect, test } from "vitest";
import { toSvg } from "./svg.ts";

/** SVG export of the first page of an HP-GL program, default pen colours. */
function svgOf(hpgl: string): string {
	const { pages, scalingPoints } = parseHpgl(hpgl);
	if (!pages[0]) throw new Error("no page");
	return toSvg(pages[0], { colourOf: penColour, scalingPoints });
}

describe("toSvg", () => {
	test("a polyline is a stroked <polyline> in the pen's colour, Y flipped upright", () => {
		const svg = svgOf("IN;SP2;PU0,0;PD1000,0,1000,500;");
		expect(svg).toContain('viewBox="0 -500 1000 500"');
		expect(svg).toContain('<g transform="scale(1,-1)"');
		expect(svg).toContain(
			'<polyline stroke="#e6194b" points="0,0 1000,0 1000,500"/>',
		);
	});

	test("a circle is a real <circle>, not a tessellated outline", () => {
		const svg = svgOf("IN;SP1;PU2000,2000;CI1000;");
		expect(svg).toContain('viewBox="1000 -3000 2000 2000"');
		expect(svg).toContain(
			'<circle stroke="#1a1a1a" cx="2000" cy="2000" r="1000"/>',
		);
	});

	test("an arc is a <path> with a real A command, honouring direction and size", () => {
		expect(svgOf("IN;SP1;PU0,0;PD;AA0,1000,90;")).toContain(
			'<path stroke="#1a1a1a" d="M0,0 A1000,1000 0 0 1 1000,1000"/>',
		);
		expect(svgOf("IN;SP1;PU0,0;PD;AA0,1000,-270;")).toContain(
			'<path stroke="#1a1a1a" d="M0,0 A1000,1000 0 1 0 1000,1000"/>',
		);
	});

	test("a wedge is two radii and a real arc; WG fills it, EW strokes it", () => {
		const d = "M0,0 L1000,0 A1000,1000 0 0 1 0,1000 Z";
		expect(svgOf("IN;SP1;PU0,0;EW1000,0,90;")).toContain(
			`<path stroke="#1a1a1a" d="${d}"/>`,
		);
		expect(svgOf("IN;SP1;PU0,0;WG1000,0,90;")).toContain(
			`<path fill="#1a1a1a" d="${d}"/>`,
		);
	});

	test("a rectangle is a <rect>, normalised whichever corner it starts from", () => {
		expect(svgOf("IN;SP1;PU0,0;ER1000,500;")).toContain(
			'<rect stroke="#1a1a1a" x="0" y="0" width="1000" height="500"/>',
		);
		expect(svgOf("IN;SP1;PU1000,500;RR-1000,-500;")).toContain(
			'<rect fill="#1a1a1a" x="0" y="0" width="1000" height="500"/>',
		);
	});

	test("a polygon is a <polygon>; several rings are one even-odd <path>", () => {
		expect(svgOf("IN;SP1;PU0,0;PM0;PD1000,0,1000,1000;PM2;EP;")).toContain(
			'<polygon stroke="#1a1a1a" points="0,0 1000,0 1000,1000"/>',
		);
		expect(
			svgOf(
				"IN;SP1;PU0,0;PM0;PD3000,0,3000,3000,0,3000;PM1;PU1000,1000;PD2000,1000,2000,2000,1000,2000;PM2;FP;",
			),
		).toContain(
			'<path fill="#1a1a1a" fill-rule="evenodd" d="M0,0 3000,0 3000,3000 0,3000Z M1000,1000 2000,1000 2000,2000 1000,2000Z"/>',
		);
	});

	test("a label stays <text>: cap height, 1.5-width cells, escaped", () => {
		// SI 0.2,0.3 cm = 80 × 120 plotter units: font size 120 / 0.72 cap
		// height; glyph advance 0.6 em scaled to 80 wide, cells 1.5 × 80 apart.
		expect(svgOf("IN;SP2;PU0,0;SI0.2,0.3;LBA<&C\x03")).toContain(
			'<text fill="#e6194b" font-family="monospace" font-size="166.67" xml:space="preserve" transform="translate(0,0) rotate(0) matrix(1,0,0,1,0,0) scale(0.8,-1)" x="0 150 300 450">A&lt;&amp;C</text>',
		);
	});

	test("a label's direction and slant become a rotation and shear", () => {
		expect(svgOf("IN;SP1;PU100,200;DI0,1;SL0.5;LBX\x03")).toMatch(
			/transform="translate\(100,200\) rotate\(90\) matrix\(1,0,0.5,1,0,0\) scale\([\d.]+,-1\)"/,
		);
	});
});
