import { breakStroke, type State } from "../state.ts";
import type { Handler } from "./index.ts";

// Landscape paper in plotter units (40 per mm).
const A3 = { width: 16800, height: 11880 };
const A4 = { width: 11880, height: 8400 };

/** Ends the current page; a page with nothing drawn on it is reused, not left blank. */
function advance(state: State): void {
	breakStroke(state);
	const current = state.pages.at(-1);
	if (!current?.primitives.length) return;
	state.pages.push(
		current.size ? { primitives: [], size: current.size } : { primitives: [] },
	);
}

export const page: Record<string, Handler> = {
	PG: advance,
	AF: advance,
	NR() {}, // pauses the device; nothing to draw
	/** `PS n` picks a paper code; `PS length[,width]` gives plotter units. */
	PS(state, [n = 4, width]) {
		const current = state.pages.at(-1);
		if (!current) return;
		if (width !== undefined || n > 127) {
			current.size = {
				width: n,
				height: width ?? current.size?.height ?? A4.height,
			};
		} else {
			current.size = n < 4 ? A3 : A4;
		}
	},
};
