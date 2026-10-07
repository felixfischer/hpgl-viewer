import {
	type Hatch,
	LINE_PATTERNS,
	type Page,
	type Point,
	type Window,
} from "@hpgl-viewer/core";
import {
	type Box,
	CAP_HEIGHT,
	contentBox,
	hatchLines,
	labelCorners,
	outline,
	pageBox,
	type ScalingPoints,
} from "./stage.ts";

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

	const shapes = page.primitives.flatMap((p) => {
		const o = outline(p);
		return o ? [{ ...p, ...o }] : [];
	});
	const labels = page.primitives.flatMap((p) =>
		p.type === "label" ? [p] : [],
	);
	const bounds = [
		...shapes.map((s) => ({ points: s.rings.flat(), window: s.window })),
		...labels.map((l) => ({ points: labelCorners(l), window: l.window })),
	];
	const sheet = pageBox(page, scalingPoints);
	let content = contentBox(bounds);
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

	const clip = (window: Window | undefined) => {
		if (!window) return;
		const [x1, y1] = toView(window.from);
		const [x2, y2] = toView(window.to);
		ctx.beginPath();
		ctx.rect(x1, y2, x2 - x1, y1 - y2);
		ctx.clip();
	};

	/** Strokes the fill's hatch lines. */
	const hatch = (rings: Point[][], fill: Hatch) => {
		ctx.beginPath();
		for (const [from, to] of hatchLines(rings, fill)) {
			ctx.moveTo(...toView(from));
			ctx.lineTo(...toView(to));
		}
		ctx.stroke();
	};

	ctx.lineWidth = dpr;
	ctx.lineJoin = ctx.lineCap = "round";
	for (const shape of shapes) {
		const { pen, rings, closed, lineType, window } = shape;
		ctx.save();
		clip(window);
		ctx.strokeStyle = ctx.fillStyle = colourOf(pen);
		ctx.beginPath();
		const dots =
			lineType?.pattern === 0 && !("filled" in shape && shape.filled);
		for (const ring of rings) {
			for (const [i, point] of ring.entries()) {
				const [x, y] = toView(point);
				if (dots) {
					// LT0: a dot at each vertex, no line.
					ctx.moveTo(x, y);
					ctx.lineTo(x, y);
				} else if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			if (closed && !dots) ctx.closePath();
		}
		if ("filled" in shape && shape.filled) {
			// Hatches finer than a device pixel would read as solid anyway.
			if (shape.hatch && shape.hatch.spacing * scale >= 1) {
				ctx.clip("evenodd");
				hatch(rings, shape.hatch);
			} else ctx.fill("evenodd");
		} else {
			ctx.setLineDash(
				LINE_PATTERNS[lineType?.pattern ?? -1]?.map(
					(f) => f * (lineType?.length ?? 0) * scale,
				) ?? [],
			);
			ctx.stroke();
		}
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
