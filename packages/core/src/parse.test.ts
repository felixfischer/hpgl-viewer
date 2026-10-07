import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { type ParseResult, parseHpgl, tessellate } from "./index.ts";

/** One primitive or warning per line, so golden diffs stay reviewable. */
function golden({ pages, warnings }: ParseResult): string {
	const lines = pages.flatMap((page, i) => [
		page.size
			? `# page ${i + 1} size ${page.size.width}x${page.size.height}`
			: `# page ${i + 1}`,
		...page.primitives.flatMap((p) =>
			p.type === "circle" || p.type === "arc" || p.type === "wedge"
				? [
						JSON.stringify(p),
						`  tessellated ${JSON.stringify(tessellate(p).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]))}`,
					]
				: [JSON.stringify(p)],
		),
	]);
	lines.push("# warnings", ...warnings.map((w) => JSON.stringify(w)));
	return `${lines.join("\n")}\n`;
}

describe("parseHpgl", () => {
	test("pen-down moves draw a polyline from the pen-up position", () => {
		expect(parseHpgl("IN;SP1;PU10,20;PD30,40,50,60;").pages).toEqual([
			{
				primitives: [
					{
						type: "polyline",
						pen: 1,
						lineType: null,
						points: [
							[10, 20],
							[30, 40],
							[50, 60],
						],
					},
				],
			},
		]);
	});

	test("pen-up splits strokes; consecutive pen-down commands extend one stroke", () => {
		const [page] = parseHpgl("PU0,0;PD1,0;PD1,1;PU5,5;PD6,6;").pages;
		expect(
			page?.primitives.map((p) => p.type === "polyline" && p.points),
		).toEqual([
			[
				[0, 0],
				[1, 0],
				[1, 1],
			],
			[
				[5, 5],
				[6, 6],
			],
		]);
	});

	test("each stroke is tagged with the pen that drew it; SP0 draws nothing", () => {
		const [page] = parseHpgl("SP2;PD1,1;SP3;PD2,2;SP0;PD3,3;").pages;
		expect(
			page?.primitives.map((p) => [p.pen, p.type === "polyline" && p.points]),
		).toEqual([
			[
				2,
				[
					[0, 0],
					[1, 1],
				],
			],
			[
				3,
				[
					[1, 1],
					[2, 2],
				],
			],
		]);
	});

	test("unknown commands are skipped to the next terminator and reported", () => {
		const result = parseHpgl("IN;XX15;ZZ1,2,3;PD10,0;");
		expect(result.warnings).toEqual([
			{
				kind: "skipped",
				mnemonic: "XX",
				offset: 3,
				message: "Unsupported command XX skipped",
			},
			{
				kind: "skipped",
				mnemonic: "ZZ",
				offset: 8,
				message: "Unsupported command ZZ skipped",
			},
		]);
		expect(result.pages[0]?.primitives).toHaveLength(1);
	});

	test("VS (pen speed) has no visual effect and is accepted without a warning", () => {
		expect(parseHpgl("VS15;VS;").warnings).toEqual([]);
	});

	test("an HP-GL/2-only command raises one 'not supported' warning; the rest still renders", () => {
		const result = parseHpgl("BP;IN;PC1,255,0,0;PD10,0;PW0.5;");
		expect(result.warnings.filter((w) => w.kind === "dialect")).toEqual([
			{
				kind: "dialect",
				mnemonic: "BP",
				offset: 0,
				message:
					"HP-GL/2 is not supported; only classic HP-GL commands are drawn",
			},
		]);
		expect(result.pages[0]?.primitives).toHaveLength(1);
	});

	test("PCL/RTL escape sequences flag HP-GL/2 and are consumed whole", () => {
		const result = parseHpgl("\x1b%-12345X\x1bE\x1b%1BIN;PD10,0;\x1b%0A");
		expect(result.warnings).toEqual([
			{
				kind: "dialect",
				mnemonic: "ESC",
				offset: 0,
				message:
					"HP-GL/2 is not supported; only classic HP-GL commands are drawn",
			},
		]);
		expect(result.pages[0]?.primitives).toHaveLength(1);
	});

	test("classic ESC. device-control sequences are ignored silently", () => {
		const result = parseHpgl("\x1b.N;19:\x1b.B\x1b.@4000;0:IN;PD10,0;");
		expect(result.warnings).toEqual([]);
		expect(result.pages[0]?.primitives).toHaveLength(1);
	});

	test("binary bytes between commands flag HP-GL/2", () => {
		const result = parseHpgl("IN;PD10,0;\u0000\u00ff\ufffd;");
		expect(result.warnings).toEqual([
			{
				kind: "dialect",
				mnemonic: "",
				offset: 10,
				message:
					"HP-GL/2 is not supported; only classic HP-GL commands are drawn",
			},
		]);
	});

	test("numbers too large to represent are dropped rather than drawn at infinity", () => {
		const [page] = parseHpgl(`PD10,0,${"9".repeat(400)},5,20,0;`).pages;
		expect(
			page?.primitives.map((p) => p.type === "polyline" && p.points),
		).toEqual([
			[
				[0, 0],
				[10, 0],
				[5, 20],
			],
		]);
	});

	test("pathological input never hangs the parser", () => {
		let seed = 1;
		const noise = Array.from({ length: 1_000_000 }, () => {
			seed = (seed * 48271) % 2147483647;
			return String.fromCharCode(seed % 128);
		}).join("");
		const huge = [
			`PD${"1,".repeat(1_000_000)}`, // one command, enormous parameter list
			"ZZ".repeat(500_000), // unknown and unterminated
			";".repeat(1_000_000),
			`${"\x1b".repeat(100_000)}\x1b*b99999999W`,
			noise,
		];
		const started = performance.now();
		for (const text of huge) parseHpgl(text);
		expect(performance.now() - started).toBeLessThan(3000);
	});

	test("terminators may be omitted and whitespace separates parameters", () => {
		const [page] = parseHpgl("pu 0 0 pd 10 -5\r\nPD20,0").pages;
		expect(
			page?.primitives.map((p) => p.type === "polyline" && p.points),
		).toEqual([
			[
				[0, 0],
				[10, -5],
				[20, 0],
			],
		]);
	});

	test("IP/SC map user units onto P1..P2: 0..100 over 0..4000 plu is millimetres", () => {
		const [page] = parseHpgl(
			"IN;IP0,0,4000,4000;SC0,100,0,100;SP1;PA0,0;PD;PA100,0;PA100,100;PU;",
		).pages;
		expect(
			page?.primitives.map((p) => p.type === "polyline" && p.points),
		).toEqual([
			[
				[0, 0],
				[4000, 0],
				[4000, 4000],
			],
		]);
	});

	test("PR mode persists into PU/PD and offsets in user units; IN restores PA", () => {
		const [page] = parseHpgl(
			"IP0,0,4000,4000;SC0,100,0,100;PA10,10;PR;PD5,0;PU0,5;PD-5,0;IN;PD7,7;",
		).pages;
		expect(
			page?.primitives.map((p) => p.type === "polyline" && p.points),
		).toEqual([
			[
				[400, 400],
				[600, 400],
			],
			[
				[600, 600],
				[400, 600],
			],
			[
				[400, 600],
				[7, 7],
			],
		]);
	});

	test("RO90 rotates the coordinate system 90° counter-clockwise about the origin", () => {
		const [page] = parseHpgl(
			"RO90;PD4000,1000;PR;PD0,-1000;RO;PA4000,0;",
		).pages;
		expect(
			page?.primitives.map((p) => p.type === "polyline" && p.points),
		).toEqual([
			[
				[0, 0],
				[-1000, 4000],
				[0, 4000],
				[4000, 0],
			],
		]);
	});

	test("IW tags later primitives with the clip window in plotter units; IW; clears it", () => {
		const [page] = parseHpgl(
			"PD10,10;IW1000,500,-1000,-500;PD20,20;IW;PD30,30;",
		).pages;
		expect(page?.primitives.map((p) => p.window)).toEqual([
			undefined,
			{ from: [-1000, -500], to: [1000, 500] },
			undefined,
		]);
	});

	test("LT sets pattern and length (% of the P1–P2 diagonal, default 4); 7+ is ignored, negative or LT; is solid", () => {
		const [page] = parseHpgl(
			"IP0,0,3000,4000;LT2,10;PD1,1;LT;PD2,2;LT2;PD3,3;LT7;PD4,4;LT-1;PD5,5;",
		).pages;
		expect(page?.primitives.map((p) => p.lineType)).toEqual([
			{ pattern: 2, length: 500 },
			null,
			{ pattern: 2, length: 200 },
			null,
		]);
	});

	test("PG ends a page; drawing continues on the next one from the same pen position", () => {
		const { pages } = parseHpgl("PU0,0;PD10,0;PG;PD10,10;");
		expect(
			pages.map((p) =>
				p.primitives.map((q) => q.type === "polyline" && q.points),
			),
		).toEqual([
			[
				[
					[0, 0],
					[10, 0],
				],
			],
			[
				[
					[10, 0],
					[10, 10],
				],
			],
		]);
	});

	test("AF advances the page like PG; page ends with nothing drawn add no blank pages", () => {
		const result = parseHpgl("PG;PD1,1;AF;PG;PD2,2;PG;");
		expect(result.pages.map((p) => p.primitives.length)).toEqual([1, 1]);
	});

	test("the scaling points in force at the end are reported, defaulting to the A3 page", () => {
		expect(parseHpgl("PD1,1;").scalingPoints).toEqual({
			p1: [170, 602],
			p2: [15370, 10602],
		});
		expect(parseHpgl("IP100,200,3000,4000;PD1,1;").scalingPoints).toEqual({
			p1: [100, 200],
			p2: [3000, 4000],
		});
	});

	test("PS sets the page size in plotter units; following pages keep it", () => {
		const size = (hpgl: string) => parseHpgl(hpgl).pages.map((p) => p.size);
		expect(size("PD1,1;")).toEqual([undefined]);
		// Paper codes: 0–3 = A3, 4–127 = A4, landscape (420 × 297 mm, 297 × 210 mm).
		expect(size("PS0;PD1,1;")).toEqual([{ width: 16800, height: 11880 }]);
		expect(size("PS4;PD1,1;PG;PD2,2;")).toEqual([
			{ width: 11880, height: 8400 },
			{ width: 11880, height: 8400 },
		]);
		// Explicit length (X) and width (Y) in plotter units.
		expect(size("PS20000,10000;PD1,1;PG;PS0;PD2,2;")).toEqual([
			{ width: 20000, height: 10000 },
			{ width: 16800, height: 11880 },
		]);
	});

	test("CI draws a circle about the pen position even with the pen up, leaving the pen untouched", () => {
		const [page] = parseHpgl("PU100,200;CI50;PR;PD10,0;").pages;
		expect(page?.primitives).toEqual([
			{
				type: "circle",
				pen: 1,
				lineType: null,
				center: [100, 200],
				radius: 50,
				chordAngle: 5,
			},
			{
				type: "polyline",
				pen: 1,
				lineType: null,
				points: [
					[100, 200],
					[110, 200],
				],
			},
		]);
	});

	test("CT1 makes the CI resolution a chord height, CT0 (and IN) an angle again", () => {
		const angles = parseHpgl(
			"CT1;CI1000,500;CI1000;CT;CI1000,20;CT1;IN;CI1000,30;",
		).pages[0]?.primitives.map((p) => p.type === "circle" && p.chordAngle);
		// θ = 2·acos(1 − h/r): a chord height of half the radius gives 120° chords.
		expect(angles?.[0]).toBeCloseTo(120);
		expect(angles?.slice(1)).toEqual([5, 20, 30]);
	});

	test("AA draws an arc about an absolute center from the pen position, leaving the pen at its end", () => {
		const [page] = parseHpgl("PU1100,0;PD;AA1000,0,90;PD1000,200;").pages;
		expect(page?.primitives).toEqual([
			{
				type: "arc",
				pen: 1,
				lineType: null,
				center: [1000, 0],
				radius: 100,
				startAngle: 0,
				sweepAngle: 90,
				chordAngle: 5,
			},
			{
				type: "polyline",
				pen: 1,
				lineType: null,
				points: [
					[expect.closeTo(1000), expect.closeTo(100)],
					[1000, 200],
				],
			},
		]);
	});

	test("AA with the pen up only moves the pen to the arc end", () => {
		const [page] = parseHpgl("PU1100,0;AA1000,0,-90,30;PD1000,-200;").pages;
		expect(
			page?.primitives.map((p) => p.type === "polyline" && p.points),
		).toEqual([
			[
				[expect.closeTo(1000), expect.closeTo(-100)],
				[1000, -200],
			],
		]);
	});

	test("AR centers the arc at an offset from the pen position", () => {
		const [arc] =
			parseHpgl("PU100,100;PD;AR-100,0,-180,30;").pages[0]?.primitives ?? [];
		expect(arc).toMatchObject({
			type: "arc",
			center: [0, 100],
			radius: 100,
			startAngle: 0,
			sweepAngle: -180,
			chordAngle: 30,
		});
	});

	test("arcs follow RO90 and mirrored scaling; the pen ends at the transformed arc end", () => {
		const [page] = parseHpgl(
			"RO90;PU1100,0;PD;AA1000,0,90;PU;IN;IP0,0,1000,1000;SC100,0,0,100;PU0,0;PD;AR10,0,90;PR;PD0,0;",
		).pages;
		expect(page?.primitives).toMatchObject([
			{ center: [0, 1000], radius: 100, startAngle: 90, sweepAngle: 90 },
			{ center: [900, 0], radius: 100, startAngle: 0, sweepAngle: -90 },
			{ points: Array(2).fill([expect.closeTo(900), expect.closeTo(-100)]) },
		]);
	});

	test("under non-uniform scaling an arc is drawn as the elliptical polyline it plots as", () => {
		const [arc] =
			parseHpgl("IP0,0,2000,1000;SC0,10,0,10;PU10,0;PD;AA0,0,90,90;").pages[0]
				?.primitives ?? [];
		expect(arc).toMatchObject({
			type: "polyline",
			points: [
				[2000, 0],
				[expect.closeTo(0), 1000],
			],
		});
	});

	test("NR is accepted without effect", () => {
		const result = parseHpgl("PD1,1;NR;PD2,2;");
		expect(result.warnings).toEqual([]);
		expect(result.pages).toHaveLength(1);
	});

	test("PM0…PM2 buffers vertices without drawing; FP fills and EP edges the buffer", () => {
		const [page] = parseHpgl("SP2;PA0,0;PM0;PD100,0,100,100;PM2;FP;EP;").pages;
		const ring = [
			[0, 0],
			[100, 0],
			[100, 100],
		];
		expect(page?.primitives).toEqual([
			{ type: "polygon", pen: 2, lineType: null, rings: [ring], filled: true },
			{ type: "polygon", pen: 2, lineType: null, rings: [ring], filled: false },
		]);
	});

	test("PM1 and pen-up moves start new rings; the buffer survives PM2 until PM0 or IN", () => {
		const rings = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "polygon" && p.rings,
			);
		expect(
			rings(
				"PM0;PD10,0,10,10;PM1;PU20,20;PD30,20,30,30;PU50,50;PD60,50,60,60;PM2;FP;PD5,5;EP;",
			),
		).toEqual([
			[
				[
					[0, 0],
					[10, 0],
					[10, 10],
				],
				[
					[20, 20],
					[30, 20],
					[30, 30],
				],
				[
					[50, 50],
					[60, 50],
					[60, 60],
				],
			],
			false, // the PD between is an ordinary polyline
			[
				[
					[0, 0],
					[10, 0],
					[10, 10],
				],
				[
					[20, 20],
					[30, 20],
					[30, 30],
				],
				[
					[50, 50],
					[60, 50],
					[60, 60],
				],
			],
		]);
		// PM1/PM2 outside polygon mode are ignored; IN clears the buffer.
		expect(rings("PM1;PD10,0;PM2;PU;PM0;PD10,0,10,10;PM2;IN;FP;")).toEqual([
			false,
		]);
	});

	test("a CI inside polygon mode adds a closed subpolygon ring", () => {
		const [page] = parseHpgl("PM0;PD0,0,100,0,100,100;PM1;CI50;PM2;EP;").pages;
		const poly = page?.primitives[0];
		expect(poly?.type).toBe("polygon");
		if (poly?.type !== "polygon") return;
		expect(poly.rings).toHaveLength(2);
		expect(poly.rings[1]?.length).toBeGreaterThan(8);
	});

	test("RA/EA fill/edge to an absolute corner, RR/ER to a relative one; the pen stays put", () => {
		const [page] = parseHpgl(
			"PA10,10;RA30,40;PR;EA50,60;RR-5,-5;ER20,-20;RA;PD1,1;",
		).pages;
		expect(page?.primitives).toEqual([
			{
				type: "rectangle",
				pen: 1,
				lineType: null,
				from: [10, 10],
				to: [30, 40],
				filled: true,
			},
			{
				type: "rectangle",
				pen: 1,
				lineType: null,
				from: [10, 10],
				to: [50, 60],
				filled: false,
			},
			{
				type: "rectangle",
				pen: 1,
				lineType: null,
				from: [10, 10],
				to: [5, 5],
				filled: true,
			},
			{
				type: "rectangle",
				pen: 1,
				lineType: null,
				from: [10, 10],
				to: [30, -10],
				filled: false,
			},
			{
				type: "polyline",
				pen: 1,
				lineType: null,
				points: [
					[10, 10],
					[11, 11],
				],
			},
		]);
	});

	test("WG fills and EW edges a wedge about the pen; negative r flips the start radius", () => {
		const [page] = parseHpgl(
			"IP0,0,4000,4000;SC0,100,0,100;PA50,50;WG10,30,90;EW-10,30,-45,10;WG;PD50,60;",
		).pages;
		expect(page?.primitives).toEqual([
			{
				type: "wedge",
				pen: 1,
				lineType: null,
				center: [2000, 2000],
				radius: 400,
				startAngle: 30,
				sweepAngle: 90,
				chordAngle: 5,
				filled: true,
			},
			{
				type: "wedge",
				pen: 1,
				lineType: null,
				center: [2000, 2000],
				radius: 400,
				startAngle: 210,
				sweepAngle: -45,
				chordAngle: 10,
				filled: false,
			},
			{
				type: "polyline",
				pen: 1,
				lineType: null,
				points: [
					[2000, 2000],
					[2000, 2400],
				],
			},
		]);
	});

	test("FT3/FT4 hatch fills at spacing (user units) and angle; FT1/2 are solid; FT3,0 spaces by PT", () => {
		const hatches = (hpgl: string) =>
			parseHpgl(
				`IP0,0,3000,4000;SC0,300,0,400;${hpgl}`,
			).pages[0]?.primitives.map(
				(p) => "filled" in p && p.filled && (p.hatch ?? "solid"),
			);
		expect(
			hatches(
				"FT3,10,45;RA10,10;EA20,20;FT4;WG5,0,90;FT2;RR1,1;FT3,0;PT1;PM0;PD1,1,1,0;PM2;FP;FT;FT3;RA1,1;",
			),
		).toEqual([
			{ spacing: 100, angle: 45, cross: false },
			false, // edges never hatch
			{ spacing: 100, angle: 45, cross: true }, // FT4 keeps the previous spacing and angle
			"solid",
			{ spacing: 40, angle: 45, cross: false }, // PT1 = 1 mm = 40 plu
			{ spacing: 50, angle: 0, cross: false }, // default: 1% of the 5000 plu P1–P2 diagonal
		]);
	});

	test("LB draws its text up to ETX at the pen, in the default relative size; ';' is literal", () => {
		// SR 0.75,1.5 of the default P1–P2 span (15200 × 10000) = 114 × 150.
		const [page] = parseHpgl("PU100,200;LBA;B\x03PD;").pages;
		expect(page?.primitives).toEqual([
			{
				type: "label",
				pen: 1,
				lineType: null,
				text: "A;B",
				at: [100, 200],
				width: 114,
				height: 150,
				direction: 0,
				slant: 0,
			},
		]);
	});

	test("after LB the pen sits at the next character origin, 1.5 × width per character", () => {
		const [, line] =
			parseHpgl("PU100,200;LBAB\x03PD100,0;").pages[0]?.primitives ?? [];
		expect(line?.type === "polyline" && line.points[0]).toEqual([442, 200]);
	});

	test("DT sets the terminator (not printed); DT; restores ETX; a label without one runs to EOF", () => {
		const texts = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "label" && p.text,
			);
		expect(texts("DT$;LBA\x03B$DT;LBC\x03")).toEqual(["AB", "C"]);
		expect(texts("DT$,0;LBA$\x03")).toEqual(["A$"]);
		expect(texts("LBA;PD1,1;")).toEqual(["A;PD1,1;"]);
	});

	test("control characters in a label move within the label frame: CR LF BS HT VT", () => {
		const placed = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "label" && [p.text, p.at],
			);
		// One cell is 171 wide (1.5 × 114); one line is 300 tall (2 × 150).
		expect(placed("PU1000,1000;LBA\r\nB\x03")).toEqual([
			["A", [1000, 1000]],
			["B", [1000, 700]],
		]);
		expect(placed("LBAB\b\bC\tD\vE\x03")).toEqual([
			["AB", [0, 0]],
			["C", [0, 0]],
			["D", [85.5, 0]],
			["E", [256.5, 300]],
		]);
	});

	test("SI sizes in cm, SR in % of the P1–P2 span (tracking IP), SU in user units; 1 or 3 params are ignored", () => {
		const sizes = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "label" && [p.width, p.height],
			);
		expect(
			sizes("SI0.5,1;LBA\x03SI2;LBB\x03SI1,1,1;LBC\x03SI;LBD\x03"),
		).toEqual([
			[200, 400],
			[200, 400],
			[200, 400],
			[114, 150],
		]);
		expect(sizes("SR1,2;IP0,0,1000,2000;LBA\x03IN;LBB\x03")).toEqual([
			[10, 40],
			[114, 150],
		]);
		expect(sizes("IP0,0,4000,4000;SC0,100,0,100;SU5,10;LBA\x03")).toEqual([
			[200, 400],
		]);
	});
	test("DI/DR/DU turn the baseline and the label frame; SL slants; RO90 turns labels too", () => {
		const labels = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map((p) =>
				p.type === "label" ? [p.text, p.at, p.direction, p.slant] : null,
			);
		expect(labels("DI0,1;SL0.5;LBAB\r\nC\x03")).toEqual([
			["AB", [0, 0], 90, 0.5],
			["C", [300, 0], 90, 0.5],
		]);
		// DI; restores 1,0; DI0,0 and one-parameter DI are ignored; SL; is upright.
		expect(labels("DI0,1;DI0,0;DI5;LBA\x03DI;SL;LBB\x03")).toEqual([
			["A", [0, 0], 90, 0],
			["B", [0, 171], 0, 0],
		]);
		// DR runs against the P1–P2 orientation, DU against the user axes.
		expect(labels("IP2000,0,0,1000;DR1,0;LBA\x03")?.[0]?.[2]).toBe(180);
		expect(labels("IP0,0,100,100;SC100,0,0,100;DU1,0;LBA\x03")?.[0]?.[2]).toBe(
			180,
		);
		expect(labels("RO90;LBA\x03")?.[0]?.[2]).toBe(90);
	});
	test("LO places each line around the pen (3×3 grid, +10 pushed out by half a character)", () => {
		// "AB" spans 1.5 × 114 + 114 = 285 wide and 150 tall.
		const at = (lo: number | string) =>
			parseHpgl(`LO${lo};LBAB\x03`).pages[0]?.primitives.map(
				(p) => p.type === "label" && p.at,
			)[0];
		expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(at)).toEqual([
			[0, 0],
			[0, -75],
			[0, -150],
			[-142.5, 0],
			[-142.5, -75],
			[-142.5, -150],
			[-285, 0],
			[-285, -75],
			[-285, -150],
		]);
		expect([11, 13, 14, 16, 17, 19].map(at)).toEqual([
			[57, 75],
			[57, -225],
			[-142.5, 75],
			[-142.5, -225],
			[-342, 75],
			[-342, -225],
		]);
		// LO; is 1; undefined origins keep the previous one.
		expect(["7;LO", "7;LO15", "7;LO0", "7;LO20"].map(at)).toEqual([
			[0, 0],
			[-285, 0],
			[-285, 0],
			[-285, 0],
		]);
	});

	test("with LO, every line is aligned on its own; non-left origins leave the pen where it was", () => {
		const prims = parseHpgl("PU1000,0;LO7;LBAB\r\nA\x03PD1000,10;").pages[0]
			?.primitives;
		expect(
			prims?.map((p) =>
				p.type === "label" ? p.at : p.type === "polyline" && p.points,
			),
		).toEqual([
			[715, 0],
			[886, -300],
			[
				[1000, 0],
				[1000, 10],
			],
		]);
		const [, line] = parseHpgl("LO2;LBAB\x03PD0,0;").pages[0]?.primitives ?? [];
		expect(line?.type === "polyline" && line.points[0]).toEqual([342, 0]);
	});
	test("ES widens the character and line pitch by fractions of the cell; spaced characters are placed one by one", () => {
		const placed = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "label" && [p.text, p.at],
			);
		expect(placed("ES0.5,1;LBAB\nC\x03")).toEqual([
			["A", [0, 0]],
			["B", [256.5, 0]],
			["C", [513, -600]],
		]);
		expect(placed("ES0.5;ES;LBAB\x03")).toEqual([["AB", [0, 0]]]);
	});

	test("DV1 stacks upright characters downwards; a line feed starts the next column to the left", () => {
		const placed = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "label" && [p.text, p.at, p.direction],
			);
		expect(placed("DV1;LBAB\r\nC\x03DV;LBD\x03")).toEqual([
			["A", [0, 0], 0],
			["B", [0, -300], 0],
			["C", [-171, 0], 0],
			["D", [-171, -300], 0],
		]);
	});
	test("CP moves the pen by character cells and lines; CP; returns to the label's start column one line down", () => {
		const placed = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "label" && [p.text, p.at],
			);
		expect(placed("CP2,0.5;LBA\x03")).toEqual([["A", [342, 150]]]);
		expect(placed("PU100,0;LBAB\x03CP;LBC\x03")).toEqual([
			["AB", [100, 0]],
			["C", [100, -300]],
		]);
		// A pen move since the last label makes the new position the start column.
		expect(placed("LBAB\x03PU500,500;CP;LBC\x03")).toEqual([
			["AB", [0, 0]],
			["C", [500, 200]],
		]);
	});
	test("BL buffers a label (up to 150 characters) without drawing; PB draws it from the pen as lower-left, ignoring LO", () => {
		const placed = (hpgl: string) =>
			parseHpgl(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "label" && [p.text, p.at],
			);
		expect(placed("LO5;BLAB\r\nC\x03PU100,0;PB;PB;")).toEqual([
			["AB", [100, 0]],
			["C", [100, -300]],
			["AB", [271, -300]],
			["C", [100, -600]],
		]);
		expect(placed("BLA\x03BL\x03PB;")).toEqual([]);
		const [long] =
			parseHpgl(`BL${"x".repeat(200)}\x03PB;`).pages[0]?.primitives ?? [];
		expect(long?.type === "label" && long.text).toHaveLength(150);
	});

	test("CS/CA designate the standard and alternate sets; SS/SA and SI/SO in a label select them", () => {
		const result = (hpgl: string) => parseHpgl(hpgl);
		const texts = (hpgl: string) =>
			result(hpgl).pages[0]?.primitives.map(
				(p) => p.type === "label" && p.text,
			);
		// Set 8: JIS X 0201 katakana; set 101: two-byte JIS kanji.
		expect(texts("CS8;LB12\x03")).toEqual(["ｱｲ"]);
		expect(texts("CS0;CA101;SA;LBJ8;z\x03SS;LBJ8\x03")).toEqual(["文字", "J8"]);
		expect(texts("CA8;LBA\x0e1\x0fB\x03")).toEqual(["AｱB"]);
		expect(texts("CA8;SA;IN;LB1\x03")).toEqual(["1"]);
	});

	test("labels in a character set the viewer can't draw fall back to ASCII with one warning per set", () => {
		const { pages, warnings } = parseHpgl(
			"CS3;LBA\x03LBB\x03CA4;SA;PB;CS;SS;LBC\x03",
		);
		expect(
			pages[0]?.primitives.map((p) => p.type === "label" && p.text),
		).toEqual(["A", "B", "C"]);
		expect(warnings).toEqual([
			{
				kind: "charset",
				mnemonic: "LB",
				offset: 4,
				message: "Character set 3 is drawn as ASCII",
			},
		]);
	});
});

describe.each([
	"space-shuttle",
	"starry-night",
	"millimetres",
	"input-window",
	"rotate",
	"line-types",
	"multi-page",
	"unsupported",
	"hpgl2-sample",
	"circles",
	"arcs",
	"polygons",
	"rectangles",
	"wedges",
	"labels",
	"labels-buffered",
])("fixture %s.hpgl", (name) => {
	test("parses to its golden geometry stream", async () => {
		const text = readFileSync(
			new URL(`../../../hpgl/${name}.hpgl`, import.meta.url),
			"utf8",
		);
		await expect(golden(parseHpgl(text))).toMatchFileSnapshot(
			`../goldens/${name}.golden`,
		);
	});
});
