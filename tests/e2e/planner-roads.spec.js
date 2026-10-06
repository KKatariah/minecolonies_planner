// Planner: the "Roads & Rivers" tab - paint brush, eraser, path types,
// selecting/moving/deleting painted paths, and the walls tool that places
// real schematic wall pieces along a dragged line.

const { test, expect } = require("./fixtures");

const cellKeys = (path) => new Set(path.cells.map((c) => `${c.x},${c.y}`));

// Every cell in the width x width square the brush stamps around (cx, cy).
function square(cx, cy, width) {
	const r = Math.floor(width / 2);
	const out = [];
	for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) out.push(`${cx + dx},${cy + dy}`);
	return out;
}

test.beforeEach(async ({ planner }) => {
	await planner.goto();
	await planner.openTab("roads");
});

test.describe("tool controls", () => {
	test("the Roads tab swaps the tray for the brush controls and arms the tool", async ({ page }) => {
		await expect(page.locator(".shape-tray .path-controls")).toBeVisible();
		await expect(page.locator(".shape-option")).toHaveCount(0);
		expect(await page.evaluate(() => pathToolActive)).toBe(true);

		const types = await page.locator("[data-path-type-option]").evaluateAll((els) => els.map((e) => e.dataset.pathTypeOption));
		expect(types[0]).toBe("default");
		expect(types).toContain("canal");
		expect(types[types.length - 1]).toBe("walls");
		await expect(page.locator(".path-type-swatch.is-active")).toHaveAttribute("data-path-type-option", "default");
		await expect(page.locator("[data-path-width-input]")).toHaveValue("5");
	});

	test("leaving the tab disarms the tool and turns the eraser back off", async ({ page, planner }) => {
		await page.locator("[data-path-erase-toggle]").click();
		await expect(page.locator("[data-path-erase-toggle]")).toHaveText("Eraser (on)");
		await planner.openTab("farming");
		expect(await page.evaluate(() => ({ tool: pathToolActive, erase: pathEraseMode }))).toEqual({ tool: false, erase: false });
		await planner.openTab("roads");
		await expect(page.locator("[data-path-erase-toggle]")).toHaveText("Eraser");
	});

	test("width input is clamped to 1-10", async ({ page }) => {
		const width = page.locator("[data-path-width-input]");
		for (const [typed, expected] of [["15", "10"], ["0", "1"], ["-4", "1"], ["3.6", "4"], ["7", "7"]]) {
			await width.fill(typed);
			await width.dispatchEvent("change");
			await expect(width).toHaveValue(expected);
		}
		expect(await page.evaluate(() => pathWidth)).toBe(7);
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
		expect(await page.evaluate(() => pendingRotated)).toBe(false);
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

	test("brush widths paint the exact requested footprint", async ({ page, planner }) => {
		for (const [i, width] of [1, 3, 9].entries()) {
			await page.locator("[data-path-width-input]").fill(String(width));
			await page.locator("[data-path-width-input]").dispatchEvent("change");
			await planner.clickCell(20 + i * 20, 60);
			const p = (await planner.paths())[i];
			expect(p.cells.length, `width ${width}`).toBe(width * width);
		}
	});

	test("every brush width 1-10 paints exactly width x width, matching the eraser preview", async ({ page, planner }) => {
		for (let width = 1; width <= 10; width++) {
			await page.locator("[data-path-width-input]").fill(String(width));
			await page.locator("[data-path-width-input]").dispatchEvent("change");
			const cx = 15 + (width - 1) * 15;
			await planner.clickCell(cx, 40);
			const p = (await planner.paths()).at(-1);
			const xs = p.cells.map((c) => c.x);
			const ys = p.cells.map((c) => c.y);
			expect(p.cells.length, `width ${width}`).toBe(width * width);
			expect(Math.max(...xs) - Math.min(...xs) + 1, `width ${width}`).toBe(width);
			expect(Math.max(...ys) - Math.min(...ys) + 1, `width ${width}`).toBe(width);
			// The clicked cell is always inside the stamp.
			expect(xs.includes(cx) && ys.includes(40)).toBe(true);

			// Eraser hover outline covers the same cells a paint stamp does.
			await page.locator("[data-path-erase-toggle]").click();
			const pt = await planner.cellPoint(cx, 80);
			await page.mouse.move(pt.x, pt.y);
			const box = await page.evaluate(() => ({
				x: parseFloat(eraserHoverEl.style.left) / cellSize,
				w: parseFloat(eraserHoverEl.style.width) / cellSize,
			}));
			expect(box, `eraser preview, width ${width}`).toEqual({ x: Math.min(...xs), w: width });
			await page.locator("[data-path-erase-toggle]").click();
		}
	});

	test("a drag paints one continuous stroke with no gaps", async ({ planner }) => {
		await planner.dragCells({ x: 20, y: 20 }, { x: 90, y: 50 }, { steps: 4 });
		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		const keys = cellKeys(paths[0]);
		// Interpolation between sparse pointer samples: every column from
		// start to end has paint in it.
		for (let x = 20; x <= 90; x++) {
			expect([...keys].some((k) => k.startsWith(`${x},`)), `column ${x}`).toBe(true);
		}
	});

	test("holding Shift locks the stroke to a straight line", async ({ planner }) => {
		await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 47 }, { modifiers: ["Shift"] });
		const [p] = await planner.paths();
		const ys = new Set(p.cells.map((c) => c.y));
		expect([...ys].sort((a, b) => a - b)).toEqual([38, 39, 40, 41, 42]);
		expect(Math.max(...p.cells.map((c) => c.x))).toBe(82);
	});

	test("the chosen type is recorded on the path and changes its color", async ({ page, planner }) => {
		await planner.clickCell(20, 20);
		await page.locator('[data-path-type-option="canal"]').click();
		await expect(page.locator(".path-type-swatch.is-active")).toHaveAttribute("data-path-type-option", "canal");
		await planner.clickCell(60, 20);
		const paths = await planner.paths();
		expect(paths.map((p) => p.type)).toEqual(["default", "canal"]);
		const colors = await page.locator(".placed-path").evaluateAll((els) =>
			els.map((e) => getComputedStyle(e.firstElementChild).backgroundColor),
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
		await planner.clickCell(100, 60); // a lone 5x5 canal blob
		expect(await planner.paths()).toHaveLength(2);

		await page.locator("[data-path-erase-toggle]").click();
		await expect(page.locator("[data-path-erase-toggle]")).toHaveClass(/is-active/);
		// Cut the road in two.
		await planner.dragCells({ x: 50, y: 14 }, { x: 50, y: 26 });
		// Wipe out the canal entirely.
		await planner.clickCell(100, 60);

		const paths = await planner.paths();
		expect(paths).toHaveLength(1);
		const road = cellKeys(paths[0]);
		for (const key of square(50, 20, 5)) expect(road.has(key), key).toBe(false);
		expect(road.has("20,20")).toBe(true);
		expect(road.has("80,20")).toBe(true);
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

			const kit = await page.evaluate(() => WALL_KITS[styleSelect.value]);
			const pieces = await planner.buildings();
			expect(pieces.length).toBeGreaterThan(0);
			const segmentIds = kit.segments.map((s) => s.id);
			for (const piece of pieces) {
				expect(segmentIds).toContain(piece.id);
				expect(piece.h).toBe(kit.segmentThickness);
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
		const kit = await page.evaluate(() => WALL_KITS[styleSelect.value]);
		const ids = (await planner.buildings()).map((b) => b.id);
		expect(ids).toContain(kit.cornerId);
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
		const kit = await page.evaluate(() => WALL_KITS[styleSelect.value]);
		const drawCorner = async () => {
			await planner.dragCells({ x: 20, y: 40 }, { x: 80, y: 40 });
			await planner.dragCells({ x: 80, y: 40 }, { x: 80, y: 100 });
		};
		await drawCorner();
		await page.locator("[data-clear-board]").click();
		expect(await planner.buildingCount()).toBe(0);
		await drawCorner();
		expect((await planner.buildings()).map((b) => b.id)).toContain(kit.cornerId);
	});

	test("every style's wall kit references real shapes of the declared size", async ({ page }) => {
		const problems = await page.evaluate(() => {
			const out = [];
			for (const [file, kit] of Object.entries(WALL_KITS)) {
				const shapesInStyle = getStyleShapes(file);
				for (const seg of kit.segments) {
					const s = shapesInStyle.find((x) => x.id === seg.id);
					if (!s) out.push(`${file}: missing ${seg.id}`);
					else if ([s.w, s.h].sort().join() !== [seg.length, kit.segmentThickness].sort().join())
						out.push(`${file}: ${seg.id} is ${s.w}x${s.h}, kit says ${seg.length}x${kit.segmentThickness}`);
				}
				const corner = shapesInStyle.find((x) => x.id === kit.cornerId);
				if (!corner) out.push(`${file}: missing corner ${kit.cornerId}`);
				else if (corner.w !== kit.cornerSize || corner.h !== kit.cornerSize)
					out.push(`${file}: corner is ${corner.w}x${corner.h}, kit says ${kit.cornerSize}`);
			}
			for (const style of STYLE_FILES) if (!WALL_KITS[style.file]) out.push(`no wall kit for ${style.file}`);
			return out;
		});
		expect(problems).toEqual([]);
	});
});
