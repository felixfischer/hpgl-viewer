import { readFileSync } from "node:fs";
import { parseHpgl, penColour } from "@hpgl-viewer/core";
import { describe, expect, test } from "vitest";
import { fittedView } from "./render.ts";
import { toSvg } from "./svg.ts";

/** SVG export of the first page of an HP-GL program, default pen colours. */
function svgOf(hpgl: string, view = fittedView()): string {
	const { pages, scalingPoints } = parseHpgl(hpgl);
	if (!pages[0]) throw new Error("no page");
	return toSvg(pages[0], { colourOf: penColour, scalingPoints, view });
}

describe("toSvg", () => {
	test("a polyline is a stroked <polyline> in the pen's colour, Y flipped upright", () => {
		const svg = svgOf("IN;SP2;PU0,0;PD1000,0,1000,500;");
		expect(svg).toContain('viewBox="-6 -506 1012 512"');
		expect(svg).toContain('<g transform="scale(1,-1)"');
		expect(svg).toContain(
			'<polyline stroke="#e6194b" points="0,0 1000,0 1000,500"/>',
		);
	});

	test("a circle is a real <circle>, not a tessellated outline", () => {
		const svg = svgOf("IN;SP1;PU2000,2000;CI1000;");
		expect(svg).toContain('viewBox="994 -3006 2012 2012"');
		expect(svg).toContain(
			'<circle stroke="#1a1a1a" cx="2000" cy="2000" r="1000"/>',
		);
	});

	test("a coarse chord angle is drawn as the polygon a plotter draws", () => {
		expect(svgOf("IN;SP1;PU0,0;CI1000,90;")).toContain(
			'<polygon stroke="#1a1a1a" points="1000,0 0,1000 -1000,0 0,-1000 1000,0"/>',
		);
		expect(svgOf("IN;SP1;PU0,0;PD;AA0,1000,90,45;")).toContain(
			'<polyline stroke="#1a1a1a" points="0,0 707.11,292.89 1000,1000"/>',
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

	test("a line type is a dash array scaled to its pattern length", () => {
		// LT2 is half on, half off; the default length is 4% of the P1–P2 diagonal.
		const svg = svgOf("IN;SP1;IP0,0,3000,4000;LT2;PU0,0;PD3000,0;");
		expect(svg).toContain('stroke-dasharray="100 100"');
	});

	test("line type 0 is a dot at each vertex", () => {
		expect(svgOf("IN;SP1;LT0;PU0,0;PD1000,0,1000,500;")).toContain(
			'<path stroke="#1a1a1a" d="M0,0h0 M1000,0h0 M1000,500h0"/>',
		);
	});

	test("a hatched fill is solid lines clipped to the shape", () => {
		const svg = svgOf("IN;SP1;FT3,100,0;PU0,0;RA300,250;");
		expect(svg).toContain(
			'<clipPath id="c0"><rect clip-rule="evenodd" x="0" y="0" width="300" height="250"/></clipPath>',
		);
		expect(svg).toContain(
			'<path stroke="#1a1a1a" clip-path="url(#c0)" d="M0,0L300,0 M0,100L300,100 M0,200L300,200"/>',
		);
	});

	test("an input window clips what is drawn under it, one clipPath per window", () => {
		const svg = svgOf(
			"IN;SP1;IW0,0,500,500;PU-100,250;PD600,250;PU250,-100;PD250,600;",
		);
		expect(svg).toContain('viewBox="-6 -506 512 512"');
		expect(svg.match(/<clipPath/g)).toHaveLength(1);
		expect(svg).toContain(
			'<clipPath id="c0"><rect x="0" y="0" width="500" height="500"/></clipPath>',
		);
		expect(svg.match(/<g clip-path="url\(#c0\)">/g)).toHaveLength(2);
	});

	test("the SVG is real size (0.025 mm per unit) with round 0.3 mm pens, padded by half a pen", () => {
		const svg = svgOf("IN;SP2;PU0,0;PD1000,0,1000,500;");
		expect(svg).toContain('width="25.3mm" height="12.8mm"');
		expect(svg).toContain(
			'stroke-width="12" stroke-linecap="round" stroke-linejoin="round"',
		);
	});

	test("in the actual-page-size view the SVG frames the whole sheet", () => {
		const svg = svgOf("IN;SP1;PS4000,3000;PU1000,1000;PD2000,1000;", {
			...fittedView(),
			actual: true,
		});
		expect(svg).toContain(
			'viewBox="-6 -3006 4012 3012" width="100.3mm" height="75.3mm"',
		);
	});
});

// One golden per primitive, each from the fixture that exercises it, plus
// clipping and a real-world plot. Review the .svg diffs by opening them.
describe.each([
	["polyline", "line-types"],
	["circle", "circles"],
	["arc", "arcs"],
	["wedge", "wedges"],
	["rectangle", "rectangles"],
	["polygon", "polygons"],
	["label", "labels"],
	["input-window", "input-window"],
	["space-shuttle", "space-shuttle"],
])("SVG golden: %s", (name, fixture) => {
	test(`hpgl/${fixture}.hpgl exports to goldens/${name}.svg`, async () => {
		const hpgl = readFileSync(
			new URL(`../../../hpgl/${fixture}.hpgl`, import.meta.url),
			"utf8",
		);
		await expect(svgOf(hpgl)).toMatchFileSnapshot(`../goldens/${name}.svg`);
	});
});
