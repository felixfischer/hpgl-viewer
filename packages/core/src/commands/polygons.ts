import { breakStroke, closeRing, emit, type State, strokeOf } from "../state.ts";
import type { Handler } from "./index.ts";

/** Draws the polygon buffer: `FP` fills it, `EP` edges it. */
function drawPolygon(state: State, filled: boolean): void {
	const rings = state.polygon.filter((r) => r.length > 1).map((r) => [...r]);
	if (!rings.length || state.pen === 0) return;
	breakStroke(state);
	emit(state, { type: "polygon", ...strokeOf(state), rings, filled });
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
};
