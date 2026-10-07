import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { type ParseResult, parseHpgl } from "./index.ts";

/** One primitive or warning per line, so golden diffs stay reviewable. */
function golden({ pages, warnings }: ParseResult): string {
	const lines = pages.flatMap((page, i) => [
		page.size
			? `# page ${i + 1} size ${page.size.width}x${page.size.height}`
			: `# page ${i + 1}`,
		...page.primitives.map((p) => JSON.stringify(p)),
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
