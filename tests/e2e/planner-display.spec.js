// Planner: the Building Preview pane, top-down rooftop renders on the grid,
// and the World Background (.mca upload) feature.

const fs = require("fs");
const path = require("path");
const { test, expect } = require("./fixtures");
const { makeChunkNbt, buildRegion } = require("../helpers/region-builder.js");

const SAMPLE_REGION = fs.readFileSync(path.join(__dirname, "../../sample-data/r.0.0.mca"));
const FARMER = "horticulture_farmer"; // has rooftop data in both styles
const DOORS = "horticulture_altfarmer"; // 39x26, five exterior doors facing both ways

test.beforeEach(async ({ planner }) => {
	await planner.goto();
	await planner.page.waitForFunction(() => Object.keys(__planner.rooftopManifest).length > 0);
});

test.describe("building preview pane", () => {
	test("shows Front/Top-down toggle only for buildings with rooftop data", async ({ page, planner }) => {
		const withoutData = await page.evaluate(
			() => __planner.shapes.find((s) => !__planner.rooftopManifest[`${__planner.styleSelect.value}::${s.id}`] && s.category === "farming")?.id,
		);
		await planner.armShape(FARMER);
		const toggle = page.locator("[data-preview-view-toggle]");
		await expect(toggle).toBeVisible();

		await toggle.locator('[data-preview-view="top"]').click();
		await expect(page.locator("[data-preview-canvas]")).toBeVisible();
		await expect(toggle.locator('[data-preview-view="top"]')).toHaveClass(/is-active/);
		const drawn = await page.evaluate(() => {
			const c = __planner.previewCanvas;
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

	test("exterior doors are marked over the render and stay readable when zoomed out", async ({ page, planner }) => {
		await page.locator("[data-rooftop-toggle]").check();
		await page.locator("[data-door-toggle]").check();
		await planner.place(DOORS, 10, 10);
		const markers = page.locator(".placed-square .door-marker");
		const expected = await page.evaluate(async () => {
			const entry = __planner.placedSquares[0];
			const data = await __planner.fetchRooftopData(__planner.getRooftopDataPath(entry));
			return data.grid.flat().filter((cell) => cell?.hasDoor && cell.doorIsExterior).length;
		});
		expect(expected).toBeGreaterThan(0);
		await expect(markers).toHaveCount(expected);

		// At the farthest zoom out a block is 2.5px on screen; the marker
		// keeps its own screen size.
		await page.evaluate(() => __planner.setGridZoom(0.5, 0, 0));
		const box = await markers.first().boundingBox();
		expect(Math.max(box.width, box.height)).toBeGreaterThanOrEqual(13);
		expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(4);

		await page.locator("[data-door-toggle]").uncheck();
		await expect(markers).toHaveCount(0);
	});

	test("door markers turn with the building", async ({ page, planner }) => {
		await page.locator("[data-rooftop-toggle]").check();
		await page.locator("[data-door-toggle]").check();
		await planner.armShape(DOORS);
		const orientations = () =>
			page.locator(".door-marker").evaluateAll((els) => els.map((el) => el.className.includes("horizontal")).sort());
		await planner.clickCell(10, 10);
		await expect(page.locator(".door-marker").first()).toBeAttached();
		const before = await orientations();
		await page.evaluate(() => __planner.removeBuildings([...__planner.placedSquares]));
		await planner.armShape(DOORS);
		await page.keyboard.press("r");
		await planner.clickCell(10, 10);
		await expect(page.locator(".door-marker").first()).toBeAttached();
		expect(await orientations()).toEqual(before.map((h) => !h).sort());
		// Every marker sits inside its building.
		const inside = await page.evaluate(() => {
			const entry = __planner.placedSquares[0];
			return [...entry.doorLayer.children].every((m) => {
				const x = parseFloat(m.style.left), y = parseFloat(m.style.top);
				return x > 0 && y > 0 && x < entry.el.offsetWidth && y < entry.el.offsetHeight;
			});
		});
		expect(inside).toBe(true);
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
			for (const style of __planner.STYLE_FILES) {
				for (const shape of __planner.getStyleShapes(style.file)) {
					const dataPath = __planner.rooftopManifest[`${style.file}::${shape.id}`];
					if (!dataPath) continue;
					for (const rotated of [false, true]) {
						// Positions don't matter (placeBuilding skips collision
						// checks) - just spread them out a bit.
						const x = (slot * 37) % 400;
						const y = Math.floor(slot / 10) * 3 % 400;
						slot++;
						__planner.placeBuilding(x, y, {
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
			.poll(() => page.evaluate(() => __planner.placedSquares.filter((p) => p.el.classList.contains("has-topdown")).length), {
				timeout: 90_000,
			})
			.toBe(expected);
		await page.waitForLoadState("networkidle");
		// Anything still flat means its render couldn't be drawn (usually a
		// footprint/render size mismatch - see data-integrity.test.js).
		const flat = await page.evaluate(() =>
			[...new Set(__planner.placedSquares.filter((p) => !p.el.classList.contains("has-topdown")).map((p) => `${p.styleFile}::${p.id}`))].sort(),
		);
		expect(flat).toEqual([]);
	});
});

test("display settings show their descriptions in a tooltip on hover, not under the checkbox", async ({ page }) => {
	const row = page.locator("label:has([data-grid-lines-toggle])");
	const tooltip = page.locator(".sidebar-tooltip");
	await expect(page.getByText("Hides the per-cell grid lines on the planner map.")).toBeHidden();
	await row.hover();
	await expect(tooltip).toBeVisible();
	await expect(tooltip).toHaveText("Hides the per-cell grid lines on the planner map.");
	// Beside the pane, not over it.
	const pane = await page.locator(".left-sidebar").boundingBox();
	expect((await tooltip.boundingBox()).x).toBeGreaterThanOrEqual(pane.x + pane.width);
	await page.mouse.move(600, 400);
	await expect(tooltip).toBeHidden();
	// Keyboard users get it on focus, and screen readers via aria-describedby.
	await page.locator("[data-door-toggle]").focus();
	await expect(tooltip).toContainText("exterior door locations");
	await expect(page.locator("[data-door-toggle]")).toHaveAttribute("aria-describedby", "sidebar-tooltip");
});

test("a failed rooftop-data request is retried, not cached", async ({ page, planner, pageErrors }) => {
	pageErrors.allow(/503/);
	const dataPath = await page.evaluate((id) => __planner.rooftopManifest[`${__planner.styleSelect.value}::${id}`], FARMER);
	let failNext = true;
	await page.route(`**/${dataPath}`, async (route) => {
		if (failNext) {
			failNext = false;
			await route.fulfill({ status: 503, body: "unavailable" });
		} else {
			await route.continue();
		}
	});
	await planner.place(FARMER, 10, 10);
	const rooftop = page.locator("[data-rooftop-toggle]");
	await rooftop.check(); // first fetch fails - stays a flat block
	await expect(page.locator(".placed-square")).not.toHaveClass(/has-topdown/);
	await rooftop.uncheck();
	await rooftop.check(); // retried, and now succeeds
	await expect(page.locator(".placed-square")).toHaveClass(/has-topdown/);
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
		const bg = await page.evaluate(() => ({ ...__planner.worldBackground, biomeAt: undefined, biomeCompact: undefined, rows: __planner.rows, cols: __planner.cols }));
		expect(bg.cols).toBe(bg.gridW);
		expect(bg.rows).toBe(bg.gridH);

		await page.evaluate(() => __planner.root.scrollTo(0, 0));
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
		expect(await page.evaluate(() => __planner.worldBackground)).toBeNull();
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
		expect(await page.evaluate(() => __planner.worldBackground)).toBeNull();
	});

	test("a hostile biome name is displayed as text, never executed", async ({ page, planner }) => {
		const evil = `minecraft:x"><img src=x onerror="window.__xss=1">`;
		await uploadRegion(page, buildRegion([{ cx: 0, cz: 0, nbt: makeChunkNbt({ biome: evil }) }]));
		await expect(page.locator("[data-bg-controls]")).toBeVisible({ timeout: 30_000 });
		await page.evaluate(() => __planner.root.scrollTo(0, 0));
		const p = await planner.cellPoint(5, 5);
		await page.mouse.move(p.x, p.y);
		await expect(page.locator("[data-hover-coords-biome]")).toContainText("<img");
		expect(await page.evaluate(() => window.__xss)).toBeUndefined();
	});

	test("bad uploads report an error instead of failing silently", async ({ page }) => {
		await uploadRegion(page, Buffer.alloc(100));
		await expect(page.locator("[data-bg-status]")).toContainText(/too small|No chunks|couldn't|Skipped|no /i, { timeout: 10_000 });
		expect(await page.evaluate(() => __planner.worldBackground)).toBeNull();
	});

	// Autosave skips rewriting an unchanged background to IndexedDB (see
	// getWorldBackgroundSaveDataLocal). Another tab sharing the same autosave
	// slot must not trick that into leaving the wrong image behind.
	test("after another tab overwrites the autosaved background, this tab's next save restores its own", async ({ page, planner, context }) => {
		await uploadRegion(page, SAMPLE_REGION);
		await expect(page.locator("[data-bg-controls]")).toBeVisible({ timeout: 30_000 });
		await planner.waitForAutosave();

		const other = await context.newPage();
		const otherPlanner = new planner.constructor(other);
		await otherPlanner.goto();
		await other.evaluate(async () => {
			const magenta = document.createElement("canvas");
			magenta.width = __planner.worldBackground.gridW;
			magenta.height = __planner.worldBackground.gridH;
			const ctx = magenta.getContext("2d");
			ctx.fillStyle = "#ff00ff";
			ctx.fillRect(0, 0, magenta.width, magenta.height);
			__planner.drawWorldBgCanvas(magenta, magenta.width, magenta.height);
			await __planner.getWorldBackgroundSaveDataLocal(__planner.AUTOSAVE_BG_KEY);
		});
		await other.close();

		await planner.place(FARMER, 10, 10); // any edit triggers an autosave
		await planner.waitForAutosave();
		await planner.reload();
		await expect(page.locator(".world-bg-layer")).toBeVisible();
		const pixel = await page.evaluate(() => {
			const { gridW, gridH } = __planner.worldBackground;
			return [...__planner.worldBgCanvas.getContext("2d").getImageData(gridW >> 1, gridH >> 1, 1, 1).data];
		});
		expect(pixel).not.toEqual([255, 0, 255, 255]);
	});

	test("a named plan deleted and saved again under the same name keeps its background", async ({ page, planner }) => {
		page.on("dialog", (dialog) => dialog.accept());
		await uploadRegion(page, SAMPLE_REGION);
		await expect(page.locator("[data-bg-controls]")).toBeVisible({ timeout: 30_000 });
		const saveAs = async (name) => {
			await page.locator("[data-plan-name-input]").fill(name);
			await page.locator("[data-save-named-plan]").click();
			await expect(page.locator(".left-sidebar__plan-row", { hasText: name })).toHaveCount(1);
		};
		await saveAs("site");
		await page.locator(".left-sidebar__plan-row", { hasText: "site" }).locator(".left-sidebar__plan-action--danger").click();
		await expect(page.locator(".left-sidebar__plan-row")).toHaveCount(0);
		await saveAs("site");

		await page.locator("[data-bg-remove]").click();
		await page.locator(".left-sidebar__plan-row", { hasText: "site" }).getByText("Load").click();
		await expect(page.locator("[data-bg-controls]")).toBeVisible();
		expect(await page.evaluate(() => __planner.worldBackground && __planner.worldBackground.gridW)).toBeGreaterThan(0);
	});
});
