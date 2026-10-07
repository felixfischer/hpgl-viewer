import { registry } from "./commands/index.ts";
import type { ParseResult } from "./geometry.ts";
import { createState } from "./state.ts";

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)/g;
const isLetter = (c: string) => /[A-Za-z]/.test(c);

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
			const end = text.indexOf(";", i);
			i = end < 0 ? text.length : end + 1;
			state.warnings.push({
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
