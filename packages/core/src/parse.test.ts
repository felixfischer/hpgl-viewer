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
