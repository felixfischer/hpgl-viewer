import { describe, expect, test } from "vitest";
import { type Point, parseHpgl, tessellate, type Wedge } from "./index.ts";

/** Tessellates the first primitive of the first page, rounded to 0.001 plu. */
function curve(hpgl: string): Point[] {
	const primitive = parseHpgl(hpgl).pages[0]?.primitives[0];
	if (primitive?.type !== "circle" && primitive?.type !== "arc")
		throw new Error("no curve");
	return round(tessellate(primitive));
}

function round(points: Point[]): Point[] {
	return points.map(([x, y]) => [
		Math.round(x * 1000) / 1000 + 0,
		Math.round(y * 1000) / 1000 + 0,
	]);
}

describe("tessellate", () => {
	test("a circle becomes a closed polygon of chords spanning the chord angle, starting at 0°", () => {
		expect(curve("PA1000,0;CI100,90;")).toEqual([
			[1100, 0],
			[1000, 100],
			[900, 0],
			[1000, -100],
			[1100, 0],
		]);
	});

	test("the chord angle is rounded so a whole number of chords spans the sweep", () => {
		expect(curve("CI100,50;")).toHaveLength(8); // 7 chords of 51.4°
	});

	test("chord angles clamp to 0…180; 0 is the finest resolution, still bounded", () => {
		expect(curve("CI100,500;")).toHaveLength(3); // 180° chords
		const finest = curve("CI100,0;").length;
		expect(curve("CI100,-5;")).toHaveLength(finest);
		expect(finest).toBeGreaterThan(360);
		expect(finest).toBeLessThanOrEqual(3601);
	});

	test("an arc runs from its start angle through its sweep; overdrawn sweeps stay bounded", () => {
		expect(curve("PU100,0;PD;AA0,0,-180,90;")).toEqual([
			[100, 0],
			[0, -100],
			[-100, 0],
		]);
		expect(
			curve("PU100,0;PD;AA0,0,1000000000000,0;").length,
		).toBeLessThanOrEqual(3601);
	});

	test("a wedge outline runs out along one radius, around the arc and back", () => {
		const wedge: Wedge = {
			type: "wedge",
			pen: 1,
			lineType: null,
			center: [0, 0],
			radius: 100,
			startAngle: 90,
			sweepAngle: 90,
			chordAngle: 90,
			filled: false,
		};
		expect(round(tessellate(wedge))).toEqual([
			[0, 0],
			[0, 100],
			[-100, 0],
			[0, 0],
		]);
	});
});
