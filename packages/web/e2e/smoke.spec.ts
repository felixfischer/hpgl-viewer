import { expect, test } from "@playwright/test";

const fixture = new URL("../../../hpgl/space-shuttle.hpgl", import.meta.url)
	.pathname;

test("a picked fixture is parsed and painted onto the canvas", async ({
	page,
}) => {
	await page.goto("/");
	await page.locator("#file").setInputFiles(fixture);
	const canvas = page.locator("#plot");
	await expect(canvas).toHaveAttribute("data-rendered", "space-shuttle.hpgl");

	const inked = await canvas.evaluate((el: HTMLCanvasElement) => {
		const ctx = el.getContext("2d");
		if (!ctx) return 0;
		const { data } = ctx.getImageData(0, 0, el.width, el.height);
		let count = 0;
		for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) count++;
		return count;
	});
	expect(inked).toBeGreaterThan(1000);
});

test("a multi-page file offers a page selector and renders each page", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.locator("#file")
		.setInputFiles(
			new URL("../../../hpgl/multi-page.hpgl", import.meta.url).pathname,
		);
	const canvas = page.locator("#plot");
	await expect(canvas).toHaveAttribute("data-rendered", "multi-page.hpgl");
	const select = page.getByLabel("Page", { exact: true });
	await expect(select.locator("option")).toHaveCount(3);
	await select.selectOption({ label: "Page 3" });
	await expect(canvas).toHaveAttribute("data-page", "3");
	await expect(page.locator("#status")).toContainText("page 3 of 3");
});

test("skipped commands show in a dismissable banner while the plot still renders", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.locator("#file")
		.setInputFiles(
			new URL("../../../hpgl/unsupported.hpgl", import.meta.url).pathname,
		);
	await expect(page.locator("#plot")).toHaveAttribute(
		"data-rendered",
		"unsupported.hpgl",
	);
	const banner = page.locator("#warnings");
	await expect(banner.locator("summary")).toHaveText("3 commands skipped");
	await banner.locator("summary").click();
	await expect(banner.locator("li")).toHaveText(["ZZ", "QX", "KK"]);
	await banner.getByRole("button", { name: "Dismiss warnings" }).click();
	await expect(banner).toBeHidden();
});

/** Counts canvas pixels painted in (roughly) the given `#rrggbb` colour. */
function inkedIn(el: HTMLCanvasElement, hex: string) {
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

test("each used pen is listed with its colour, recolourable and resettable", async ({
	page,
}) => {
	await page.goto("/");
	await page.locator("#file").setInputFiles({
		name: "two-pens.hpgl",
		mimeType: "text/plain",
		buffer: Buffer.from(
			"IN;SP1;PU0,0;PD4000,0;SP2;PU0,4000;PD4000,4000;SP0;PD0,0;",
		),
	});
	const canvas = page.locator("#plot");
	await expect(canvas).toHaveAttribute("data-rendered", "two-pens.hpgl");

	const legend = page.locator("#legend");
	await expect(legend.getByRole("listitem")).toHaveCount(2);
	const pen2 = legend.getByLabel("Pen 2");
	await expect(legend.getByLabel("Pen 1")).toHaveValue("#1a1a1a");
	await expect(pen2).toHaveValue("#e6194b");
	expect(await canvas.evaluate(inkedIn, "#e6194b")).toBeGreaterThan(50);

	await pen2.fill("#00ff00");
	await expect
		.poll(() => canvas.evaluate(inkedIn, "#00ff00"))
		.toBeGreaterThan(50);
	expect(await canvas.evaluate(inkedIn, "#e6194b")).toBe(0);

	await page.getByRole("button", { name: "Reset colours" }).click();
	await expect(pen2).toHaveValue("#e6194b");
	expect(await canvas.evaluate(inkedIn, "#00ff00")).toBe(0);
	expect(await canvas.evaluate(inkedIn, "#e6194b")).toBeGreaterThan(50);
});

test("pan, zoom and the actual-page-size toggle change the view; reset fits again", async ({
	page,
}) => {
	await page.goto("/");
	await page.locator("#file").setInputFiles(fixture);
	const canvas = page.locator("#plot");
	await expect(canvas).toHaveAttribute("data-rendered", "space-shuttle.hpgl");
	const pixels = () =>
		canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
	const fitted = await pixels();

	const box = await canvas.boundingBox();
	if (!box) throw new Error("canvas has no layout box");
	await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
	await page.mouse.wheel(0, -500);
	await expect.poll(pixels).not.toBe(fitted);
	const zoomed = await pixels();

	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 5,
	});
	await page.mouse.up();
	await expect.poll(pixels).not.toBe(zoomed);

	const reset = page.getByRole("button", { name: "Reset view" });
	await reset.click();
	await expect.poll(pixels).toBe(fitted);

	const actual = page.getByLabel("Actual page size");
	await actual.check();
	await expect.poll(pixels).not.toBe(fitted);

	await reset.click();
	await expect(actual).not.toBeChecked();
	await expect.poll(pixels).toBe(fitted);
});
