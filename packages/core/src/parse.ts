import { registry } from "./commands/index.ts";
import type { ParseResult } from "./geometry.ts";
import { createState, type State } from "./state.ts";

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)/g;
const isLetter = (c: string) => /[A-Za-z]/.test(c);

// Reference notes §4: mnemonics that exist only in HP-GL/2 (or the 7550's DL).
const HPGL2_ONLY = new Set(
	"BP PE PW WU LA UL PC NP CR TR MC PP RF FR MT QL ST EC MG SD AD SB FI FN SV CF TD IR AC AT RT BR BZ RP LM CO DL".split(
		" ",
	),
);

// Classic device-control: ESC . letter, optional numeric params up to ':'.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the point.
const DEVICE_CONTROL = /\x1b\.[@-~](?:[\d;]*:)?/y;
// PCL/PJL/RTL: ESC, then anything up to the first terminating capital, e.g. ESC%-1B.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the point.
const PCL_ESCAPE = /\x1b[^@-^\x1b]{0,32}[@-^]/y;

/** Records, once per file, that the input looks like HP-GL/2. */
function flagHpgl2(state: State, mnemonic: string, offset: number): void {
	if (state.warnings.some((w) => w.kind === "dialect")) return;
	state.warnings.push({
		kind: "dialect",
		mnemonic,
		offset,
		message: "HP-GL/2 is not supported; only classic HP-GL commands are drawn",
	});
}

/** Consumes the escape sequence at `i`, returning the index after it. */
function skipEscape(state: State, text: string, i: number): number {
	DEVICE_CONTROL.lastIndex = i;
	if (DEVICE_CONTROL.test(text)) return DEVICE_CONTROL.lastIndex;
	flagHpgl2(state, "ESC", i);
	PCL_ESCAPE.lastIndex = i;
	const pcl = PCL_ESCAPE.exec(text);
	if (!pcl) return i + 1;
	// RTL raster data (ESC*b<n>W) carries n bytes of binary payload; skip it.
	// ponytail: counts UTF-16 chars, not bytes; decode files as latin1 if raster ever matters.
	const payload = /(\d+)W$/.exec(pcl[0]);
	return PCL_ESCAPE.lastIndex + Number(payload?.[1] ?? 0);
}

export function parseHpgl(text: string): ParseResult {
	const state = createState();
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\x1b") {
			i = skipEscape(state, text, i);
			continue;
		}
		if (!isLetter(text.charAt(i))) {
			// NUL or non-ASCII outside a command: raster or encoded data (reference §4).
			const code = text.charCodeAt(i);
			if (code === 0 || code >= 0x80) flagHpgl2(state, "", i);
			i++; // separators, terminators, whitespace, stray bytes
			continue;
		}
		const offset = i;
		const mnemonic = text.slice(i, i + 2).toUpperCase();
		i += 2;
		const handler = registry[mnemonic];
		if (!handler) {
			if (HPGL2_ONLY.has(mnemonic)) flagHpgl2(state, mnemonic, offset);
			const end = text.indexOf(";", i);
			i = end < 0 ? text.length : end + 1;
			state.warnings.push({
				kind: "skipped",
				mnemonic,
				offset,
				message: `Unsupported command ${mnemonic} skipped`,
			});
			continue;
		}
		// Parameters run to the terminator or the next mnemonic.
		const start = i;
		while (i < text.length && text[i] !== ";" && !isLetter(text.charAt(i))) i++;
		const params = text.slice(start, i).match(NUMBER)?.map(Number) ?? [];
		handler(state, params.filter(Number.isFinite));
	}
	// A trailing PG leaves an empty page behind; drop it.
	if (state.pages.length > 1 && !state.pages.at(-1)?.primitives.length) {
		state.pages.pop();
	}
	return { pages: state.pages, warnings: state.warnings };
}
