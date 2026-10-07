import type { Point } from "../geometry.ts";
import {
	breakStroke,
	closeRing,
	emit,
	type State,
	scaled,
	strokeOf,
	toPlotter,
	toPlotterOffset,
	toUserOffset,
} from "../state.ts";
import { arcPoints, chordAngle } from "../tessellate.ts";
import type { Handler } from "./index.ts";

const DEG = 180 / Math.PI;

/**
 * Draws (pen down) or moves (pen up) along an arc about `center` (plotter units)
 * from the pen position, leaving the pen at the arc end. The arc is computed in
 * user units, so non-uniform scaling turns it into an elliptical polyline.
 */
function arc(state: State, center: Point, sweep: number, res?: number): void {
	const [cx, cy] = center;
	const [px, py] = [state.at[0] - cx, state.at[1] - cy];
	const [ux, uy] = toUserOffset(state, [px, py]);
	const r = Math.hypot(ux, uy);
	const start = Math.atan2(uy, ux) * DEG;
	const angle = chordAngle(res, r, state.chordHeight);
	const toPlot = ([x, y]: Point): Point => {
		const [dx, dy] = toPlotterOffset(state, x, y);
		return [cx + dx, cy + dy];
	};
	if (state.penDown && state.pen !== 0) {
		breakStroke(state);
		const [sx, sy] = scaled(state, 1, 1);
		if (Math.abs(Math.abs(sx) - Math.abs(sy)) <= 1e-9 * Math.abs(sx)) {
			emit(state, {
				type: "arc",
				...strokeOf(state),
				center,
				radius: Math.hypot(px, py),
				startAngle: Math.atan2(py, px) * DEG,
				// A mirrored scale (SC xmin > xmax, say) reverses the sweep.
				sweepAngle: sx * sy < 0 ? -sweep : sweep,
				chordAngle: angle,
			});
		} else {
			emit(state, {
				type: "polyline",
				...strokeOf(state),
				points: arcPoints([0, 0], r, start, sweep, angle).map(toPlot),
			});
		}
	}
	const end = (start + sweep) / DEG;
	state.at = toPlot([r * Math.cos(end), r * Math.sin(end)]);
}

export const arcs: Record<string, Handler> = {
	CT(state, [n = 0]) {
		state.chordHeight = n === 1;
	},
	CI(state, [r = 0, res]) {
		if (state.pen === 0) return;
		breakStroke(state);
		const [dx, dy] = toPlotterOffset(state, r, 0);
		const radius = Math.hypot(dx, dy);
		const angle = chordAngle(res, r, state.chordHeight);
		if (state.polygonMode) {
			// Inside PM a circle is its own closed subpolygon (reference notes §PM).
			if (state.polygon.at(-1)?.length) state.polygon.push([]);
			state.polygon.at(-1)?.push(...arcPoints(state.at, radius, 0, 360, angle));
			closeRing(state);
			return;
		}
		emit(state, {
			type: "circle",
			...strokeOf(state),
			center: state.at,
			radius,
			chordAngle: angle,
		});
	},
	AA(state, [xc = 0, yc = 0, sweep = 0, res]) {
		arc(state, toPlotter(state, xc, yc), sweep, res);
	},
	AR(state, [dx = 0, dy = 0, sweep = 0, res]) {
		const [ox, oy] = toPlotterOffset(state, dx, dy);
		arc(state, [state.at[0] + ox, state.at[1] + oy], sweep, res);
	},
};
