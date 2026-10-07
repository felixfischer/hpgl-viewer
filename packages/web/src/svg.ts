// SVG export: the same staged geometry the Canvas draws, as deterministic text.
import {
	type Label,
	LINE_PATTERNS,
	type Page,
	type Point,
	type Primitive,
	tessellate,
} from "@hpgl-viewer/core";
import type { View } from "./render.ts";
import {
	CAP_HEIGHT,
	contentBox,
	hatchLines,
	labelCorners,
	outline,
	pageBox,
	type ScalingPoints,
} from "./stage.ts";

export interface SvgOptions {
	colourOf: (pen: number) => string;
	scalingPoints: ScalingPoints;
	/** Only `actual` matters: frame the whole sheet rather than the content. */
	view?: View;
}

const MM_PER_UNIT = 0.025;
/** Pen width in plotter units: 0.3 mm, a typical plotter pen. */
const PEN_WIDTH = 12;

/** Plotter units, rounded so the text is compact and stable. */
const num = (n: number) => String(+n.toFixed(2));
const pts = (points: Point[]) =>
	points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ");

const RAD = Math.PI / 180;
/**
 * Curves with chord angles up to the 5° default read as smooth, so they become
 * native circles and arcs; coarser ones keep their visible chords.
 */
const SMOOTH_CHORD_ANGLE = 5;
/**
 * Advance of a monospace glyph as a fraction of its em. ponytail: assumed, as
 * SVG cannot measure the font the way Canvas does; the 1.5-width cells stay exact.
 */
const MONO_ADVANCE = 0.6;

/** Text content: XML-escaped; characters XML forbids become spaces, keeping the cells. */
const xmlText = (text: string) =>
	text
		// biome-ignore lint/suspicious/noControlCharactersInRegex: these are what XML forbids
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

/**
 * Native arc commands from `startAngle` sweeping `sweepAngle` degrees, after a
 * move to (or, for wedges, a line to) the start point. A full turn is two
 * half arcs, as a single `A` cannot close on itself.
 */
function arcPath(
	[cx, cy]: Point,
	radius: number,
	startAngle: number,
	sweepAngle: number,
	to: "M" | "L",
): string {
	const r = Math.abs(radius);
	const sweep = Math.min(Math.max(sweepAngle, -360), 360);
	const at = (a: number) =>
		`${num(cx + radius * Math.cos(a * RAD))},${num(cy + radius * Math.sin(a * RAD))}`;
	const halves = Math.abs(sweep) === 360 ? 2 : 1;
	const large = Math.abs(sweep) > 180 && halves === 1 ? 1 : 0;
	let d = `${to}${at(startAngle)}`;
	for (let i = 1; i <= halves; i++)
		d += ` A${num(r)},${num(r)} 0 ${large} ${sweep > 0 ? 1 : 0} ${at(startAngle + (sweep * i) / halves)}`;
	return d;
}

/** The element for a shape's geometry, with the given presentation attributes. */
function shape(p: Exclude<Primitive, Label>, attrs: string): string {
	if ("chordAngle" in p && p.chordAngle > SMOOTH_CHORD_ANGLE) {
		// A deliberately coarse chord angle is the polygon a plotter draws.
		const points = pts(tessellate(p));
		return p.type === "arc"
			? `<polyline ${attrs} points="${points}"/>`
			: `<polygon ${attrs} points="${points}"/>`;
	}
	switch (p.type) {
		case "polyline":
			return `<polyline ${attrs} points="${pts(p.points)}"/>`;
		case "circle":
			return `<circle ${attrs} cx="${num(p.center[0])}" cy="${num(p.center[1])}" r="${num(Math.abs(p.radius))}"/>`;
		case "arc":
			return `<path ${attrs} d="${arcPath(p.center, p.radius, p.startAngle, p.sweepAngle, "M")}"/>`;
		case "wedge":
			return `<path ${attrs} d="M${pts([p.center])} ${arcPath(p.center, p.radius, p.startAngle, p.sweepAngle, "L")} Z"/>`;
		case "rectangle": {
			const [[x1, y1], [x2, y2]] = [p.from, p.to];
			return `<rect ${attrs} x="${num(Math.min(x1, x2))}" y="${num(Math.min(y1, y2))}" width="${num(Math.abs(x2 - x1))}" height="${num(Math.abs(y2 - y1))}"/>`;
		}
		case "polygon":
			return p.rings.length === 1
				? `<polygon ${attrs} points="${pts(p.rings[0] ?? [])}"/>`
				: `<path ${attrs} fill-rule="evenodd" d="${p.rings.map((r) => `M${pts(r)}Z`).join(" ")}"/>`;
	}
}

/**
 * A label as real text in its own frame: Y flipped back upright, sheared by
 * the slant, glyphs scaled to the character width and set in 1.5-width cells.
 */
function text(
	{ text, at, width, height, direction, slant }: Label,
	colour: string,
): string {
	const size = Math.abs(height) / CAP_HEIGHT;
	if (!size) return "";
	const advance = MONO_ADVANCE * size;
	const cells = [...text].map((_, i) => num(i * 1.5 * advance));
	const transform = `translate(${pts([at])}) rotate(${num(direction)}) matrix(1,0,${num(slant)},1,0,0) scale(${num(width / advance)},${-Math.sign(height)})`;
	return `<text fill="${colour}" font-family="monospace" font-size="${num(size)}" xml:space="preserve" transform="${transform}" x="${cells.join(" ")}">${xmlText(text)}</text>`;
}

/** The page as SVG text, in plotter units, framed to its content. */
export function toSvg(
	page: Page,
	{ colourOf, scalingPoints, view }: SvgOptions,
): string {
	const bounds = page.primitives.map((p) => ({
		points:
			p.type === "label" ? labelCorners(p) : (outline(p)?.rings.flat() ?? []),
		window: p.window,
	}));
	let [minX, minY, maxX, maxY] = contentBox(bounds);
	if (view?.actual || minX > maxX)
		[minX, minY, maxX, maxY] = pageBox(page, scalingPoints);
	// Half a pen of margin, so strokes along the edge are not cut in half.
	[minX, minY, maxX, maxY] = [
		minX - PEN_WIDTH / 2,
		minY - PEN_WIDTH / 2,
		maxX + PEN_WIDTH / 2,
		maxY + PEN_WIDTH / 2,
	];
	const [w, h] = [maxX - minX, maxY - minY];
	/** Pen colour as a fill for filled shapes, else as a stroke in its line type. */
	const paint = (p: Primitive) => {
		if ("filled" in p && p.filled) return `fill="${colourOf(p.pen)}"`;
		const dashes = LINE_PATTERNS[p.lineType?.pattern ?? -1]
			?.map((f) => num(f * (p.lineType?.length ?? 0)))
			.join(" ");
		return `stroke="${colourOf(p.pen)}"${dashes ? ` stroke-dasharray="${dashes}"` : ""}`;
	};

	// Clip paths, emitted inline before first use; equal windows share one.
	const clips = new Map<string, string>();
	const clip = (markup: string): [id: string, defs: string] => {
		const known = clips.get(markup);
		if (known) return [known, ""];
		const id = `c${clips.size}`;
		clips.set(markup, id);
		return [id, `<clipPath id="${id}">${markup}</clipPath>`];
	};

	const draw = (p: Primitive): string => {
		if (p.type === "label") return text(p, colourOf(p.pen));
		const filled = "filled" in p && p.filled;
		if (p.lineType?.pattern === 0 && !filled) {
			// LT0: a dot at each vertex, no line.
			const vertices = outline(p)?.rings.flat() ?? [];
			return `<path stroke="${colourOf(p.pen)}" d="${vertices.map((v) => `M${pts([v])}h0`).join(" ")}"/>`;
		}
		if (filled && "hatch" in p && p.hatch) {
			const [id, defs] = clip(shape(p, 'clip-rule="evenodd"'));
			const rings = outline(p)?.rings ?? [];
			const d = hatchLines(rings, p.hatch)
				.map(([from, to]) => `M${pts([from])}L${pts([to])}`)
				.join(" ");
			return `${defs}<path stroke="${colourOf(p.pen)}" clip-path="url(#${id})" d="${d}"/>`;
		}
		return shape(p, paint(p));
	};

	const body = page.primitives.flatMap((p) => {
		const markup = draw(p);
		if (!markup || !p.window) return markup ? [markup] : [];
		const [[x1, y1], [x2, y2]] = [p.window.from, p.window.to];
		const [id, defs] = clip(
			`<rect x="${num(x1)}" y="${num(y1)}" width="${num(x2 - x1)}" height="${num(y2 - y1)}"/>`,
		);
		return [
			...(defs ? [defs] : []),
			`<g clip-path="url(#${id})">${markup}</g>`,
		];
	});
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(minX)} ${num(-maxY)} ${num(w)} ${num(h)}" width="${num(w * MM_PER_UNIT)}mm" height="${num(h * MM_PER_UNIT)}mm">`,
		`<g transform="scale(1,-1)" fill="none" stroke-width="${PEN_WIDTH}" stroke-linecap="round" stroke-linejoin="round">`,
		...body,
		"</g>",
		"</svg>",
		"",
	].join("\n");
}
