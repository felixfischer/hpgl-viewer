import type {
	LineType,
	Page,
	Point,
	Polyline,
	Primitive,
	Warning,
	Window,
} from "./geometry.ts";

/** The one mutable plotter state every command handler reads and writes. */
export interface State {
	/** Current pen position in plotter units. */
	at: Point;
	pen: number;
	penDown: boolean;
	/** `PR` mode: PU/PD/PA/PR coordinates are offsets from the pen position. */
	relative: boolean;
	/** `LT` setting; `percent` is resolved against the P1–P2 diagonal when a primitive is drawn. */
	lineType: { pattern: number; percent: number } | null;
	/** Scaling points P1 and P2, in plotter units. */
	p1: Point;
	p2: Point;
	/** `SC` user rectangle `[xmin, xmax, ymin, ymax]` mapped onto P1..P2; `null` = plotter units. */
	scale: [number, number, number, number] | null;
	/** `RO` angle; 90 turns the coordinate system counter-clockwise about the plotter origin (ADR-0006). */
	rotation: 0 | 90;
	/** `IW` clip window in plotter units; `null` = whole page. */
	window: Window | null;
	pages: Page[];
	/** The polyline pen-down moves are currently extending, if any. */
	stroke: Polyline | null;
	warnings: Warning[];
	/** Label terminator set by `DT`; `print` when `DT c,0` asks for it to be drawn. */
	terminator: { char: string; print: boolean };
	/** `SI` (cm), `SR` (% of the P1–P2 span) or `SU` (user units); resolved when a label is drawn. */
	charSize: { unit: "SI" | "SR" | "SU"; size: Point };
}

export function createState(): State {
	return {
		at: [0, 0],
		// ponytail: pen 1 until SP, so files that never select a pen still draw.
		pen: 1,
		penDown: false,
		relative: false,
		lineType: null,
		...defaultScalingPoints(),
		scale: null,
		rotation: 0,
		window: null,
		pages: [{ primitives: [] }],
		stroke: null,
		warnings: [],
		...defaultLabelState(),
	};
}

/** Label settings `IN` restores. */
export const defaultLabelState = () => ({
	terminator: { char: "\x03", print: false },
	charSize: { unit: "SR" as const, size: [0.75, 1.5] as Point },
});

/** A3 landscape P1/P2 (HP 7475A); the viewer's default page. */
export const defaultScalingPoints = (): { p1: Point; p2: Point } => ({
	p1: [170, 602],
	p2: [15370, 10602],
});

/** Scales a user-unit offset to plotter units. */
export function scaled(state: State, dx: number, dy: number): Point {
	if (!state.scale) return [dx, dy];
	const [xmin, xmax, ymin, ymax] = state.scale;
	return [
		(dx * (state.p2[0] - state.p1[0])) / (xmax - xmin),
		(dy * (state.p2[1] - state.p1[1])) / (ymax - ymin),
	];
}

// `0 - y` rather than `-y` so a zero stays +0 in the stream.
export const rotate = (state: State, [x, y]: Point): Point =>
	state.rotation ? [0 - y, x] : [x, y];

/** Converts an absolute user-space coordinate pair to plotter units. */
export function toPlotter(state: State, x: number, y: number): Point {
	if (!state.scale) return rotate(state, [x, y]);
	const [xmin, , ymin] = state.scale;
	const [dx, dy] = scaled(state, x - xmin, y - ymin);
	return rotate(state, [state.p1[0] + dx, state.p1[1] + dy]);
}

/** Resolves a PA/PR coordinate pair (per the current mode) to a plotter-unit target. */
export function target(state: State, x: number, y: number): Point {
	if (!state.relative) return toPlotter(state, x, y);
	const [dx, dy] = rotate(state, scaled(state, x, y));
	return [state.at[0] + dx, state.at[1] + dy];
}

/** The pen, line type and window every new primitive is tagged with. */
export function strokeOf(state: State): {
	pen: number;
	lineType: LineType;
	window?: Window;
} {
	return {
		pen: state.pen,
		lineType: state.lineType && {
			pattern: state.lineType.pattern,
			length:
				(state.lineType.percent / 100) *
				Math.hypot(state.p2[0] - state.p1[0], state.p2[1] - state.p1[1]),
		},
		...(state.window && { window: state.window }),
	};
}

export function emit(state: State, primitive: Primitive): void {
	state.pages[state.pages.length - 1]?.primitives.push(primitive);
}

/** Ends the polyline in progress; the next pen-down move starts a new one. */
export function breakStroke(state: State): void {
	state.stroke = null;
}

/** Moves the pen to `to`, drawing a segment when the pen is down. */
export function moveTo(state: State, to: Point): void {
	if (state.penDown && state.pen !== 0) {
		if (!state.stroke) {
			state.stroke = {
				type: "polyline",
				...strokeOf(state),
				points: [state.at],
			};
			emit(state, state.stroke);
		}
		state.stroke.points.push(to);
	}
	state.at = to;
}
