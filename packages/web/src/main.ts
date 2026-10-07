import {
	type Page,
	type ParseResult,
	penColour,
	usedPens,
} from "@hpgl-viewer/core";
import { renderPage } from "./render.ts";

// Elements from index.html, which ships with this script.
const canvas = document.querySelector("#plot") as HTMLCanvasElement;
const picker = document.querySelector("#file") as HTMLInputElement;
const status = document.querySelector("#status") as HTMLOutputElement;
const legend = document.querySelector("#legend") as HTMLUListElement;
const resetColours = document.querySelector(
	"#reset-colours",
) as HTMLButtonElement;

const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
	type: "module",
});
let page: Page | undefined;
let fileName = "";
/** User overrides of the default pen colours; kept across files. */
const colours = new Map<number, string>();
const colourOf = (pen: number) => colours.get(pen) ?? penColour(pen);
const render = () => page && renderPage(canvas, page, colourOf);

function showLegend(pens: number[]) {
	legend.replaceChildren(
		...pens.map((pen) => {
			const item = document.createElement("li");
			const label = document.createElement("label");
			const input = document.createElement("input");
			input.type = "color";
			input.value = colourOf(pen);
			input.dataset.pen = String(pen);
			input.addEventListener("input", () => {
				colours.set(pen, input.value);
				render();
			});
			label.append(input, ` Pen ${pen}`);
			item.append(label);
			return item;
		}),
	);
	(legend.parentElement as HTMLElement).hidden = pens.length === 0;
}

resetColours.addEventListener("click", () => {
	colours.clear();
	for (const input of legend.querySelectorAll("input")) {
		input.value = penColour(Number(input.dataset.pen));
	}
	render();
});

worker.onmessage = ({ data }: MessageEvent<ParseResult>) => {
	page = data.pages[0];
	showLegend(page ? usedPens(page) : []);
	render();
	const count = page?.primitives.length ?? 0;
	const skipped = data.warnings.length
		? `, ${data.warnings.length} warning(s)`
		: "";
	status.value = `${fileName}: ${count} primitive(s)${skipped}`;
	canvas.dataset.rendered = fileName;
};

async function open(file: File) {
	fileName = file.name;
	status.value = `Parsing ${file.name}…`;
	delete canvas.dataset.rendered;
	worker.postMessage(await file.text());
}

picker.addEventListener("change", () => {
	const file = picker.files?.[0];
	if (file) void open(file);
});

addEventListener("dragover", (event: DragEvent) => {
	event.preventDefault();
	document.body.classList.add("dragging");
});
addEventListener("dragleave", () => document.body.classList.remove("dragging"));
addEventListener("drop", (event: DragEvent) => {
	event.preventDefault();
	document.body.classList.remove("dragging");
	const file = event.dataTransfer?.files[0];
	if (file) void open(file);
});
addEventListener("resize", render);
