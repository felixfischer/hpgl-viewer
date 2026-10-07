import type { Point } from "../geometry.ts";
import {
	breakStroke,
	defaultLabelState,
	emit,
	rotate,
	type State,
	scaled,
	strokeOf,
} from "../state.ts";
import type { Handler } from "./index.ts";

/** Consumes a command's raw text from `i` (just after the mnemonic); returns the index after it. */
export type TextHandler = (state: State, text: string, i: number) => number;

const DT_REST = /[ \t]*(?:,[ \t]*([+-]?\d+))?[^;A-Za-z]*;?/y;

/** Reads label text from `i` up to the terminator (or EOF). */
function readLabel(state: State, text: string, i: number): [string, number] {
	const { char, print } = state.terminator;
	const end = text.indexOf(char, i);
	if (end < 0) return [text.slice(i), text.length];
	return [text.slice(i, print ? end + 1 : end), end + 1];
}

/** Character width and height in plotter units. */
function charSize(state: State): [number, number] {
	const { unit, size } = state.charSize;
	const [w, h] = size;
	if (unit === "SI") return [w * 400, h * 400]; // 400 plotter units per cm
	if (unit === "SU") return scaled(state, w, h).map(Math.abs) as Point;
	return [
		(w / 100) * Math.abs(state.p2[0] - state.p1[0]),
		(h / 100) * Math.abs(state.p2[1] - state.p1[1]),
	];
}

/** Baseline direction as a plotter-unit vector. */
function baseline(state: State): Point {
	const { unit, run } = state.direction;
	const [run1, rise] = run;
	if (unit === "DR")
		return rotate(state, [
			run1 * (state.p2[0] - state.p1[0]),
			rise * (state.p2[1] - state.p1[1]),
		]);
	return rotate(state, unit === "DU" ? scaled(state, run1, rise) : run);
}

const add = (p: Point, v: Point, k = 1): Point => [
	p[0] + k * v[0],
	p[1] + k * v[1],
];

/**
 * Offset of a line of `n` characters from the pen for label origin `lo`, given
 * the character advance `a` and the character's width `w` and height `h` vectors.
 */
function originOffset(
	lo: number,
	n: number,
	a: Point,
	w: Point,
	h: Point,
): Point {
	const col = Math.floor(((lo % 10) - 1) / 3); // 0 left, 1 centre, 2 right
	const row = ((lo % 10) - 1) % 3; // 0 below, 1 middle, 2 above
	const out = lo > 10 ? 0.5 : 0;
	// ponytail: the line spans (n − 1) advances plus one character, no trailing gap (notes §8 gap 9).
	const length = add(w, a, Math.max(n - 1, 0));
	let at = add([0, 0], length, -col / 2);
	at = add(at, h, -row / 2);
	at = add(at, w, col === 0 ? out : col === 2 ? -out : 0);
	return add(at, h, row === 0 ? out : row === 2 ? -out : 0);
}

/** Printable characters before the next CR or LF. */
function lineLength(chars: string[], from: number): number {
	let n = 0;
	for (let i = from; i < chars.length && !"\r\n".includes(chars[i] ?? ""); i++)
		if ((chars[i] ?? "") >= " ") n++;
	return n;
}

/** The label frame: character size, baseline and the advance (`a`) and line feed (`b`) vectors. */
function frame(state: State) {
	const [width, height] = charSize(state);
	const [dx, dy] = baseline(state);
	const direction = (Math.atan2(dy, dx) * 180) / Math.PI;
	const len = Math.hypot(dx, dy) || 1;
	const [ux, uy] = [dx / len, dy / len];
	const w: Point = [width * ux, width * uy];
	const h: Point = [-height * uy, height * ux];
	// Cell = 1.5w × 2h, widened by ES.
	const [gap, lineGap] = state.extraSpace;
	let a: Point = [1.5 * (1 + gap) * w[0], 1.5 * (1 + gap) * w[1]];
	let b: Point = [-2 * (1 + lineGap) * h[0], -2 * (1 + lineGap) * h[1]];
	// ponytail: DV columns run right to left (notes §8 gap 9).
	if (state.vertical) [a, b] = [b, [-a[0], -a[1]]];
	return { width, height, direction, w, h, a, b };
}

/** Where CR returns to: the last label's start, unless the pen has moved since. */
function carriagePoint(state: State): Point {
	const c = state.carriage;
	return c && c.at[0] === state.at[0] && c.at[1] === state.at[1]
		? c.from
		: state.at;
}

const EUC_JP = new TextDecoder("euc-jp");
/** Sets drawn exactly; any other is drawn as ASCII (notes §6). */
const EXACT_SETS = new Set([0, 8, 101]);

/** The glyph(s) for the printable character at `chars[i]` in the active set, and how many characters it used. */
function glyph(state: State, chars: string[], i: number): [string, number] {
	const { standard, alternate, shifted } = state.charsets;
	const set = shifted ? alternate : standard;
	const c = chars[i] ?? "";
	const code = c.charCodeAt(0);
	if (!EXACT_SETS.has(set) && !state.warnedSets.has(set)) {
		state.warnedSets.add(set);
		state.warnings.push({
			kind: "charset",
			...state.command,
			message: `Character set ${set} is drawn as ASCII`,
		});
	}
	// Set 8: JIS X 0201 katakana, 0x21–0x5F → U+FF61–U+FF9F.
	if (set === 8 && code >= 0x21 && code <= 0x5f)
		return [String.fromCharCode(code + 0xff40), 1];
	// Set 101: two-byte JIS X 0208 kanji; EUC-JP is the same bytes with the high bit set.
	const next = chars[i + 1]?.charCodeAt(0) ?? 0;
	if (set === 101 && code > 0x20 && code < 0x7f && next > 0x20 && next < 0x7f)
		return [EUC_JP.decode(new Uint8Array([code | 0x80, next | 0x80])), 2];
	return [c, 1];
}

/** Lays out `label` from the pen position, emitting one Label per run of printable characters. */
function draw(state: State, label: string, lo = state.origin): void {
	breakStroke(state);
	const { width, height, direction, w, h, a, b } = frame(state);
	// ponytail: DV ignores LO.
	if (state.vertical) lo = 1;
	// Renderers space a run's characters 1.5w apart; any other pitch is placed per character.
	const single = state.vertical || state.extraSpace[0] !== 0;
	const chars = [...label];
	const start = carriagePoint(state);
	let at = state.at;
	let run = "";
	let runAt = at;
	let offset = originOffset(lo, lineLength(chars, 0), a, w, h);
	const flush = () => {
		if (run.trim() && state.pen !== 0)
			emit(state, {
				type: "label",
				...strokeOf(state),
				text: run,
				at: runAt,
				width,
				height,
				direction,
				slant: state.slant,
			});
		run = "";
	};
	for (let i = 0; i < chars.length; i++) {
		const c = chars[i] ?? "";
		if (c >= " ") {
			if (!run) runAt = add(at, offset);
			const [g, used] = glyph(state, chars, i);
			run += g;
			i += used - 1;
			at = add(at, a);
			if (single) flush();
			continue;
		}
		if (c === "\x0e" || c === "\x0f") state.charsets.shifted = c === "\x0e";
		if (!"\b\t\n\v\r".includes(c)) continue; // other control characters are ignored
		flush();
		if (c === "\b") at = add(at, a, -1);
		else if (c === "\t") at = add(at, a, -0.5);
		else if (c === "\n") at = add(at, b);
		else if (c === "\v") at = add(at, b, -1);
		else at = carriageReturn(at, start, a);
		if (c === "\r" || c === "\n")
			offset = originOffset(lo, lineLength(chars, i + 1), a, w, h);
	}
	flush();
	// Left origins leave the pen at the next character; the others put it back.
	if (lo % 10 <= 3) state.at = at;
	state.carriage = { from: start, at: state.at };
}

/** Moves `at` back to the column of `start`, staying on its line. */
function carriageReturn(at: Point, start: Point, a: Point): Point {
	const len2 = a[0] ** 2 + a[1] ** 2;
	if (!len2) return at;
	const k = ((at[0] - start[0]) * a[0] + (at[1] - start[1]) * a[1]) / len2;
	return add(at, a, -k);
}

export const labelText: Record<string, TextHandler> = {
	LB(state, text, i) {
		const [label, next] = readLabel(state, text, i);
		draw(state, label);
		return next;
	},
	BL(state, text, i) {
		const [label, next] = readLabel(state, text, i);
		state.labelBuffer = [...label].slice(0, 150).join("");
		return next;
	},
	DT(state, text, i) {
		const char = text.charAt(i);
		if (!char || char === ";") {
			state.terminator = { char: "\x03", print: false };
			return i + 1;
		}
		DT_REST.lastIndex = i + 1;
		const mode = DT_REST.exec(text)?.[1];
		// Classic plotters don't print the terminator unless mode 0 is given explicitly (notes §DT).
		state.terminator = {
			char,
			print: mode !== undefined && Number(mode) === 0,
		};
		return DT_REST.lastIndex;
	},
};

/** A size command: 2 params set it, none restores the default, any other count is ignored. */
const sizing =
	(unit: "SI" | "SR" | "SU"): Handler =>
	(state, params) => {
		const [w = 0, h = 0] = params;
		if (params.length === 2) state.charSize = { unit, size: [w, h] };
		else if (!params.length) state.charSize = defaultLabelState().charSize;
	};

/** A direction command: 2 params (not both 0) set it, none restores 1,0, any other count is ignored. */
const directing =
	(unit: "DI" | "DR" | "DU"): Handler =>
	(state, params) => {
		const [run = 0, rise = 0] = params;
		if (params.length === 2 && (run || rise))
			state.direction = { unit, run: [run, rise] };
		else if (!params.length) state.direction = defaultLabelState().direction;
	};

export const labels: Record<string, Handler> = {
	DI: directing("DI"),
	DR: directing("DR"),
	DU: directing("DU"),
	CP(state, params) {
		if (params.length === 1) return;
		breakStroke(state);
		const { a, b } = frame(state);
		const from = carriagePoint(state);
		const [cells, lines] = params;
		state.at =
			cells === undefined || lines === undefined
				? add(carriageReturn(state.at, from, a), b)
				: add(add(state.at, a, cells), b, -lines);
		state.carriage = { from, at: state.at };
	},
	CS(state, [n = 0]) {
		state.charsets.standard = Math.trunc(n);
	},
	CA(state, [n = 0]) {
		state.charsets.alternate = Math.trunc(n);
	},
	SS(state) {
		state.charsets.shifted = false;
	},
	SA(state) {
		state.charsets.shifted = true;
	},
	PB(state) {
		draw(state, state.labelBuffer, 1);
	},
	DV(state, [n = 0]) {
		state.vertical = n === 1;
	},
	ES(state, [gap = 0, line = 0]) {
		state.extraSpace = [gap, line];
	},
	LO(state, [n = 1]) {
		if ((n >= 1 && n <= 9) || (n >= 11 && n <= 19 && n !== 15))
			state.origin = Math.trunc(n);
	},
	SL(state, [tan = 0]) {
		state.slant = tan;
	},
	SI: sizing("SI"),
	SR: sizing("SR"),
	SU: sizing("SU"),
};
