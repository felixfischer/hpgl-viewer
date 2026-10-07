import type { Page, ParseResult } from "@hpgl-viewer/core";
import { renderPage } from "./render.ts";

// Elements from index.html, which ships with this script.
const canvas = document.querySelector("#plot") as HTMLCanvasElement;
const picker = document.querySelector("#file") as HTMLInputElement;
const status = document.querySelector("#status") as HTMLOutputElement;

const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
	type: "module",
});
let page: Page | undefined;
let fileName = "";

worker.onmessage = ({ data }: MessageEvent<ParseResult>) => {
	page = data.pages[0];
	if (page) renderPage(canvas, page);
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
addEventListener("resize", () => page && renderPage(canvas, page));
