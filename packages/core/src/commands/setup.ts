import { breakStroke, defaultScalingPoints, rotate } from "../state.ts";
import type { Handler } from "./index.ts";

export const setup: Record<string, Handler> = {
	IN(state) {
		state.penDown = false;
		state.relative = false;
		state.lineType = null;
		Object.assign(state, defaultScalingPoints());
		state.scale = null;
		state.rotation = 0;
		state.window = null;
		breakStroke(state);
	},
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
};
