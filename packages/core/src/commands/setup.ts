import {
	breakStroke,
	defaultFill,
	defaultLabelState,
	defaultScalingPoints,
	rotate,
	type State,
} from "../state.ts";
import type { Handler } from "./index.ts";

/**
 * The modal defaults both `IN` and `DF` restore. Neither touches P1/P2, the pen,
 * its position or `RO`, so this leaves those alone (reference notes §IN/§DF).
 */
function resetModal(state: State): void {
	state.relative = false; // PA
	state.lineType = null; // LT solid
	state.scale = null; // SC off
	state.window = null; // IW = hard clip
	state.chordHeight = false; // CT0
	Object.assign(state, defaultFill());
	Object.assign(state, defaultLabelState());
	state.polygon = [];
	state.polygonMode = false;
	state.labelBuffer = "";
	state.carriage = null;
	breakStroke(state);
}

export const setup: Record<string, Handler> = {
	IN(state) {
		resetModal(state);
		state.penDown = false; // PU
		Object.assign(state, defaultScalingPoints());
		state.rotation = 0; // RO0
	},
	DF: resetModal,
	IP(state, params) {
		const [x1, y1, x2, y2] = params.map(Math.trunc);
		if (x1 === undefined || y1 === undefined) {
			Object.assign(state, defaultScalingPoints());
		} else if (x2 === undefined || y2 === undefined) {
			// P1 moves; P2 follows so the span is preserved.
			const [dx, dy] = [x1 - state.p1[0], y1 - state.p1[1]];
			state.p1 = [x1, y1];
			state.p2 = [state.p2[0] + dx, state.p2[1] + dy];
		} else {
			state.p1 = [x1, y1];
			state.p2 = [x2, y2];
		}
	},
	IW(state, params) {
		const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = params;
		breakStroke(state);
		if (params.length < 4) {
			state.window = null;
			return;
		}
		const [ax, ay] = rotate(state, [x1, y1]);
		const [bx, by] = rotate(state, [x2, y2]);
		state.window = {
			from: [Math.min(ax, bx), Math.min(ay, by)],
			to: [Math.max(ax, bx), Math.max(ay, by)],
		};
	},
	RO(state, [angle = 0]) {
		if (angle === 0 || angle === 90) state.rotation = angle;
	},
	SC(state, params) {
		const [xmin = 0, xmax = 0, ymin = 0, ymax = 0] = params;
		if (params.length < 4) state.scale = null;
		else if (xmin !== xmax && ymin !== ymax)
			state.scale = [xmin, xmax, ymin, ymax];
	},
	// Pen speed: no visual effect.
	VS() {},
};
