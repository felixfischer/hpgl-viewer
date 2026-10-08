import { type Page, parseHpgl, penColour } from "@hpgl-viewer/core";
import { fittedView, renderPage } from "./render.ts";
import type { ScalingPoints } from "./stage.ts";

declare global {
	interface Window {
		/** Parses HP-GL `text` and draws its current page, fitted to the window. */
		renderPreview: (text: string) => void;
	}
}

// The built page builds its own minimal DOM; the HTML shell is empty (ADR-0010).
const canvas = document.createElement("canvas");
canvas.id = "preview";
canvas.setAttribute("aria-label", "Plot");
canvas.style.cssText = "display:block;width:100vw;height:100vh;";

const pageSelect = document.createElement("select");
pageSelect.id = "page";
pageSelect.setAttribute("aria-label", "Page");
pageSelect.hidden = true;
pageSelect.style.cssText = "position:fixed;top:8px;left:8px;";

const message = document.createElement("div");
message.id = "message";
message.hidden = true;
message.style.cssText =
	"position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font:16px system-ui,sans-serif;color:#666;";

document.body.style.margin = "0";
document.body.append(canvas, pageSelect, message);

let pages: Page[] = [];
let scalingPoints: ScalingPoints = { p1: [0, 0], p2: [0, 0] };
let index = 0;

/** Redraws the current page, fitted; the parse is kept so resize re-renders. */
const render = () => {
	const page = pages[index];
	if (page) renderPage(canvas, page, penColour, scalingPoints, fittedView());
};

function showPage(i: number) {
	index = i;
	pageSelect.value = String(i);
	render();
}

pageSelect.addEventListener("change", () => showPage(Number(pageSelect.value)));
addEventListener("resize", render);
new ResizeObserver(render).observe(canvas);

window.renderPreview = (text: string) => {
	const result = parseHpgl(text);
	pages = result.pages;
	scalingPoints = result.scalingPoints;
	pageSelect.replaceChildren(
		...pages.map((_, i) => new Option(`Page ${i + 1}`, String(i))),
	);
	pageSelect.hidden = pages.length < 2;

	// Nothing drawable: a short message beats a blank canvas.
	if (!pages.some((p) => p.primitives.length > 0)) {
		canvas.style.display = "none";
		message.hidden = false;
		message.textContent = "No HP-GL drawing found in this file.";
		return;
	}
	canvas.style.display = "block";
	message.hidden = true;
	showPage(0);
};
