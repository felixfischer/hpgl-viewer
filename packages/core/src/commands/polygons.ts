import type { Point } from "../geometry.ts";
import {
	breakStroke,
	closeRing,
	emit,
	offset,
	type State,
	strokeOf,
	toPlotter,
} from "../state.ts";
import type { Handler } from "./index.ts";

/** Draws the polygon buffer: `FP` fills it, `EP` edges it. */
function drawPolygon(state: State, filled: boolean): void {
	const rings = state.polygon.filter((r) => r.length > 1).map((r) => [...r]);
	if (!rings.length || state.pen === 0) return;
	breakStroke(state);
	emit(state, { type: "polygon", ...strokeOf(state), rings, filled });
}

/** `RA`/`RR`/`EA`/`ER`: a rectangle from the pen position to `corner`; the pen stays put. */
function rectangle(
	corner: (state: State, x: number, y: number) => Point,
	filled: boolean,
): Handler {
	return (state, [x, y]) => {
		if (x === undefined || y === undefined || state.pen === 0) return;
		breakStroke(state);
		emit(state, {
			type: "rectangle",
			...strokeOf(state),
			from: state.at,
			to: corner(state, x, y),
			filled,
		});
	};
}

export const polygons: Record<string, Handler> = {
	PM(state, [n = 0]) {
		breakStroke(state);
		if (n === 0) {
			state.polygon = [[]];
			state.polygonMode = true;
		} else if (state.polygonMode) {
			closeRing(state);
			if (n === 2) state.polygonMode = false;
		}
	},
	FP: (state) => drawPolygon(state, true),
	EP: (state) => drawPolygon(state, false),
	RA: rectangle(toPlotter, true),
	RR: rectangle(offset, true),
	EA: rectangle(toPlotter, false),
	ER: rectangle(offset, false),
};
