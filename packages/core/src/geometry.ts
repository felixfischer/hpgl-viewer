// The renderer-neutral geometry stream (ADR-0005). All coordinates are in
// plotter units (0.025 mm), bottom-left origin, Y up — renderers flip once.

export type Point = [x: number, y: number];

/** `LT` pattern number and length of one pattern repeat in plotter units; `null` = solid. */
export type LineType = { pattern: number; length: number } | null;

/**
 * Pen-down/pen-up fractions of one pattern repeat for `LT` 1–6, pen-down first.
 * Zero-length dashes are dots. Pattern 0 has no dashes: a dot at each vertex.
 */
export const LINE_PATTERNS: Readonly<Record<number, readonly number[]>> = {
	1: [0, 1],
	2: [0.5, 0.5],
	3: [0.7, 0.3],
	4: [0.8, 0.1, 0, 0.1],
	5: [0.7, 0.1, 0.1, 0.1],
	6: [0.5, 0.1, 0.1, 0.1, 0.1, 0.1],
};

/** Axis-aligned rectangle in plotter units, `from` ≤ `to` on both axes. */
export interface Window {
	from: Point;
	to: Point;
}

interface Stroke {
	pen: number;
	lineType: LineType;
	/** `IW` input window in force when drawn; renderers clip to it. Absent = unclipped. */
	window?: Window;
}

export interface Polyline extends Stroke {
	type: "polyline";
	points: Point[];
}

export interface Circle extends Stroke {
	type: "circle";
	center: Point;
	radius: number;
	/** Chord angle in degrees (`CT`/`CI` tolerance) renderers tessellate with. */
	chordAngle: number;
}

export interface Arc extends Stroke {
	type: "arc";
	center: Point;
	radius: number;
	/** Degrees, counter-clockwise from +X. */
	startAngle: number;
	/** Degrees; positive is counter-clockwise. */
	sweepAngle: number;
	chordAngle: number;
}

export interface Wedge extends Stroke {
	type: "wedge";
	center: Point;
	radius: number;
	startAngle: number;
	sweepAngle: number;
	chordAngle: number;
	filled: boolean;
}

export interface Rectangle extends Stroke {
	type: "rectangle";
	from: Point;
	to: Point;
	filled: boolean;
}

export interface Polygon extends Stroke {
	type: "polygon";
	/** Closed rings; even-odd fill. */
	rings: Point[][];
	filled: boolean;
}

export interface Label extends Stroke {
	type: "label";
	text: string;
	at: Point;
	/** Character cell size in plotter units. */
	width: number;
	height: number;
	/** Baseline direction in degrees, counter-clockwise from +X. */
	direction: number;
	/** Slant as tan(angle). */
	slant: number;
}

export type Primitive =
	| Polyline
	| Circle
	| Arc
	| Wedge
	| Rectangle
	| Polygon
	| Label;

export interface Page {
	primitives: Primitive[];
}

/** A non-fatal problem found while parsing; `offset` is the index into the input. */
export interface Warning {
	mnemonic: string;
	offset: number;
	message: string;
}

export interface ParseResult {
	pages: Page[];
	warnings: Warning[];
}
