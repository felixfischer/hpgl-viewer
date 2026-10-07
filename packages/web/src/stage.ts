// Renderer-neutral staging shared by the Canvas view and SVG export.
import {
	type Hatch,
	type Label,
	type Page,
	type ParseResult,
	type Point,
	type Primitive,
	tessellate,
	type Window,
} from "@hpgl-viewer/core";

/** Cap height of the platform font as a fraction of its em size. */
export const CAP_HEIGHT = 0.72;

/** The corners of a label's text box, for fitting the view. */
export function labelCorners({
	at,
	text,
	width,
	height,
	direction,
}: Label): Point[] {
	const [ux, uy] = [
		Math.cos((direction * Math.PI) / 180),
		Math.sin((direction * Math.PI) / 180),
	];
	const length = [...text].length * 1.5 * width;
	const [lx, ly] = [length * ux, length * uy];
	const [hx, hy] = [-height * uy, height * ux];
	return [
		at,
		[at[0] + lx, at[1] + ly],
		[at[0] + lx + hx, at[1] + ly + hy],
		[at[0] + hx, at[1] + hy],
	];
}

/** The rings a primitive draws, in plotter units; `null` for types not rendered yet. */
export function outline(
	p: Primitive,
): { rings: Point[][]; closed: boolean } | null {
	switch (p.type) {
		case "polyline":
			return { rings: [p.points], closed: false };
		case "polygon":
			return { rings: p.rings, closed: true };
		case "rectangle": {
			const [[x1, y1], [x2, y2]] = [p.from, p.to];
			const ring: Point[] = [
				[x1, y1],
				[x2, y1],
				[x2, y2],
				[x1, y2],
			];
			return { rings: [ring], closed: true };
		}
		case "circle":
			return { rings: [tessellate(p)], closed: true };
		case "arc":
			return { rings: [tessellate(p)], closed: false };
		case "wedge":
			return { rings: [tessellate(p)], closed: true };
		default:
			return null;
	}
}

export type Box = [minX: number, minY: number, maxX: number, maxY: number];

/** Extent of what survives each primitive's input window, in plotter units. */
export function contentBox(
	bounds: { points: Point[]; window?: Window }[],
): Box {
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const { points, window } of bounds) {
		for (let [x, y] of points) {
			if (window) {
				x = Math.min(Math.max(x, window.from[0]), window.to[0]);
				y = Math.min(Math.max(y, window.from[1]), window.to[1]);
			}
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	return [minX, minY, maxX, maxY];
}

/**
 * The sheet the plot sits on: the `PS` size, else the area P1/P2 span plus a
 * matching margin from the origin (ADR-0008).
 */
export function pageBox(page: Page, { p1, p2 }: ScalingPoints): Box {
	if (page.size) return [0, 0, page.size.width, page.size.height];
	return [0, 0, p1[0] + p2[0], p1[1] + p2[1]];
}

export type ScalingPoints = ParseResult["scalingPoints"];

/**
 * Parallel hatch lines `spacing` apart across the rings' bounds, anchored at
 * the origin; callers clip them to the rings.
 */
export function hatchLines(
	rings: Point[][],
	{ spacing, angle, cross }: Hatch,
): [Point, Point][] {
	const lines: [Point, Point][] = [];
	for (const a of cross ? [angle, angle + 90] : [angle]) {
		const r = (a * Math.PI) / 180;
		const [dx, dy] = [Math.cos(r), Math.sin(r)]; // along the lines
		const [nx, ny] = [-dy, dx]; // across them
		let [t1, t2, u1, u2] = [Infinity, -Infinity, Infinity, -Infinity];
		for (const [x, y] of rings.flat()) {
			const [t, u] = [x * dx + y * dy, x * nx + y * ny];
			[t1, t2] = [Math.min(t1, t), Math.max(t2, t)];
			[u1, u2] = [Math.min(u1, u), Math.max(u2, u)];
		}
		for (let k = Math.ceil(u1 / spacing); k * spacing <= u2; k++) {
			const [px, py] = [nx * k * spacing, ny * k * spacing];
			lines.push([
				[px + dx * t1, py + dy * t1],
				[px + dx * t2, py + dy * t2],
			]);
		}
	}
	return lines;
}
