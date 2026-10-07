import {
	type Page,
	type ParseResult,
	penColour,
	usedPens,
	type Warning,
} from "@hpgl-viewer/core";
import { renderPage } from "./render.ts";

// Elements from index.html, which ships with this script.
const canvas = document.querySelector("#plot") as HTMLCanvasElement;
const picker = document.querySelector("#file") as HTMLInputElement;
const status = document.querySelector("#status") as HTMLOutputElement;
const pageSelect = document.querySelector("#page") as HTMLSelectElement;
const banner = document.querySelector("#warnings") as HTMLDivElement;
const dialect = banner.querySelector("p") as HTMLParagraphElement;
const details = banner.querySelector("details") as HTMLDetailsElement;
const MAX_LISTED = 50;

/** Shows the non-fatal warnings banner; rendering never waits on it. */
function showWarnings(warnings: Warning[]) {
	const notice = warnings.find((w) => w.kind === "dialect");
	dialect.hidden = !notice;
	dialect.textContent = notice?.message ?? "";

	const skipped = warnings.filter((w) => w.kind === "skipped");
	const counts = new Map<string, number>();
	for (const w of skipped)
		counts.set(w.mnemonic, (counts.get(w.mnemonic) ?? 0) + 1);
	const items = [...counts].slice(0, MAX_LISTED).map(([mnemonic, n]) => {
		const li = document.createElement("li");
		li.textContent = n > 1 ? `${mnemonic} ×${n}` : mnemonic;
		return li;
	});
	if (counts.size > MAX_LISTED) {
		const more = document.createElement("li");
		more.textContent = `…and ${counts.size - MAX_LISTED} more`;
		items.push(more);
	}
	details.hidden = !skipped.length;
	(details.querySelector("summary") as HTMLElement).textContent =
		`${skipped.length} command${skipped.length === 1 ? "" : "s"} skipped`;
	(details.querySelector("ul") as HTMLUListElement).replaceChildren(...items);
	banner.hidden = !warnings.length;
}

banner
	.querySelector("button")
	?.addEventListener("click", () => (banner.hidden = true));

const legend = document.querySelector("#legend") as HTMLUListElement;
const resetColours = document.querySelector(
	"#reset-colours",
) as HTMLButtonElement;

const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
	type: "module",
});
let pages: Page[] = [];
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

function show(index: number) {
	page = pages[index];
	if (page) render();
	showLegend(page ? usedPens(page) : []);
	const count = page?.primitives.length ?? 0;
	const of = pages.length > 1 ? `page ${index + 1} of ${pages.length}, ` : "";
	status.value = `${fileName}: ${of}${count} primitive(s)`;
	canvas.dataset.rendered = fileName;
	canvas.dataset.page = String(index + 1);
}

worker.onmessage = ({ data }: MessageEvent<ParseResult>) => {
	pages = data.pages;
	pageSelect.replaceChildren(
		...pages.map((_, i) => new Option(`Page ${i + 1}`, String(i))),
	);
	pageSelect.hidden = pages.length < 2;
	show(0);
	showWarnings(data.warnings);
};
// A parser crash (e.g. out of memory) keeps the previous plot on screen.
worker.onerror = (event) => {
	event.preventDefault();
	status.value = `${fileName}: could not be parsed (${event.message})`;
};

pageSelect.addEventListener("change", () => show(Number(pageSelect.value)));

async function open(file: File) {
	fileName = file.name;
	status.value = `Parsing ${file.name}…`;
	delete canvas.dataset.rendered;
	banner.hidden = true;
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
