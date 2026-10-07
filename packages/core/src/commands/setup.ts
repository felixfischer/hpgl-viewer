import { breakStroke } from "../state.ts";
import type { Handler } from "./index.ts";

export const setup: Record<string, Handler> = {
	IN(state) {
		state.penDown = false;
		state.lineType = null;
		breakStroke(state);
	},
};
