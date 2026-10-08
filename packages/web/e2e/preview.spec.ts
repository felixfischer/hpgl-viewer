import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { inkedIn } from "./canvas.ts";

/** The text of a repository fixture, as the native layer would hand it over. */
const fixture = (name: string) =>
	readFileSync(
		new URL(`../../../hpgl/${name}`, import.meta.url).pathname,
		"utf8",
	);

test("calling the preview's render function paints the plot", async ({
	page,
}) => {
	await page.goto("/preview/");
	await page.evaluate(
		(text) => window.renderPreview(text),
		fixture("plotter.hpgl"),
	);
	const canvas = page.locator("#preview");
	await expect(canvas).toBeVisible();
	expect(await canvas.evaluate(inkedIn, "#1a1a1a")).toBeGreaterThan(1000);
});

test("a multi-page file offers a page selector and renders the chosen page", async ({
	page,
}) => {
	await page.goto("/preview/");
	await page.evaluate(
		(text) => window.renderPreview(text),
		fixture("multi-page.hpgl"),
	);
	const select = page.getByLabel("Page", { exact: true });
	await expect(select).toBeVisible();
	await expect(select.locator("option")).toHaveCount(3);
	const canvas = page.locator("#preview");
	expect(await canvas.evaluate(inkedIn, "#1a1a1a")).toBeGreaterThan(0);
	await select.selectOption({ label: "Page 3" });
	// Page 3 is drawn in pen 3's colour; page 1's pen 1 ink is gone.
	expect(await canvas.evaluate(inkedIn, "#4363d8")).toBeGreaterThan(0);
	expect(await canvas.evaluate(inkedIn, "#1a1a1a")).toBe(0);
});

test("a single-page file hides the page selector", async ({ page }) => {
	await page.goto("/preview/");
	await page.evaluate(
		(text) => window.renderPreview(text),
		fixture("plotter.hpgl"),
	);
	// The plot paints, but with one page there is nothing to step through, so
	// the selector stays hidden (spec story 9).
	const canvas = page.locator("#preview");
	await expect(canvas).toBeVisible();
	expect(await canvas.evaluate(inkedIn, "#1a1a1a")).toBeGreaterThan(1000);
	await expect(page.locator("#page")).toBeHidden();
});

test("a file with no HP-GL commands shows a message instead of a blank canvas", async ({
	page,
}) => {
	await page.goto("/preview/");
	await page.evaluate(
		(text) => window.renderPreview(text),
		"not an HP-GL file at all",
	);
	await expect(page.locator("#message")).toBeVisible();
	await expect(page.locator("#preview")).toBeHidden();
});
