import { breakStroke, emit, type State, strokeOf } from "../state.ts";
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
	const [w, h] = state.charSize.size;
	return [
		(w / 100) * Math.abs(state.p2[0] - state.p1[0]),
		(h / 100) * Math.abs(state.p2[1] - state.p1[1]),
	];
}

/** Lays out `label` from the pen position, emitting one Label per run of printable characters. */
function draw(state: State, label: string): void {
	breakStroke(state);
	const [width, height] = charSize(state);
	const advance = 1.5 * width;
	let at = state.at;
	let run = "";
	let runAt = at;
	const flush = () => {
		if (run && state.pen !== 0)
			emit(state, {
				type: "label",
				...strokeOf(state),
				text: run,
				at: runAt,
				width,
				height,
				direction: 0,
				slant: 0,
			});
		run = "";
	};
	for (const c of label) {
		if (c < " ") continue; // other control characters are ignored
		if (!run) runAt = at;
		run += c;
		at = [at[0] + advance, at[1]];
	}
	flush();
	state.at = at;
}

export const labelText: Record<string, TextHandler> = {
	LB(state, text, i) {
		const [label, next] = readLabel(state, text, i);
		draw(state, label);
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
		state.terminator = { char, print: mode !== undefined && Number(mode) === 0 };
		return DT_REST.lastIndex;
	},
};

export const labels: Record<string, Handler> = {};
