// Pure curve tessellation shared by every renderer (Canvas now, SVG export later).
import type { Arc, Circle, Point, Wedge } from "./geometry.ts";

const RAD = Math.PI / 180;
/** Finest chord angle, used for `0`: bounds a full circle to 3600 chords. */
const MIN_CHORD_ANGLE = 0.1;

/** Points along an arc, angles in degrees (counter-clockwise from +X). */
export function arcPoints(
	[cx, cy]: Point,
	radius: number,
	startAngle: number,
	sweepAngle: number,
	chordAngle: number,
): Point[] {
	// ponytail: |sweep| > 360 overdraws the same circle; one turn covers it (dash phase aside).
	const sweep = Math.min(Math.max(sweepAngle, -360), 360);
	const step = Math.min(Math.max(chordAngle, MIN_CHORD_ANGLE), 180);
	const chords = Math.max(1, Math.round(Math.abs(sweep) / step));
	return Array.from({ length: chords + 1 }, (_, i): Point => {
		const a = (startAngle + (sweep * i) / chords) * RAD;
		return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
	});
}

/** The polyline a renderer strokes for a curve primitive; a wedge is its closed outline. */
export function tessellate(curve: Circle | Arc | Wedge): Point[] {
	if (curve.type === "circle")
		return arcPoints(curve.center, curve.radius, 0, 360, curve.chordAngle);
	const points = arcPoints(
		curve.center,
		curve.radius,
		curve.startAngle,
		curve.sweepAngle,
		curve.chordAngle,
	);
	return curve.type === "wedge"
		? [curve.center, ...points, curve.center]
		: points;
}
