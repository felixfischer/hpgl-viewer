import { LINE_PATTERNS, type Page, type Point } from "@hpgl-viewer/core";

// ADR-0004 default palette; ponytail: cycles past pen 8, golden-angle hues come with the pen UI.
const PALETTE = [
	"#1a1a1a",
	"#e6194b",
	"#4363d8",
	"#3cb44b",
	"#f58231",
	"#911eb4",
	"#0aa2c0",
	"#9a6324",
];
const penColour = (pen: number) =>
	PALETTE[(pen - 1) % PALETTE.length] ?? "#000";
const MARGIN = 16; // CSS px

/** Draws the page fitted to the canvas, flipping HP-GL's Y-up plotter units once. */
export function renderPage(canvas: HTMLCanvasElement, page: Page): void {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.round(canvas.clientWidth * dpr);
	canvas.height = Math.round(canvas.clientHeight * dpr);
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	const polylines = page.primitives.flatMap((p) =>
		p.type === "polyline" ? [p] : [],
	);
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const { points, window } of polylines) {
		for (let [x, y] of points) {
			// Only what survives the input window counts towards the fit.
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
	if (minX > maxX) return;

	const margin = MARGIN * dpr;
	const scale = Math.min(
		(canvas.width - 2 * margin) / (maxX - minX || 1),
		(canvas.height - 2 * margin) / (maxY - minY || 1),
	);
	const offsetX = (canvas.width - (maxX - minX) * scale) / 2;
	const offsetY = (canvas.height - (maxY - minY) * scale) / 2;
	const toView = ([x, y]: Point): Point => [
		offsetX + (x - minX) * scale,
		canvas.height - (offsetY + (y - minY) * scale),
	];

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
		ctx.strokeStyle = penColour(pen);
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
