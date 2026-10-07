import {
	type Label,
	LINE_PATTERNS,
	type Page,
	type Point,
	type Window,
} from "@hpgl-viewer/core";

const MARGIN = 16; // CSS px
// Cap height of the platform font as a fraction of its em size.
const CAP_HEIGHT = 0.72;

/** The corners of a label's text box, for fitting the view. */
function labelCorners({ at, text, width, height, direction }: Label): Point[] {
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

/** Draws the page fitted to the canvas, flipping HP-GL's Y-up plotter units once. */
export function renderPage(
	canvas: HTMLCanvasElement,
	page: Page,
	colourOf: (pen: number) => string,
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
	const labels = page.primitives.flatMap((p) =>
		p.type === "label" ? [p] : [],
	);
	const outlines = [
		...polylines,
		...labels.map((l) => ({ points: labelCorners(l), window: l.window })),
	];
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const { points, window } of outlines) {
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

	const clip = (window: Window | undefined) => {
		if (!window) return;
		const [x1, y1] = toView(window.from);
		const [x2, y2] = toView(window.to);
		ctx.beginPath();
		ctx.rect(x1, y2, x2 - x1, y1 - y2);
		ctx.clip();
	};

	ctx.lineWidth = dpr;
	ctx.lineJoin = ctx.lineCap = "round";
	for (const { pen, points, lineType, window } of polylines) {
		ctx.save();
		clip(window);
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

	// Labels stay real text: the platform font, placed in the label's own frame.
	ctx.textBaseline = "alphabetic";
	for (const label of labels) {
		const { pen, text, at, width, height, direction, slant, window } = label;
		const size = (Math.abs(height) * scale) / CAP_HEIGHT;
		if (!size) continue;
		ctx.save();
		clip(window);
		ctx.fillStyle = colourOf(pen);
		ctx.font = `${size}px monospace`;
		const em = ctx.measureText("M").width || size;
		ctx.translate(...toView(at));
		ctx.rotate((-direction * Math.PI) / 180); // canvas Y points down
		ctx.transform(1, 0, -slant, 1, 0, 0); // shear: x += y·tan(slant), Y up
		ctx.scale((width * scale) / em, Math.sign(height));
		// Plotter spacing: each character sits in a 1.5-width cell.
		for (const [i, c] of [...text].entries()) ctx.fillText(c, i * 1.5 * em, 0);
		ctx.restore();
	}
}
