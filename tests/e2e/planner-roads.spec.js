// Planner: the "Roads & Rivers" tab - Path runs, freehand canal, eraser,
// selecting/moving/deleting painted paths, and the piece brushes (walls,
// Caledonia's road families) that place real blueprint pieces along a
// dragged line.

const { test, expect } = require("./fixtures");

const cellKeys = (path) => new Set(path.cells.map((c) => `${c.x},${c.y}`));

// Every cell in the width x width square the brush stamps around (cx, cy)
// (odd widths, so it's centered).
function square(cx, cy, width) {
	const r = Math.floor(width / 2);
	const out = [];
	for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) out.push(`${cx + dx},${cy + dy}`);
	return out;
}

async function setPathWidth(page, width) {
	await page.locator("[data-path-width-input]").fill(String(width));
	await page.locator("[data-path-width-input]").dispatchEvent("change");
}

const bounds = (path) => {
	const xs = path.cells.map((c) => c.x);
	const ys = path.cells.map((c) => c.y);
	return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

test.beforeEach(async ({ planner }) => {
	await planner.goto();
	await planner.openTab("roads");
});

test.describe("tool controls", () => {
	test("the Roads tab swaps the tray for the brush controls and arms the tool", async ({ page }) => {
		await expect(page.locator(".shape-tray .path-controls")).toBeVisible();
		await expect(page.locator(".shape-option")).toHaveCount(0);
		expect(await page.evaluate(() => __planner.pathToolActive)).toBe(true);

		const types = await page.locator("[data-path-type-option]").evaluateAll((els) => els.map((e) => e.dataset.pathTypeOption));
		expect(types).toEqual(["default", "alleys", "avenues", "birail", "canal", "monorail", "roads", "walls"]);
		await expect(page.locator(".path-type-swatch.is-active")).toHaveAttribute("data-path-type-option", "default");
		await expect(page.locator("[data-path-width-input]")).toHaveValue("5");
	});

	test("leaving the tab disarms the tool and turns the eraser back off", async ({ page, planner }) => {
		await page.locator("[data-path-erase-toggle]").click();
		await expect(page.locator("[data-path-erase-toggle]")).toHaveText("Eraser (on)");
		await planner.openTab("farming");
		expect(await page.evaluate(() => ({ tool: __planner.pathToolActive, erase: __planner.pathEraseMode }))).toEqual({ tool: false, erase: false });
		await planner.openTab("roads");
		await expect(page.locator("[data-path-erase-toggle]")).toHaveText("Eraser");
	});

	test("Path's width input is clamped to 1-16", async ({ page }) => {
		const width = page.locator("[data-path-width-input]");
		for (const [typed, expected] of [["20", "16"], ["0", "1"], ["-4", "1"], ["3.6", "4"], ["7", "7"]]) {
			await width.fill(typed);
			await width.dispatchEvent("change");
			await expect(width).toHaveValue(expected);
		}
		expect(await page.evaluate(() => __planner.pathWidth)).toBe(7);
	});

	test("the - and + buttons step Path's width and switch off at either end", async ({ page }) => {
		const minus = page.locator('[data-path-width-step="-1"]');
		const plus = page.locator('[data-path-width-step="1"]');
		await plus.click();
		await plus.click();
		await expect(page.locator("[data-path-width-input]")).toHaveValue("7");
		await minus.click();
		expect(await page.evaluate(() => __planner.pathWidth)).toBe(6);
		await setPathWidth(page, 1);
		await expect(minus).toBeDisabled();
		await expect(plus).toBeEnabled();
		await setPathWidth(page, 16);
		await expect(plus).toBeDisabled();
	});

	test("Path and canal each keep their own width; piece types hide the width", async ({ page }) => {
		const width = page.locator("[data-path-width-input]");
		await setPathWidth(page, 3);
		await page.locator('[data-path-type-option="canal"]').click();
		await expect(width).toHaveValue("8"); // canal starts at its blueprint width
		await setPathWidth(page, 12);
		await page.locator('[data-path-type-option="default"]').click();
		await expect(width).toHaveValue("3");
		await page.locator('[data-path-type-option="canal"]').click();
		await expect(width).toHaveValue("12");
		for (const type of ["roads", "alleys", "avenues", "birail", "monorail", "walls"]) {
			await page.locator(`[data-path-type-option="${type}"]`).click();
			await expect(page.locator("[data-path-width-field]"), type).toBeHidden();
			await expect(page.locator("[data-path-erase-toggle]"), type).toBeHidden();
		}
		await page.locator('[data-path-type-option="canal"]').click();
		await expect(width).toBeVisible();
	});

	test("Medieval Spruce, with no road pieces, offers Path, Canal and Walls", async ({ page, planner }) => {
		await planner.selectStyle("Medieval Spruce");
		await planner.openTab("roads");
		const types = await page.locator("[data-path-type-option]").evaluateAll((els) => els.map((e) => e.dataset.pathTypeOption));
		expect(types).toEqual(["default", "canal", "walls"]);
	});

	test("Medieval Spruce locks canal to its pieces' 8-wide water; Caledonia's stays adjustable", async ({ page, planner }) => {
		await planner.selectStyle("Medieval Spruce");
		await planner.openTab("roads");
		await page.locator('[data-path-type-option="default"]').click();
		await expect(page.locator("[data-path-width-field]")).toBeVisible();
		await page.locator('[data-path-type-option="canal"]').click();
		await expect(page.locator("[data-path-width-field]")).toBeHidden();
		await expect(page.locator("[data-path-erase-toggle]")).toBeVisible();
		await expect(page.locator("[data-path-controls-hint]")).toContainText("8 blocks wide");
		await planner.clickCell(40, 40);
		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		const xs = paths[0].cells.map((c) => c.x), ys = paths[0].cells.map((c) => c.y);
		expect([Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1]).toEqual([8, 8]);

		await planner.selectStyle("Caledonia");
		await planner.openTab("roads");
		await page.locator('[data-path-type-option="canal"]').click();
		await expect(page.locator("[data-path-width-field]")).toBeVisible();
		await expect(page.locator("[data-path-controls-hint]")).not.toContainText("blocks wide");
	});

	test("the walls type hides the eraser and swaps the hint", async ({ page }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await expect(page.locator("[data-path-erase-toggle]")).toBeHidden();
		await expect(page.locator("[data-path-controls-hint]")).toContainText("place real wall pieces");
		await page.locator('[data-path-type-option="default"]').click();
		await expect(page.locator("[data-path-erase-toggle]")).toBeVisible();
		await expect(page.locator("[data-path-controls-hint]")).toContainText("paint");
	});

	test("the walls type hides the (meaningless) width field", async ({ page }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await expect(page.locator("[data-path-width-field]")).toBeHidden();
		await page.locator('[data-path-type-option="default"]').click();
		await expect(page.locator("[data-path-width-field]")).toBeVisible();
	});

	test("'R' does nothing while the road tool is armed", async ({ page }) => {
		await page.keyboard.press("r");
		expect(await page.evaluate(() => __planner.pendingRotated)).toBe(false);
	});
});

test.describe("painting", () => {
	test("a single click stamps one brush-sized square", async ({ planner }) => {
		await planner.clickCell(30, 30);
		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		expect(paths[0]).toMatchObject({ type: "default", width: 5 });
		expect([...cellKeys(paths[0])].sort()).toEqual(square(30, 30, 5).sort());
	});

	test("every Path width 1-16, and canal, paints exactly width x width, matching the eraser preview", async ({ page, planner }) => {
		const cases = [];
		for (let width = 1; width <= 16; width++) cases.push({ type: "default", width });
		cases.push({ type: "canal", width: 8 });
		for (const [i, { type, width }] of cases.entries()) {
			await page.locator(`[data-path-type-option="${type}"]`).click();
			if (type === "default") await setPathWidth(page, width);
			// Rows of six, kept on screen and spaced so a click never snaps
			// onto the previous square.
			const cx = 15 + (i % 6) * 30;
			const cy = 30 + Math.floor(i / 6) * 40;
			await planner.clickCell(cx, cy);
			const p = (await planner.paths()).at(-1);
			const b = bounds(p);
			expect(p, `${type} ${width}`).toMatchObject({ type, width });
			expect(p.cells.length, `${type} ${width}`).toBe(width * width);
			expect([b.maxX - b.minX + 1, b.maxY - b.minY + 1], `${type} ${width}`).toEqual([width, width]);

			// Eraser hover outline covers the same cells a paint stamp does.
			await page.locator("[data-path-erase-toggle]").click();
			const pt = await planner.cellPoint(cx, cy);
			await page.mouse.move(pt.x, pt.y);
			const box = await page.evaluate(() => ({
				x: parseFloat(__planner.eraserHoverEl.style.left) / __planner.cellSize,
				w: parseFloat(__planner.eraserHoverEl.style.width) / __planner.cellSize,
			}));
			expect(box, `eraser preview, ${type} ${width}`).toEqual({ x: b.minX, w: width });
			await page.locator("[data-path-erase-toggle]").click();
		}
	});

	test("a drag paints one straight run along the axis it moved furthest", async ({ page, planner }) => {
		await setPathWidth(page, 7);
		await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 47 });
		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		// A full 7-wide rectangle on row 40, reaching 3 past each end.
		expect(bounds(paths[0])).toEqual({ minX: 17, maxX: 83, minY: 37, maxY: 43 });
		expect(paths[0].cells.length).toBe(67 * 7);
	});

	test("a preview outlines the run while dragging", async ({ page, planner }) => {
		await setPathWidth(page, 7);
		const a = await planner.cellPoint(20, 40);
		const b = await planner.cellPoint(60, 40);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		await page.mouse.move(b.x, b.y, { steps: 8 });
		const preview = page.locator(".run-draw-preview");
		await expect(preview).toBeVisible();
		const rect = await preview.evaluate((el) => ({
			x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height),
		}));
		const size = await page.evaluate(() => __planner.cellSize);
		expect(rect).toEqual({ x: 17 * size, y: 37 * size, w: 47 * size, h: 7 * size });
		await page.mouse.up();
		await expect(preview).toBeHidden();
	});

	test("a run starting near another's end turns a square corner and joins its path", async ({ page, planner }) => {
		await setPathWidth(page, 7);
		await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 40 });
		// Starts a few cells off the first run's end - snaps onto it.
		await planner.dragCells({ x: 82, y: 43 }, { x: 82, y: 100 });
		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		expect(bounds(paths[0])).toEqual({ minX: 17, maxX: 83, minY: 37, maxY: 103 });
		const keys = cellKeys(paths[0]);
		expect(keys.has("83,37")).toBe(true); // outside corner filled
		expect(keys.has("84,50")).toBe(false); // vertical run stayed on column 80
	});

	test("continuing a run in the same direction extends it", async ({ page, planner }) => {
		await setPathWidth(page, 7);
		await planner.dragCells({ x: 20, y: 40 }, { x: 60, y: 40 });
		await planner.dragCells({ x: 62, y: 41 }, { x: 100, y: 41 });
		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		expect(bounds(paths[0])).toEqual({ minX: 17, maxX: 103, minY: 37, maxY: 43 });
	});

	test("a run ending beside another's middle snaps into a T", async ({ page, planner }) => {
		await setPathWidth(page, 7);
		await planner.dragCells({ x: 20, y: 40 }, { x: 100, y: 40 });
		await planner.dragCells({ x: 60, y: 110 }, { x: 60, y: 45 });
		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		const keys = cellKeys(paths[0]);
		// The stem reaches the main run with no gap.
		for (let y = 40; y <= 110; y++) expect(keys.has(`60,${y}`), `y=${y}`).toBe(true);
		expect(bounds(paths[0]).minY).toBe(37);
	});

	test("holding Alt paints a run without snapping, as a separate path", async ({ page, planner }) => {
		await setPathWidth(page, 7);
		await planner.dragCells({ x: 20, y: 40 }, { x: 100, y: 40 });
		// Ends 8 from the run's centerline: inside the snap distance.
		await planner.dragCells({ x: 60, y: 110 }, { x: 60, y: 48 }, { modifiers: ["Alt"] });
		const paths = await planner.paths();
		expect(paths).toHaveLength(2);
		expect(bounds(paths[1]).minY).toBe(45);
	});

	test("a run joining two separate paths merges them into one", async ({ page, planner }) => {
		await setPathWidth(page, 7);
		await planner.dragCells({ x: 20, y: 40 }, { x: 60, y: 40 });
		await planner.dragCells({ x: 20, y: 80 }, { x: 60, y: 80 });
		expect(await planner.paths()).toHaveLength(2);
		await planner.dragCells({ x: 61, y: 41 }, { x: 61, y: 79 });
		expect(await planner.paths()).toHaveLength(1);
	});

	test("runs of different types don't join", async ({ page, planner }) => {
		await planner.dragCells({ x: 20, y: 40 }, { x: 60, y: 40 });
		await page.locator('[data-path-type-option="canal"]').click();
		await planner.dragCells({ x: 61, y: 41 }, { x: 61, y: 90 });
		const paths = await planner.paths();
		expect(paths.map((p) => p.type)).toEqual(["default", "canal"]);
		// Not snapped: the 8-wide canal stayed on column 61.
		expect(bounds(paths[1])).toMatchObject({ minX: 58, maxX: 65 });
	});

	test("canal paints freehand: a diagonal drag leaves one continuous stroke", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="canal"]').click();
		await planner.dragCells({ x: 20, y: 20 }, { x: 90, y: 50 }, { steps: 4 });
		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		const keys = cellKeys(paths[0]);
		// Interpolated between sparse pointer samples: every column has water,
		// and it follows the diagonal rather than one row.
		for (let x = 20; x <= 90; x++) {
			expect([...keys].some((k) => k.startsWith(`${x},`)), `column ${x}`).toBe(true);
		}
		const b = bounds(paths[0]);
		expect(b.maxY - b.minY).toBeGreaterThan(20);
	});

	test("canal: holding Shift locks the stroke to a straight line", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="canal"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 47 }, { modifiers: ["Shift"] });
		const [p] = await planner.paths();
		// 8 wide: 3 rows above the line, 4 below.
		expect(bounds(p)).toEqual({ minX: 17, maxX: 84, minY: 37, maxY: 44 });
	});

	test("canal strokes never snap to other canals", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="canal"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 60, y: 40 }, { modifiers: ["Shift"] });
		await planner.dragCells({ x: 63, y: 43 }, { x: 63, y: 90 }, { modifiers: ["Shift"] });
		const paths = await planner.paths();
		expect(paths).toHaveLength(2);
		expect(bounds(paths[1])).toMatchObject({ minX: 60, maxX: 67, minY: 40 });
	});

	test("the chosen type is recorded on the path and changes its color", async ({ page, planner }) => {
		await planner.clickCell(20, 20);
		await page.locator('[data-path-type-option="canal"]').click();
		await expect(page.locator(".path-type-swatch.is-active")).toHaveAttribute("data-path-type-option", "canal");
		await planner.clickCell(60, 20);
		const paths = await planner.paths();
		expect(paths.map((p) => p.type)).toEqual(["default", "canal"]);
		// Sampled from the middle of each path's canvas, away from its edges.
		const colors = await page.locator(".placed-path__canvas").evaluateAll((canvases) =>
			canvases.map((c) => c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data.join(",")),
		);
		expect(colors[0]).not.toBe(colors[1]);
	});

	test("painting over a building neither selects nor moves it", async ({ page, planner }) => {
		await planner.place("horticulture_farmer", 30, 30);
		await planner.openTab("roads");
		await planner.dragCells({ x: 20, y: 36 }, { x: 60, y: 36 });
		expect((await planner.buildings())[0]).toMatchObject({ x: 30, y: 30 });
		await expect(page.locator(".placed-square.is-selected")).toHaveCount(0);
		expect(await planner.paths()).toHaveLength(1);
	});

	test("each stroke is one undo step", async ({ page, planner }) => {
		await planner.dragCells({ x: 20, y: 20 }, { x: 60, y: 20 });
		await planner.dragCells({ x: 20, y: 50 }, { x: 60, y: 50 });
		expect(await planner.paths()).toHaveLength(2);
		await page.keyboard.press("Control+z");
		expect(await planner.paths()).toHaveLength(1);
		await page.keyboard.press("Control+z");
		expect(await planner.paths()).toHaveLength(0);
		await page.keyboard.press("Control+y");
		expect(await planner.paths()).toHaveLength(1);
	});
});

test.describe("eraser", () => {
	test("erases cells from every path it crosses and drops emptied paths", async ({ page, planner }) => {
		await planner.dragCells({ x: 20, y: 20 }, { x: 80, y: 20 });
		await page.locator('[data-path-type-option="canal"]').click();
		await planner.clickCell(100, 60); // a lone 8x8 canal blob
		expect(await planner.paths()).toHaveLength(2);

		await page.locator("[data-path-erase-toggle]").click();
		await expect(page.locator("[data-path-erase-toggle]")).toHaveClass(/is-active/);
		// Cut the road in two.
		await planner.dragCells({ x: 50, y: 14 }, { x: 50, y: 26 });
		// Wipe out the canal entirely (the eraser is canal-width too).
		await planner.clickCell(100, 60);

		// The road, cut in two, is now two paths; the canal is gone.
		const paths = await planner.paths();
		expect(paths).toHaveLength(2);
		const road = new Set(paths.flatMap((path) => [...cellKeys(path)]));
		for (const key of square(50, 20, 5)) expect(road.has(key), key).toBe(false);
		expect(paths.map((path) => cellKeys(path).has("20,20"))).toContain(true);
		expect(paths.map((path) => cellKeys(path).has("80,20"))).toContain(true);
	});

	test("erasing through a T junction separates the paths, each deletable on its own", async ({ page, planner }) => {
		await setPathWidth(page, 7);
		await planner.dragCells({ x: 20, y: 40 }, { x: 100, y: 40 });
		await planner.dragCells({ x: 60, y: 110 }, { x: 60, y: 45 });
		expect(await planner.paths()).toHaveLength(1);

		await page.locator("[data-path-erase-toggle]").click();
		await planner.dragCells({ x: 50, y: 47 }, { x: 70, y: 47 });
		const paths = await planner.paths();
		expect(paths).toHaveLength(2);
		const stem = paths.find((path) => cellKeys(path).has("60,100"));
		expect(cellKeys(stem).has("60,40")).toBe(false);

		// The main run is drawn this session, so a new run still snaps to it.
		await page.locator("[data-path-erase-toggle]").click();
		await planner.dragCells({ x: 30, y: 80 }, { x: 30, y: 45 });
		expect(await planner.paths()).toHaveLength(2);
	});

	test("shows a hover preview of the eraser footprint", async ({ page, planner }) => {
		await page.locator("[data-path-erase-toggle]").click();
		const p = await planner.cellPoint(40, 40);
		await page.mouse.move(p.x, p.y);
		await expect(page.locator(".eraser-hover-preview")).toBeVisible();
		await page.locator("[data-path-erase-toggle]").click();
		await expect(page.locator(".eraser-hover-preview")).toBeHidden();
	});
});

test.describe("path rendering", () => {
	// Paths used to be one DOM element per cell, which made every edit
	// (and every grid click) cost hundreds of ms on a large map.
	test("each path is a single element with one canvas, however many cells it has", async ({ page, planner }) => {
		await setPathWidth(page, 16);
		await planner.dragCells({ x: 20, y: 30 }, { x: 200, y: 30 });
		const [p] = await planner.paths();
		expect(p.cells.length).toBeGreaterThan(1000);
		await expect(page.locator(".placed-path")).toHaveCount(1);
		expect(await page.locator(".placed-path *").count()).toBe(1);
		await expect(page.locator(".placed-path > canvas.placed-path__canvas")).toHaveCount(1);
	});

	// Only the old plain "Path" type (still in saved plans) uses theme colors.
	// Canal matches the world background's water (#3355DD) rather than
	// borrowing a block texture, even with top-down renders on.
	test("canal paints flat water blue with top-down renders on", async ({ page, planner }) => {
		await page.getByLabel("Show top-down renders").check();
		await page.locator('[data-path-type-option="canal"]').click();
		await planner.dragCells({ x: 20, y: 30 }, { x: 60, y: 30 });
		// The middle of a cell, clear of the grid lines drawn over the water.
		const cellPixel = () =>
			page.locator(".placed-path__canvas").evaluate((c) => {
				const cell = (__planner.cellSize * c.width) / c.getBoundingClientRect().width / __planner.gridZoom;
				return [...c.getContext("2d").getImageData(Math.floor(cell * 10.5), Math.floor(cell * 3.5), 1, 1).data].join(",");
			});
		await page.waitForTimeout(300); // any (wrong) texture load would have landed
		expect(await cellPixel()).toBe("51,85,221,255");
	});

	test("switching theme redraws paths in the new theme's colors", async ({ page }) => {
		await page.evaluate(() => {
			const cells = [];
			for (let x = 20; x <= 60; x++) for (let y = 28; y <= 32; y++) cells.push({ x, y });
			__planner.restorePaths([{ type: "default", width: 5, cells }]);
		});
		const centerPixel = () =>
			page.locator(".placed-path__canvas").evaluate((c) => c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data.join(","));
		const before = await centerPixel();
		await page.locator("[data-theme-toggle]").click();
		await expect.poll(centerPixel).not.toBe(before);
	});
});

test.describe("selecting painted paths", () => {
	test.beforeEach(async ({ planner }) => {
		await planner.dragCells({ x: 20, y: 30 }, { x: 60, y: 30 });
		await planner.openTab("farming"); // tool off - clicks now select
	});

	test("click selects a path and its menu deletes it", async ({ page, planner }) => {
		await planner.clickCell(40, 30);
		await expect(page.locator(".placed-path.is-selected")).toHaveCount(1);
		const menu = page.locator(".path-action-menu");
		await expect(menu).toBeVisible();
		await menu.locator('[data-path-action="delete"]').click();
		expect(await planner.paths()).toHaveLength(0);
		await expect(page.locator(".placed-path")).toHaveCount(0);
	});

	test("Delete key removes the selected path, and undo brings it back", async ({ page, planner }) => {
		const before = await planner.paths();
		await planner.clickCell(40, 30);
		await page.keyboard.press("Delete");
		expect(await planner.paths()).toHaveLength(0);
		await page.keyboard.press("Control+z");
		expect(await planner.paths()).toEqual(before);
	});

	test("clicking empty grid deselects the path", async ({ page, planner }) => {
		await planner.clickCell(40, 30);
		await planner.clickCell(40, 80);
		await expect(page.locator(".placed-path.is-selected")).toHaveCount(0);
		await expect(page.locator(".path-action-menu")).toBeHidden();
	});

	test("dragging a selected path translates every cell", async ({ planner }) => {
		const [before] = await planner.paths();
		await planner.clickCell(40, 30);
		await planner.dragCells({ x: 40, y: 30 }, { x: 50, y: 45 });
		const [after] = await planner.paths();
		expect(after.cells).toEqual(before.cells.map((c) => ({ x: c.x + 10, y: c.y + 15 })));
	});

	test("a dragged path stops at the grid edge instead of leaving it", async ({ planner }) => {
		const [before] = await planner.paths();
		const minX = Math.min(...before.cells.map((c) => c.x));
		await planner.clickCell(40, 30);
		// Asks for 40 blocks left, but the path's left edge is only minX from the edge.
		await planner.dragCells({ x: 40, y: 30 }, { x: 0, y: 30 });
		const [after] = await planner.paths();
		expect(after.cells).toEqual(before.cells.map((c) => ({ x: c.x - minX, y: c.y })));
	});
});

test.describe("walls", () => {
	for (const style of ["Caledonia", "Medieval Spruce"]) {
		test(`${style}: dragging a run places real wall pieces covering it`, async ({ page, planner }) => {
			await planner.selectStyle(style);
			await planner.openTab("roads");
			await page.locator('[data-path-type-option="walls"]').click();
			await planner.dragCells({ x: 20, y: 40 }, { x: 90, y: 40 });

			const kit = await page.evaluate(() => __planner.RUN_KITS[__planner.styleSelect.value].walls);
			const pieces = await planner.buildings();
			expect(pieces.length).toBeGreaterThan(0);
			const segmentIds = kit.segments.map((s) => s.id);
			for (const piece of pieces) {
				expect(segmentIds).toContain(piece.id);
				expect(piece.h).toBe(kit.thickness);
			}
			const minX = Math.min(...pieces.map((p) => p.x));
			const maxX = Math.max(...pieces.map((p) => p.x + p.w - 1));
			expect([minX, maxX]).toEqual([20, 90]);
			// No gaps along the run.
			for (let x = 20; x <= 90; x++) {
				expect(pieces.some((p) => x >= p.x && x < p.x + p.w), `x=${x}`).toBe(true);
			}
			expect(await planner.paths()).toHaveLength(0); // walls aren't paint
		});
	}

	test("two runs meeting at a corner get a corner piece", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 40 });
		await planner.dragCells({ x: 80, y: 40 }, { x: 80, y: 100 });
		const kit = await page.evaluate(() => __planner.RUN_KITS[__planner.styleSelect.value].walls);
		const ids = (await planner.buildings()).map((b) => b.id);
		expect(ids).toContain(kit.turn.id);
	});

	test("a plain click on a placed wall selects it", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 60, y: 40 });
		await planner.clickCell(25, 40);
		await expect(page.locator(".placed-square.is-selected")).toHaveCount(1);
	});

	test("a whole run is one undo step", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 90, y: 40 });
		expect(await planner.buildingCount()).toBeGreaterThan(1);
		await page.keyboard.press("Control+z");
		expect(await planner.buildingCount()).toBe(0);
	});

	test("an undone run isn't rebuilt when a later run connects near it", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 40 });
		await page.keyboard.press("Control+z");
		await planner.dragCells({ x: 80, y: 45 }, { x: 80, y: 120 });
		const pieces = await planner.buildings();
		expect(pieces.length).toBeGreaterThan(0);
		// The undone run sat at y=40; everything left should belong to the new run (y >= 45).
		for (const piece of pieces) expect(piece.y, `${piece.id} at ${piece.x},${piece.y}`).toBeGreaterThanOrEqual(45);
	});

	test("a deleted segment isn't rebuilt when a later run connects to its run", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 40 });
		const segment = (await planner.buildings()).find((b) => b.x === 20);
		await planner.clickCell(segment.x + 1, 40);
		await page.keyboard.press("Delete");
		await planner.dragCells({ x: 80, y: 40 }, { x: 80, y: 100 });
		const pieces = await planner.buildings();
		expect(pieces.some((b) => b.x === 20 && b.w > b.h)).toBe(false);
	});

	test("corners still merge after the board is cleared", async ({ page, planner }) => {
		page.on("dialog", (dialog) => dialog.accept());
		await page.locator('[data-path-type-option="walls"]').click();
		const kit = await page.evaluate(() => __planner.RUN_KITS[__planner.styleSelect.value].walls);
		const drawCorner = async () => {
			await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 40 });
			await planner.dragCells({ x: 80, y: 40 }, { x: 80, y: 100 });
		};
		await drawCorner();
		await page.locator("[data-clear-board]").click();
		expect(await planner.buildingCount()).toBe(0);
		await drawCorner();
		expect((await planner.buildings()).map((b) => b.id)).toContain(kit.turn.id);
	});

	test("every style has a walls kit", async ({ page }) => {
		const missing = await page.evaluate(() => __planner.STYLE_FILES.filter((style) => !__planner.RUN_KITS[style.file]?.walls).map((s) => s.file));
		expect(missing).toEqual([]);
	});

	// The reported bug: Caledonia's corner piece only opens two ways, and
	// every corner of a loop used to be placed facing the same way.
	test("Caledonia: each corner of a loop gets the corner piece turned to fit", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 40 });
		await planner.dragCells({ x: 80, y: 40 }, { x: 80, y: 100 });
		await planner.dragCells({ x: 80, y: 100 }, { x: 20, y: 100 });
		await planner.dragCells({ x: 20, y: 100 }, { x: 20, y: 40 });
		const corners = (await page.evaluate(() => __planner.placedSquares.map((b) => ({ id: b.id, rotation: b.rotation }))))
			.filter((b) => b.id === "walls_corners_corner_a");
		expect(corners.map((c) => c.rotation).sort()).toEqual([0, 1, 2, 3]);
	});

	test("a run ending on another's side gets a tee piece", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 100, y: 40 });
		await planner.dragCells({ x: 60, y: 100 }, { x: 60, y: 44 });
		expect((await planner.buildings()).map((b) => b.id)).toContain("walls_tee");
	});

	test("holding Alt places a run without snapping, so no tee piece", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="walls"]').click();
		await planner.dragCells({ x: 20, y: 40 }, { x: 100, y: 40 });
		await planner.dragCells({ x: 60, y: 100 }, { x: 60, y: 44 }, { modifiers: ["Alt"] });
		const ids = (await planner.buildings()).map((b) => b.id);
		expect(ids).not.toContain("walls_tee");
		expect(ids.length).toBeGreaterThan(2);
	});
});

test.describe("road pieces (Caledonia)", () => {
	for (const type of ["roads", "alleys", "avenues", "birail", "monorail"]) {
		test(`${type}: a run places real straight pieces, and a turn gets the turn piece`, async ({ page, planner }) => {
			await page.locator(`[data-path-type-option="${type}"]`).click();
			await planner.dragCells({ x: 20, y: 60 }, { x: 100, y: 60 });
			await planner.dragCells({ x: 100, y: 60 }, { x: 100, y: 140 });
			const kit = await page.evaluate((t) => __planner.RUN_KITS["styles/caledonia.json"][t], type);
			const pieces = await planner.buildings();
			const ids = new Set(pieces.map((p) => p.id));
			expect(ids.has(kit.turn.id)).toBe(true);
			for (const id of ids) expect([kit.turn.id, ...kit.segments.map((s) => s.id)]).toContain(id);
			expect(await planner.paths()).toHaveLength(0); // pieces, not paint
		});
	}

	test("crossing runs get a cross piece, and a whole run is one undo step", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="roads"]').click();
		await planner.dragCells({ x: 20, y: 60 }, { x: 100, y: 60 });
		const afterFirst = await planner.buildingCount();
		await planner.dragCells({ x: 60, y: 20 }, { x: 60, y: 100 });
		expect((await planner.buildings()).map((b) => b.id)).toContain("roads_cross");
		await page.keyboard.press("Control+z");
		expect(await planner.buildingCount()).toBe(afterFirst);
	});

	test("turned pieces keep their rotation through save and reload", async ({ page, planner }) => {
		await page.locator('[data-path-type-option="roads"]').click();
		await planner.dragCells({ x: 20, y: 60 }, { x: 100, y: 60 });
		await planner.dragCells({ x: 100, y: 60 }, { x: 100, y: 140 });
		const rotations = () => page.evaluate(() => __planner.placedSquares.map((b) => `${b.id}@${b.x},${b.y}r${b.rotation}`).sort());
		const before = await rotations();
		expect(before.some((r) => r.startsWith("roads_corner") && !r.endsWith("r0"))).toBe(true);
		await planner.waitForAutosave();
		await planner.reload();
		expect(await rotations()).toEqual(before);
	});
});
