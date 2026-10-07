import {
	type Hatch,
	LINE_PATTERNS,
	type Page,
	type Point,
	type Primitive,
} from "@hpgl-viewer/core";

const MARGIN = 16; // CSS px

/** Points along an arc, one chord per `chordAngle` degrees. */
// ponytail: local stand-in; swap for ticket #4's shared tessellator once merged.
function arcPoints(
	[cx, cy]: Point,
	radius: number,
	start: number,
	sweep: number,
	chordAngle: number,
): Point[] {
	const n = Math.max(1, Math.ceil(Math.abs(sweep) / Math.max(chordAngle, 1)));
	return Array.from({ length: n + 1 }, (_, i) => {
		const a = ((start + (sweep * i) / n) * Math.PI) / 180;
		return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
	});
}

/** The rings a primitive draws, in plotter units; `null` for types not rendered yet. */
function outline(p: Primitive): { rings: Point[][]; closed: boolean } | null {
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
		case "wedge": {
			const arc = arcPoints(
				p.center,
				p.radius,
				p.startAngle,
				p.sweepAngle,
				p.chordAngle,
			);
			return { rings: [[p.center, ...arc]], closed: true };
		}
		default:
			return null;
	}
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

	const shapes = page.primitives.flatMap((p) => {
		const o = outline(p);
		return o ? [{ ...p, ...o }] : [];
	});
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const { rings, window } of shapes) {
		for (let [x, y] of rings.flat()) {
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

	/** Strokes parallel lines `spacing` apart across the rings' bounds, anchored at the origin. */
	const hatch = (rings: Point[][], { spacing, angle, cross }: Hatch) => {
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
			ctx.beginPath();
			for (let k = Math.ceil(u1 / spacing); k * spacing <= u2; k++) {
				const [px, py] = [nx * k * spacing, ny * k * spacing];
				ctx.moveTo(...toView([px + dx * t1, py + dy * t1]));
				ctx.lineTo(...toView([px + dx * t2, py + dy * t2]));
			}
			ctx.stroke();
		}
	};

	ctx.lineWidth = dpr;
	ctx.lineJoin = ctx.lineCap = "round";
	for (const shape of shapes) {
		const { pen, rings, closed, lineType, window } = shape;
		ctx.save();
		if (window) {
			const [x1, y1] = toView(window.from);
			const [x2, y2] = toView(window.to);
			ctx.beginPath();
			ctx.rect(x1, y2, x2 - x1, y1 - y2);
			ctx.clip();
		}
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
}
