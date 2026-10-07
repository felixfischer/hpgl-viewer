import type {
	LineType,
	Page,
	Point,
	Polyline,
	Primitive,
	Warning,
} from "./geometry.ts";

/** The one mutable plotter state every command handler reads and writes. */
export interface State {
	/** Current pen position in plotter units. */
	at: Point;
	pen: number;
	penDown: boolean;
	lineType: LineType;
	pages: Page[];
	/** The polyline pen-down moves are currently extending, if any. */
	stroke: Polyline | null;
	warnings: Warning[];
}

export function createState(): State {
	return {
		at: [0, 0],
		// ponytail: pen 1 until SP, so files that never select a pen still draw.
		pen: 1,
		penDown: false,
		lineType: null,
		pages: [{ primitives: [] }],
		stroke: null,
		warnings: [],
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
				pen: state.pen,
				lineType: state.lineType,
				points: [state.at],
			};
			emit(state, state.stroke);
		}
		state.stroke.points.push(to);
	}
	state.at = to;
}
