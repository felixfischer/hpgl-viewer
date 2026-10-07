// SVG export: the same staged geometry the Canvas draws, as deterministic text.
import type { Page, Point, Primitive } from "@hpgl-viewer/core";
import {
	CAP_HEIGHT,
	contentBox,
	labelCorners,
	outline,
	pageBox,
	type ScalingPoints,
} from "./stage.ts";

export interface SvgOptions {
	colourOf: (pen: number) => string;
	scalingPoints: ScalingPoints;
}

/** Plotter units, rounded so the text is compact and stable. */
const num = (n: number) => String(+n.toFixed(2));
const pts = (points: Point[]) =>
	points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ");

const RAD = Math.PI / 180;
/**
 * Advance of a monospace glyph as a fraction of its em. ponytail: assumed, as
 * SVG cannot measure the font the way Canvas does; the 1.5-width cells stay exact.
 */
const MONO_ADVANCE = 0.6;

/** Text content: XML-escaped; characters XML forbids become spaces, keeping the cells. */
const xmlText = (text: string) =>
	text
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

/** The page as SVG text, in plotter units, framed to its content. */
export function toSvg(
	page: Page,
	{ colourOf, scalingPoints }: SvgOptions,
): string {
	const bounds = page.primitives.map((p) => ({
		points:
			p.type === "label" ? labelCorners(p) : (outline(p)?.rings.flat() ?? []),
		window: p.window,
	}));
	let [minX, minY, maxX, maxY] = contentBox(bounds);
	if (minX > maxX) [minX, minY, maxX, maxY] = pageBox(page, scalingPoints);
	/** Pen colour as a fill for filled shapes, else as a stroke. */
	const paint = (p: Primitive) =>
		"filled" in p && p.filled
			? `fill="${colourOf(p.pen)}"`
			: `stroke="${colourOf(p.pen)}"`;
	const body = page.primitives.map((p) => {
		switch (p.type) {
			case "polyline":
				return `<polyline stroke="${colourOf(p.pen)}" points="${pts(p.points)}"/>`;
			case "circle":
				return `<circle stroke="${colourOf(p.pen)}" cx="${num(p.center[0])}" cy="${num(p.center[1])}" r="${num(Math.abs(p.radius))}"/>`;
			case "arc":
				return `<path stroke="${colourOf(p.pen)}" d="${arcPath(p.center, p.radius, p.startAngle, p.sweepAngle, "M")}"/>`;
			case "wedge":
				return `<path ${paint(p)} d="M${pts([p.center])} ${arcPath(p.center, p.radius, p.startAngle, p.sweepAngle, "L")} Z"/>`;
			case "rectangle": {
				const [[x1, y1], [x2, y2]] = [p.from, p.to];
				return `<rect ${paint(p)} x="${num(Math.min(x1, x2))}" y="${num(Math.min(y1, y2))}" width="${num(Math.abs(x2 - x1))}" height="${num(Math.abs(y2 - y1))}"/>`;
			}
			case "polygon":
				return p.rings.length === 1
					? `<polygon ${paint(p)} points="${pts(p.rings[0] ?? [])}"/>`
					: `<path ${paint(p)} fill-rule="evenodd" d="${p.rings.map((r) => `M${pts(r)}Z`).join(" ")}"/>`;
			case "label": {
				const { text, at, width, height, direction, slant } = p;
				const size = Math.abs(height) / CAP_HEIGHT;
				if (!size) return "";
				const advance = MONO_ADVANCE * size;
				const cells = [...text].map((_, i) => num(i * 1.5 * advance));
				const transform = `translate(${pts([at])}) rotate(${num(direction)}) matrix(1,0,${num(slant)},1,0,0) scale(${num(width / advance)},${-Math.sign(height)})`;
				return `<text fill="${colourOf(p.pen)}" font-family="monospace" font-size="${num(size)}" xml:space="preserve" transform="${transform}" x="${cells.join(" ")}">${xmlText(text)}</text>`;
			}
			default:
				return "";
		}
	});
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(minX)} ${num(-maxY)} ${num(maxX - minX)} ${num(maxY - minY)}">`,
		'<g transform="scale(1,-1)" fill="none">',
		...body,
		"</g>",
		"</svg>",
		"",
	].join("\n");
}
