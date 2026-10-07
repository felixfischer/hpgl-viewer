import { breakStroke } from "../state.ts";
import type { Handler } from "./index.ts";

export const pen: Record<string, Handler> = {
	SP(state, [n = 0]) {
		state.pen = Math.trunc(n);
		breakStroke(state);
	},
};
