import { readFileSync } from "node:fs";

/** The text of a repository fixture, as the native layer would hand it over. */
export function fixture(name: string) {
	return readFileSync(
		new URL(`../../../hpgl/${name}`, import.meta.url).pathname,
		"utf8",
	);
}

/** Counts canvas pixels painted in (roughly) the given `#rrggbb` colour. */
export function inkedIn(el: HTMLCanvasElement, hex: string) {
	const want = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
	const ctx = el.getContext("2d");
	if (!ctx) return 0;
	const { data } = ctx.getImageData(0, 0, el.width, el.height);
	let count = 0;
	for (let i = 0; i < data.length; i += 4) {
		const close = want.every((v, c) => Math.abs((data[i + c] ?? 0) - v) < 24);
		if ((data[i + 3] ?? 0) > 0 && close) count++;
	}
	return count;
}
