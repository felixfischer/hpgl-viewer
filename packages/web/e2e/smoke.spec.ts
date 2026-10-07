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
