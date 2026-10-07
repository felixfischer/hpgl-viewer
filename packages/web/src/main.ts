import type { Page, ParseResult } from "@hpgl-viewer/core";
import { renderPage } from "./render.ts";

// Elements from index.html, which ships with this script.
const canvas = document.querySelector("#plot") as HTMLCanvasElement;
const picker = document.querySelector("#file") as HTMLInputElement;
const status = document.querySelector("#status") as HTMLOutputElement;
const pageSelect = document.querySelector("#page") as HTMLSelectElement;

const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
	type: "module",
});
let pages: Page[] = [];
let page: Page | undefined;
let fileName = "";
let warnings = "";

function show(index: number) {
	page = pages[index];
	if (page) renderPage(canvas, page);
	const count = page?.primitives.length ?? 0;
	const of = pages.length > 1 ? `page ${index + 1} of ${pages.length}, ` : "";
	status.value = `${fileName}: ${of}${count} primitive(s)${warnings}`;
	canvas.dataset.rendered = fileName;
	canvas.dataset.page = String(index + 1);
}

worker.onmessage = ({ data }: MessageEvent<ParseResult>) => {
	pages = data.pages;
	warnings = data.warnings.length ? `, ${data.warnings.length} warning(s)` : "";
	pageSelect.replaceChildren(
		...pages.map((_, i) => new Option(`Page ${i + 1}`, String(i))),
	);
	pageSelect.hidden = pages.length < 2;
	show(0);
};

pageSelect.addEventListener("change", () => show(Number(pageSelect.value)));

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
