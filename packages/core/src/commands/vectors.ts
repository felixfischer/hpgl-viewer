import { breakStroke, moveTo, type State, target } from "../state.ts";
import type { Handler } from "./index.ts";

function plot(state: State, params: number[]): void {
	for (let i = 0; i + 1 < params.length; i += 2) {
		moveTo(state, target(state, params[i] ?? 0, params[i + 1] ?? 0));
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
	PA(state, params) {
		state.relative = false;
		plot(state, params);
	},
	PR(state, params) {
		state.relative = true;
		plot(state, params);
	},
};
