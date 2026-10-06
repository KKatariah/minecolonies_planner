// Planner: the Building Preview pane, top-down rooftop renders on the grid,
// and the World Background (.mca upload) feature.

const fs = require("fs");
const path = require("path");
const { test, expect } = require("./fixtures");
const { makeChunkNbt, buildRegion } = require("../helpers/region-builder.js");

const SAMPLE_REGION = fs.readFileSync(path.join(__dirname, "../../sample-data/r.0.0.mca"));
const FARMER = "horticulture_farmer"; // has rooftop data in both styles

test.beforeEach(async ({ planner }) => {
	await planner.goto();
	await planner.page.waitForFunction(() => Object.keys(rooftopManifest).length > 0);
});

test.describe("building preview pane", () => {
	test("shows Front/Top-down toggle only for buildings with rooftop data", async ({ page, planner }) => {
		const withoutData = await page.evaluate(
			() => shapes.find((s) => !rooftopManifest[`${styleSelect.value}::${s.id}`] && s.category === "farming")?.id,
		);
		await planner.armShape(FARMER);
		const toggle = page.locator("[data-preview-view-toggle]");
		await expect(toggle).toBeVisible();

		await toggle.locator('[data-preview-view="top"]').click();
		await expect(page.locator("[data-preview-canvas]")).toBeVisible();
		await expect(toggle.locator('[data-preview-view="top"]')).toHaveClass(/is-active/);
		const drawn = await page.evaluate(() => {
			const c = previewCanvas;
			const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
			for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
			return false;
		});
		expect(drawn, "top-down preview canvas should have pixels").toBe(true);

		await toggle.locator('[data-preview-view="front"]').click();
		await expect(page.locator("[data-preview-canvas]")).toBeHidden();

		if (withoutData) {
			await planner.page.locator(`.shape-option[data-shape-id="${withoutData}"]`).click();
			await expect(toggle).toBeHidden();
		}
	});

	test("shows the front photo when one exists", async ({ page, planner }) => {
		await planner.armShape(FARMER);
		const img = page.locator("[data-preview-image]");
		await expect(img).toBeVisible();
		await expect(img).toHaveAttribute("src", /images\/caledonia\/.+_front\.jpg$/);
		expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
	});

	test("tray thumbnails load photos (with fallback to the label badge)", async ({ page }) => {
		await page.waitForLoadState("networkidle");
		const states = await page.locator(".shape-option").evaluateAll((els) =>
			els.map((el) => {
				const img = el.querySelector(".shape-preview__image");
				const badge = el.querySelector(".preview-badge");
				return { photo: !img.hidden && img.naturalWidth > 0, badge: !badge.hidden };
			}),
		);
		expect(states.length).toBeGreaterThan(0);
		for (const s of states) expect(s.photo !== s.badge).toBe(true); // exactly one shown
		expect(states.some((s) => s.photo)).toBe(true);
	});

	test("the preview pane collapses and expands", async ({ page }) => {
		const toggle = page.locator("[data-preview-toggle]");
		await toggle.click();
		await expect(page.locator("body")).toHaveClass(/preview-collapsed/);
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		await toggle.click();
		await expect(page.locator("body")).not.toHaveClass(/preview-collapsed/);
	});
});

test.describe("top-down renders on the grid", () => {
	test("toggling on swaps a placed building's flat block for its render, and back", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		const el = page.locator(".placed-square");
		await expect(el).not.toHaveClass(/has-topdown/);
		await page.locator("[data-rooftop-toggle]").check();
		await expect(el).toHaveClass(/has-topdown/);
		await expect(el.locator(".placed-square__rooftop-canvas")).toBeVisible();
		await page.locator("[data-rooftop-toggle]").uncheck();
		await expect(el).not.toHaveClass(/has-topdown/);
		await expect(el.locator(".placed-square__rooftop-canvas")).toBeHidden();
	});

	test("rotated buildings still get their render", async ({ page, planner }) => {
		await page.locator("[data-rooftop-toggle]").check();
		await planner.armShape("horticulture_altfarmer"); // 39x26 - non-square
		await page.keyboard.press("r");
		await planner.clickCell(10, 10);
		await expect.poll(() => planner.buildingCount()).toBe(1);
		expect((await planner.buildings())[0]).toMatchObject({ w: 26, h: 39, rotated: true });
		await expect(page.locator(".placed-square")).toHaveClass(/has-topdown/);
	});

	test("every building with rooftop data renders on the grid in both orientations", async ({ page }) => {
		test.setTimeout(120_000);
		await page.locator("[data-rooftop-toggle]").check();
		const expected = await page.evaluate(() => {
			let count = 0;
			let slot = 0;
			for (const style of STYLE_FILES) {
				for (const shape of getStyleShapes(style.file)) {
					const dataPath = rooftopManifest[`${style.file}::${shape.id}`];
					if (!dataPath) continue;
					for (const rotated of [false, true]) {
						// Positions don't matter (placeSquare skips collision
						// checks) - just spread them out a bit.
						const x = (slot * 37) % 400;
						const y = Math.floor(slot / 10) * 3 % 400;
						slot++;
						placeSquare(x, y, {
							id: shape.id,
							styleFile: style.file,
							w: rotated ? shape.h : shape.w,
							h: rotated ? shape.w : shape.h,
							rotated,
						});
						count++;
					}
				}
			}
			return count;
		});
		expect(expected).toBeGreaterThan(400);
		await expect
			.poll(() => page.evaluate(() => placedSquares.filter((p) => p.el.classList.contains("has-topdown")).length), {
				timeout: 90_000,
			})
			.toBe(expected);
		await page.waitForLoadState("networkidle");
		// Anything still flat means its render couldn't be drawn (usually a
		// footprint/render size mismatch - see data-integrity.test.js).
		const flat = await page.evaluate(() =>
			[...new Set(placedSquares.filter((p) => !p.el.classList.contains("has-topdown")).map((p) => `${p.styleFile}::${p.id}`))].sort(),
		);
		expect(flat).toEqual([]);
	});
});

test.describe("world background", () => {
	async function uploadRegion(page, buffer, name = "r.0.0.mca") {
		await page.locator("[data-bg-file-input]").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
	}

	test("uploading a region file shows terrain, resizes the grid and reports biomes on hover", async ({ page, planner }) => {
		await uploadRegion(page, SAMPLE_REGION);
		await expect(page.locator("[data-bg-status]")).toContainText(/Loaded [\d,]+ chunks from 1 file/, { timeout: 30_000 });
		await expect(page.locator("[data-bg-controls]")).toBeVisible();
		await expect(page.locator(".world-bg-layer")).toBeVisible();
		const bg = await page.evaluate(() => ({ ...worldBackground, biomeAt: undefined, biomeCompact: undefined, rows, cols }));
		expect(bg.cols).toBe(bg.gridW);
		expect(bg.rows).toBe(bg.gridH);

		await page.evaluate(() => root.scrollTo(0, 0));
		const p = await planner.cellPoint(100, 100);
		await page.mouse.move(p.x, p.y);
		await expect(page.locator("[data-hover-coords-biome]")).not.toBeEmpty();
	});

	test("visibility checkbox hides it; Remove clears it", async ({ page }) => {
		await uploadRegion(page, SAMPLE_REGION);
		await expect(page.locator("[data-bg-controls]")).toBeVisible({ timeout: 30_000 });
		await page.locator("[data-bg-visible]").uncheck();
		await expect(page.locator(".world-bg-layer")).toBeHidden();
		await page.locator("[data-bg-visible]").check();
		await expect(page.locator(".world-bg-layer")).toBeVisible();
		await page.locator("[data-bg-remove]").click();
		await expect(page.locator("[data-bg-controls]")).toBeHidden();
		await expect(page.locator(".world-bg-layer")).toBeHidden();
		expect(await page.evaluate(() => worldBackground)).toBeNull();
	});

	test("the background survives a reload (via IndexedDB) and is embedded in JSON exports", async ({ page, planner }) => {
		await uploadRegion(page, SAMPLE_REGION);
		await expect(page.locator("[data-bg-controls]")).toBeVisible({ timeout: 30_000 });
		await planner.waitForAutosave();
		const autosaved = await planner.autosave();
		expect(autosaved.background).toBeTruthy();

		const downloadPromise = page.waitForEvent("download");
		await page.locator("[data-export-json]").click();
		const exported = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), "utf8"));
		expect(exported.background.dataUrl).toMatch(/^data:image\/png;base64,/);

		await planner.reload();
		await expect(page.locator("[data-bg-controls]")).toBeVisible();
		await expect(page.locator(".world-bg-layer")).toBeVisible();
	});

	test("an imported plan can't make the browser fetch a remote background URL", async ({ page, planner }) => {
		const requests = [];
		page.on("request", (r) => requests.push(r.url()));
		await page.locator("[data-import-json]").setInputFiles({
			name: "evil.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify({
				formatVersion: 1,
				grid: { rows: 512, cols: 512 },
				buildings: [],
				roads: { paths: [] },
				background: { dataUrl: "https://attacker.invalid/beacon.png", gridW: 10, gridH: 10, minCx: 0, minCz: 0 },
			})),
		});
		await page.waitForTimeout(500);
		expect(requests.filter((u) => u.includes("attacker.invalid"))).toEqual([]);
		expect(await page.evaluate(() => worldBackground)).toBeNull();
	});

	test("a hostile biome name is displayed as text, never executed", async ({ page, planner }) => {
		const evil = `minecraft:x"><img src=x onerror="window.__xss=1">`;
		await uploadRegion(page, buildRegion([{ cx: 0, cz: 0, nbt: makeChunkNbt({ biome: evil }) }]));
		await expect(page.locator("[data-bg-controls]")).toBeVisible({ timeout: 30_000 });
		await page.evaluate(() => root.scrollTo(0, 0));
		const p = await planner.cellPoint(5, 5);
		await page.mouse.move(p.x, p.y);
		await expect(page.locator("[data-hover-coords-biome]")).toContainText("<img");
		expect(await page.evaluate(() => window.__xss)).toBeUndefined();
	});

	test("bad uploads report an error instead of failing silently", async ({ page }) => {
		await uploadRegion(page, Buffer.alloc(100));
		await expect(page.locator("[data-bg-status]")).toContainText(/too small|No chunks|couldn't|Skipped|no /i, { timeout: 10_000 });
		expect(await page.evaluate(() => worldBackground)).toBeNull();
	});
});
