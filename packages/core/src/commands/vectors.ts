import type { Point } from "../geometry.ts";
import { breakStroke, moveTo, type State } from "../state.ts";
import type { Handler } from "./index.ts";

function plot(state: State, params: number[]): void {
	for (let i = 0; i + 1 < params.length; i += 2) {
		moveTo(state, [params[i], params[i + 1]] as Point);
	}
}

export const vectors: Record<string, Handler> = {
	PU(state, params) {
		state.penDown = false;
		breakStroke(state);
		plot(state, params);
	},
	PD(state, params) {
		state.penDown = true;
		plot(state, params);
	},
};
