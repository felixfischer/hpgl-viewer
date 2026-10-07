import {
	LINE_PATTERNS,
	type Page,
	type ParseResult,
	type Point,
	type Polyline,
} from "@hpgl-viewer/core";

const MARGIN = 16; // CSS px
/** Canvas px per plotter unit at real size: 0.025 mm per unit, 96 CSS px per inch. */
const ACTUAL_SCALE = (0.025 / 25.4) * 96;

/** The user's view: a base frame plus zoom and pan, applied in canvas px. */
export interface View {
	/** `true` = actual page size; `false` = fit to content (the default). */
	actual: boolean;
	zoom: number;
	pan: [number, number];
}

export const fittedView = (): View => ({ actual: false, zoom: 1, pan: [0, 0] });

type Box = [minX: number, minY: number, maxX: number, maxY: number];

/** Extent of what survives each primitive's input window, in plotter units. */
function contentBox(polylines: Polyline[]): Box {
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const { points, window } of polylines) {
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
 * matching margin from the origin (ADR-0007).
 */
function pageBox(page: Page, { p1, p2 }: ScalingPoints): Box {
	if (page.size) return [0, 0, page.size.width, page.size.height];
	return [0, 0, p1[0] + p2[0], p1[1] + p2[1]];
}

type ScalingPoints = ParseResult["scalingPoints"];

/**
 * Plotter units → canvas px: the content centred, fitted or at real size, then
 * the user's zoom and pan. Flips Y once. `scale` is canvas px per plotter unit.
 */
function frame(
	canvas: HTMLCanvasElement,
	content: Box,
	view: View,
): { toView: (p: Point) => Point; scale: number } {
	const dpr = window.devicePixelRatio || 1;
	const [minX, minY, maxX, maxY] = content;
	const margin = MARGIN * dpr;
	const base = view.actual
		? ACTUAL_SCALE * dpr
		: Math.min(
				(canvas.width - 2 * margin) / (maxX - minX || 1),
				(canvas.height - 2 * margin) / (maxY - minY || 1),
			);
	const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
	const { zoom, pan } = view;
	return {
		toView: ([x, y]) => [
			pan[0] + zoom * (canvas.width / 2 + (x - cx) * base),
			pan[1] + zoom * (canvas.height / 2 - (y - cy) * base),
		],
		scale: base * zoom,
	};
}

/** Draws the page in the given view, flipping HP-GL's Y-up plotter units once. */
export function renderPage(
	canvas: HTMLCanvasElement,
	page: Page,
	colourOf: (pen: number) => string,
	scalingPoints: ScalingPoints,
	view: View = fittedView(),
): void {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.round(canvas.clientWidth * dpr);
	canvas.height = Math.round(canvas.clientHeight * dpr);
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	const polylines = page.primitives.flatMap((p) =>
		p.type === "polyline" ? [p] : [],
	);
	const sheet = pageBox(page, scalingPoints);
	let content = contentBox(polylines);
	if (content[0] > content[2]) {
		if (!view.actual) return;
		content = sheet;
	}
	const { toView, scale } = frame(canvas, content, view);
	if (view.actual) {
		// The sheet's outline, so the plot's real size and placement show.
		const [x1, y1] = toView([sheet[0], sheet[1]]);
		const [x2, y2] = toView([sheet[2], sheet[3]]);
		ctx.strokeStyle = "#bbb";
		ctx.lineWidth = dpr;
		ctx.strokeRect(x1, y2, x2 - x1, y1 - y2);
	}

	ctx.lineWidth = dpr;
	ctx.lineJoin = ctx.lineCap = "round";
	for (const { pen, points, lineType, window } of polylines) {
		ctx.save();
		if (window) {
			const [x1, y1] = toView(window.from);
			const [x2, y2] = toView(window.to);
			ctx.beginPath();
			ctx.rect(x1, y2, x2 - x1, y1 - y2);
			ctx.clip();
		}
		ctx.strokeStyle = colourOf(pen);
		ctx.setLineDash(
			LINE_PATTERNS[lineType?.pattern ?? -1]?.map(
				(f) => f * (lineType?.length ?? 0) * scale,
			) ?? [],
		);
		ctx.beginPath();
		for (const [i, point] of points.entries()) {
			const [x, y] = toView(point);
			if (lineType?.pattern === 0) {
				// LT0: a dot at each vertex, no line.
				ctx.moveTo(x, y);
				ctx.lineTo(x, y);
			} else if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
		ctx.restore();
	}
}
