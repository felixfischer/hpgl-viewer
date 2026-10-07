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

export function parseHpgl(text: string): ParseResult {
	const state = createState();
	let i = 0;
	while (i < text.length) {
		if (!isLetter(text.charAt(i))) {
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
		handler(state, text.slice(start, i).match(NUMBER)?.map(Number) ?? []);
	}
	return { pages: state.pages, warnings: state.warnings };
}
