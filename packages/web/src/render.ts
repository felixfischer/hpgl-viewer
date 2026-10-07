import type { Page, Point } from "@hpgl-viewer/core";

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
	for (const { points } of polylines) {
		for (const [x, y] of points) {
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
	for (const { pen, points } of polylines) {
		ctx.strokeStyle = penColour(pen);
		ctx.beginPath();
		for (const [i, point] of points.entries()) {
			const [x, y] = toView(point);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}
}
