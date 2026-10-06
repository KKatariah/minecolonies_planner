// Planner: the shape tray, placing/selecting/moving/rotating/deleting
// buildings, copy/paste, undo/redo, and the grid view (pan/zoom).

const { test, expect } = require("./fixtures");

// Caledonia (the default style) - all 13x13 unless noted.
const FARMER = "horticulture_farmer";
const FLORIST = "horticulture_florist";
const RESIDENCE = "fundamentals_residence"; // 19x13 - non-square, for rotation

test.beforeEach(async ({ planner }) => {
	await planner.goto();
});

test.describe("shape tray", () => {
	test("starts on Farming with every tab rendered", async ({ page }) => {
		await expect(page.locator(".tab")).toHaveText([
			"Farming", "Craftsmanship", "Decoration", "Education", "Fundamentals",
			"Infrastructure", "Military", "Mystic", "Walls", "Roads & Rivers",
		]);
		await expect(page.locator(".tab.is-active")).toHaveText("Farming");
		const expected = await page.evaluate(
			() => shapes.filter((s) => (s.category || "farming") === "farming").length,
		);
		await expect(page.locator(".shape-option")).toHaveCount(expected);
	});

	test("each tab shows exactly its own category's shapes", async ({ page, planner }) => {
		for (const tab of ["craftsmanship", "decoration", "education", "fundamentals", "infrastructure", "military", "mystic", "walls"]) {
			await planner.openTab(tab);
			const ids = await page.locator(".shape-option").evaluateAll((els) => els.map((e) => e.dataset.shapeId));
			const expected = await page.evaluate((t) => shapes.filter((s) => s.category === t).map((s) => s.id), tab);
			expect(ids, tab).toEqual(expected);
			expect(ids.length, tab).toBeGreaterThan(0);
		}
	});

	test("subcategory filters narrow the tray and 'All' restores it", async ({ page }) => {
		const all = await page.locator(".shape-option").count();
		await page.locator(".subtab-bar button", { hasText: "Husbandry" }).click();
		const husbandry = await page.locator(".shape-option").evaluateAll((els) => els.map((e) => e.dataset.shapeId));
		expect(husbandry.length).toBeGreaterThan(0);
		expect(husbandry.length).toBeLessThan(all);
		expect(husbandry.every((id) => id.startsWith("husbandry_"))).toBe(true);
		await page.locator(".subtab-bar button", { hasText: "All" }).click();
		await expect(page.locator(".shape-option")).toHaveCount(all);
	});

	test("search matches labels across every category, case-insensitively", async ({ page }) => {
		await page.locator(".shape-search-input").fill("TOWN HALL");
		const labels = await page.locator(".shape-option .shape-label").allTextContents();
		expect(labels).toContain("Town Hall");
		expect(labels.every((l) => l.toLowerCase().includes("town hall"))).toBe(true);

		await page.locator(".shape-search-input").fill("zzz-no-such-building");
		await expect(page.locator(".shape-option")).toHaveCount(0);

		await page.locator(".shape-search-input").fill("");
		await expect(page.locator(".tab.is-active")).toHaveText("Farming");
		expect(await page.locator(".shape-option").count()).toBeGreaterThan(0);
	});

	test("picking a search result from the Roads tab disarms the road tool", async ({ page, planner }) => {
		await planner.openTab("roads");
		expect(await page.evaluate(() => pathToolActive)).toBe(true);
		await page.locator(".shape-search-input").fill("farmer");
		await page.locator(`.shape-option[data-shape-id="${FARMER}"]`).click();
		expect(await page.evaluate(() => ({ tool: pathToolActive, tab: activeTab, selected: selectedShapeId }))).toEqual({
			tool: false,
			tab: "farming",
			selected: FARMER,
		});
	});

	test("selecting a shape shows its preview and cost card; clicking again deselects", async ({ page }) => {
		const option = page.locator(`.shape-option[data-shape-id="${FARMER}"]`);
		await option.click();
		await expect(option).toHaveClass(/is-selected/);
		await expect(page.locator("[data-preview-name]")).toHaveText("Farmer");
		const cost = page.locator("[data-cost-card]");
		await expect(cost).toBeVisible();
		await expect(cost.locator(".cost-card__level-button")).toHaveText(["Lvl 1", "Lvl 2", "Lvl 3", "Lvl 4", "Lvl 5"]);
		await expect(cost.locator(".cost-card__level-button.is-active")).toHaveText("Lvl 1");
		await expect(cost).toContainText("Total to reach Level 1");
		await expect(cost).toContainText("Upgrade cost to Level 2");

		await cost.locator(".cost-card__level-button", { hasText: "Lvl 5" }).click();
		await expect(cost.locator(".cost-card__level-button.is-active")).toHaveText("Lvl 5");
		await expect(cost).toContainText("Max level reached");

		await option.click();
		await expect(option).not.toHaveClass(/is-selected/);
		await expect(page.locator("[data-preview-name]")).toHaveText("Select a building");
		await expect(cost).toBeHidden();
	});

	test("R rotates the armed shape before placing", async ({ page, planner }) => {
		await planner.armShape(RESIDENCE);
		const dims = page.locator(`.shape-option[data-shape-id="${RESIDENCE}"] .shape-dimensions`);
		await expect(dims).toHaveText("19×13");
		await page.keyboard.press("r");
		await expect(dims).toHaveText("13×19 ↻");
		await planner.clickCell(20, 20);
		await expect.poll(() => planner.buildingCount()).toBe(1);
		const [b] = await planner.buildings();
		expect(b).toMatchObject({ id: RESIDENCE, x: 20, y: 20, w: 13, h: 19, rotated: true });
	});
});

test.describe("placing buildings", () => {
	test("click places the armed shape with its top-left at the clicked cell", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 12);
		const [b] = await planner.buildings();
		expect(b).toMatchObject({
			id: FARMER, label: "Farmer", x: 10, y: 12, w: 13, h: 13,
			category: "farming", styleFile: "styles/caledonia.json", rotated: false,
		});
		const el = page.locator(".placed-square");
		await expect(el).toHaveCount(1);
		await expect(el).toHaveClass(/category-farming/);
		await expect(el.locator(".placed-badge")).toHaveText("Farmer");
		// Tray selection is consumed by the placement.
		await expect(page.locator(".shape-option.is-selected")).toHaveCount(0);
	});

	test("clicking the grid with nothing armed places nothing", async ({ planner }) => {
		await planner.clickCell(30, 30);
		expect(await planner.buildingCount()).toBe(0);
	});

	test("overlapping placements are rejected, touching ones allowed", async ({ planner }) => {
		await planner.place(FARMER, 10, 10);
		await planner.armShape(FLORIST);
		// Empty cell, but a 13x13 footprint from here overlaps the farmer.
		// (Clicking ON the farmer would select it instead of placing.)
		await planner.clickCell(5, 5);
		await planner.page.waitForTimeout(100);
		expect(await planner.buildingCount()).toBe(1);
		await planner.clickCell(23, 10); // exactly adjacent (10 + 13)
		await expect.poll(() => planner.buildingCount()).toBe(2);
	});

	test("Ctrl+click snaps to 16-block chunk boundaries", async ({ planner }) => {
		// macOS turns Ctrl+click into a right-click (contextmenu, no click
		// event) - the Cmd test below is what covers Mac users.
		test.skip(process.platform === "darwin", "Ctrl+click is a right-click on macOS");
		await planner.armShape(FARMER);
		await planner.clickCell(37, 21, { modifiers: ["Control"] });
		await expect.poll(() => planner.buildingCount()).toBe(1);
		expect((await planner.buildings())[0]).toMatchObject({ x: 32, y: 16 });
	});

	test("Cmd+click snaps to chunk boundaries too (the Mac equivalent)", async ({ planner }) => {
		await planner.armShape(FARMER);
		await planner.clickCell(37, 21, { modifiers: ["Meta"] });
		await expect.poll(() => planner.buildingCount()).toBe(1);
		expect((await planner.buildings())[0]).toMatchObject({ x: 32, y: 16 });
	});

	test("Cmd-held paste stamps snap to chunk boundaries", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await planner.clickCell(15, 15);
		await page.keyboard.press("Control+c");
		await page.keyboard.press("Control+v");
		await planner.clickCell(70, 50, { modifiers: ["Meta"] });
		await expect.poll(() => planner.buildingCount()).toBe(2);
		expect((await planner.buildings())[1]).toMatchObject({ x: 64, y: 48 });
	});

	test("the plan check reacts to what's placed", async ({ page, planner }) => {
		const check = page.locator("[data-plan-check]");
		await expect(check).toContainText("Place some buildings");

		await planner.place("fundamentals_townhall", 10, 10);
		await expect(check.locator(".plan-check__item--ok")).toContainText(["Town Hall"]);
		await expect(check.locator(".plan-check__item--warn")).toHaveCount(4);

		await planner.place(RESIDENCE, 40, 10);
		await expect(check).toContainText("No guard buildings yet");

		await planner.place("military_guardtower", 70, 10);
		await expect(check).toContainText("1 guard building for 1 housing building");
		await expect(check.locator(".plan-check__item--warn", { hasText: "Housing" })).toHaveCount(0);
	});
});

test.describe("selecting and editing", () => {
	test.beforeEach(async ({ planner }) => {
		await planner.place(FARMER, 10, 10);
	});

	test("clicking a building selects it and previews it; clicking empty grid deselects", async ({ page, planner }) => {
		await planner.clickCell(15, 15);
		await expect(page.locator(".placed-square.is-selected")).toHaveCount(1);
		await expect(page.locator("[data-preview-name]")).toHaveText("Farmer");
		await planner.clickCell(60, 60);
		await expect(page.locator(".placed-square.is-selected")).toHaveCount(0);
	});

	test("right-click opens the action menu; Rotate and Delete work", async ({ page, planner }) => {
		await planner.place(RESIDENCE, 40, 10); // 19x13
		const p = await planner.cellPoint(45, 15);
		await page.mouse.click(p.x, p.y, { button: "right" });
		const menu = page.locator(".action-menu");
		await expect(menu).toBeVisible();

		await menu.locator('[data-action="rotate"]').click();
		const res = (await planner.buildings()).find((b) => b.id === RESIDENCE);
		expect(res).toMatchObject({ w: 13, h: 19, rotated: true });
		// Rotation pivots around the center: (40 + 9.5 - 6.5, 10 + 6.5 - 9.5).
		expect(res).toMatchObject({ x: 43, y: 7 });

		await menu.locator('[data-action="delete"]').click();
		expect((await planner.buildings()).map((b) => b.id)).toEqual([FARMER]);
	});

	test("rotate is refused when the rotated footprint would collide", async ({ page, planner }) => {
		await planner.place(RESIDENCE, 30, 10); // 19x13 at x 30..48
		await planner.place(FLORIST, 36, 23); // directly below its middle
		const p = await planner.cellPoint(35, 15);
		await page.mouse.click(p.x, p.y, { button: "right" });
		await page.locator('.action-menu [data-action="rotate"]').click();
		const res = (await planner.buildings()).find((b) => b.id === RESIDENCE);
		expect(res).toMatchObject({ x: 30, y: 10, w: 19, h: 13, rotated: false });
	});

	test("R rotates the selected building on the grid, and undo restores it", async ({ page, planner }) => {
		await planner.place(RESIDENCE, 40, 10); // 19x13
		await planner.clickCell(45, 15);
		await page.keyboard.press("r");
		expect((await planner.buildings()).find((b) => b.id === RESIDENCE)).toMatchObject({
			x: 43, y: 7, w: 13, h: 19, rotated: true,
		});
		// A keyboard rotate doesn't pop the action menu open.
		await expect(page.locator(".action-menu")).toBeHidden();
		await page.keyboard.press("Shift+R");
		expect((await planner.buildings()).find((b) => b.id === RESIDENCE)).toMatchObject({
			x: 40, y: 10, w: 19, h: 13, rotated: false,
		});
		await page.keyboard.press("Control+z");
		expect((await planner.buildings()).find((b) => b.id === RESIDENCE)).toMatchObject({ w: 13, h: 19, rotated: true });
	});

	test("R on a selected building keeps the open action menu attached to it", async ({ page, planner }) => {
		await planner.place(RESIDENCE, 40, 10);
		const p = await planner.cellPoint(45, 15);
		await page.mouse.click(p.x, p.y, { button: "right" });
		const menu = page.locator(".action-menu");
		await expect(menu).toBeVisible();
		const before = await menu.boundingBox();
		await page.keyboard.press("r");
		await expect(menu).toBeVisible();
		expect(await menu.boundingBox()).not.toEqual(before);
	});

	test("R prefers the armed tray shape over the selected building", async ({ page, planner }) => {
		await planner.place(RESIDENCE, 40, 10);
		await planner.clickCell(45, 15);
		await planner.armShape(FLORIST);
		await page.keyboard.press("r");
		expect((await planner.buildings()).find((b) => b.id === RESIDENCE)).toMatchObject({ w: 19, h: 13 });
		expect(await page.evaluate(() => pendingRotated)).toBe(true);
	});

	test("R does nothing when the rotated footprint would collide", async ({ page, planner }) => {
		await planner.place(RESIDENCE, 30, 10);
		await planner.place(FLORIST, 36, 23);
		await planner.clickCell(35, 15);
		await page.keyboard.press("r");
		expect((await planner.buildings()).find((b) => b.id === RESIDENCE)).toMatchObject({ w: 19, h: 13, rotated: false });
	});

	test("Ctrl/Cmd+R is left to the browser, not treated as rotate", async ({ page, planner }) => {
		await planner.armShape(RESIDENCE);
		const prevented = await page.evaluate(() => {
			const results = [];
			for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
				const e = new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true, ...mod });
				document.body.dispatchEvent(e);
				results.push(e.defaultPrevented);
			}
			return { results, rotated: pendingRotated };
		});
		expect(prevented).toEqual({ results: [false, false], rotated: false });
	});

	test("Delete and Backspace remove the selection", async ({ page, planner }) => {
		await planner.place(FLORIST, 40, 10);
		await planner.clickCell(15, 15);
		await page.keyboard.press("Delete");
		expect((await planner.buildings()).map((b) => b.id)).toEqual([FLORIST]);
		await planner.clickCell(45, 15);
		await page.keyboard.press("Backspace");
		expect(await planner.buildingCount()).toBe(0);
	});

	test("Delete while typing in a text field does not delete buildings", async ({ page, planner }) => {
		await planner.clickCell(15, 15);
		await page.locator("[data-plan-name-input]").fill("abc");
		await page.locator("[data-plan-name-input]").press("Backspace");
		expect(await planner.buildingCount()).toBe(1);
	});

	test("arrow keys nudge by one block and stop at edges and other buildings", async ({ page, planner }) => {
		await planner.clickCell(15, 15);
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		expect((await planner.buildings())[0]).toMatchObject({ x: 11, y: 12 });

		// Blocked by a neighbor placed flush to the right.
		await planner.place(FLORIST, 24, 12);
		await planner.clickCell(15, 15);
		await page.keyboard.press("ArrowRight");
		expect((await planner.buildings())[0]).toMatchObject({ x: 11, y: 12 });

		// Blocked by the grid's top edge.
		for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowUp");
		expect((await planner.buildings())[0]).toMatchObject({ x: 11, y: 0 });
	});

	test("shift-click builds a multi-selection that moves together", async ({ page, planner }) => {
		await planner.place(FLORIST, 40, 10);
		await planner.clickCell(15, 15);
		await planner.clickCell(45, 15, { modifiers: ["Shift"] });
		expect((await planner.selectedIds()).length).toBe(2);
		await page.keyboard.press("ArrowDown");
		expect((await planner.buildings()).map((b) => b.y)).toEqual([11, 11]);
		// Shift-click again toggles one back out.
		await planner.clickCell(45, 16, { modifiers: ["Shift"] });
		expect(await planner.selectedIds()).toEqual([`${FARMER}@10,11`]);
	});

	test("left-drag on empty grid marquee-selects; Shift adds to the selection", async ({ page, planner }) => {
		await planner.place(FLORIST, 40, 10);
		await planner.place("husbandry_cowboy", 70, 10);
		await planner.dragCells({ x: 5, y: 5 }, { x: 45, y: 15 });
		expect((await planner.selectedIds()).sort()).toEqual([`${FARMER}@10,10`, `${FLORIST}@40,10`].sort());
		await expect(page.locator(".marquee-select")).toBeHidden();

		await planner.dragCells({ x: 75, y: 40 }, { x: 72, y: 20 }, { modifiers: ["Shift"] });
		expect((await planner.selectedIds()).length).toBe(3);

		await planner.dragCells({ x: 75, y: 40 }, { x: 72, y: 20 });
		expect(await planner.selectedIds()).toEqual(["husbandry_cowboy@70,10"]);
	});

	test("dragging a building moves it, with its center following the cursor", async ({ planner }) => {
		await planner.dragCells({ x: 16, y: 16 }, { x: 46, y: 26 });
		expect((await planner.buildings())[0]).toMatchObject({ x: 40, y: 20 });
		expect((await planner.undoRedoState()).undo).toBe(2); // place + move
	});

	test("dragging onto another building is refused", async ({ planner }) => {
		await planner.place(FLORIST, 40, 10);
		await planner.dragCells({ x: 16, y: 16 }, { x: 46, y: 16 });
		const farmer = (await planner.buildings()).find((b) => b.id === FARMER);
		expect(farmer.x + farmer.w <= 40 || farmer.y >= 23 || farmer.y + farmer.h <= 10).toBe(true);
	});

	test("Duplicate arms a copy that the next click stamps down", async ({ page, planner }) => {
		const p = await planner.cellPoint(15, 15);
		await page.mouse.click(p.x, p.y, { button: "right" });
		await page.locator('.action-menu [data-action="duplicate"]').click();
		await planner.clickCell(50, 50);
		await expect.poll(() => planner.buildingCount()).toBe(2);
		expect((await planner.buildings())[1]).toMatchObject({ id: FARMER, x: 50, y: 50 });
		// One-shot: another click doesn't stamp again.
		await planner.clickCell(80, 80);
		await page.waitForTimeout(100);
		expect(await planner.buildingCount()).toBe(2);
	});

	test("Ctrl+C / Ctrl+V pastes a multi-selection repeatedly, keeping relative offsets", async ({ page, planner }) => {
		await planner.place(FLORIST, 30, 15);
		await planner.clickCell(15, 15);
		await planner.clickCell(35, 20, { modifiers: ["Shift"] });
		await page.keyboard.press("Control+c");

		await page.keyboard.press("Control+v");
		await planner.clickCell(60, 60);
		await expect.poll(() => planner.buildingCount()).toBe(4);
		await page.keyboard.press("Control+v");
		await planner.clickCell(60, 100);
		await expect.poll(() => planner.buildingCount()).toBe(6);

		const placed = await planner.buildings();
		const pasted = placed.slice(2);
		for (let i = 0; i < pasted.length; i += 2) {
			const [a, b] = pasted[i].id === FLORIST ? [pasted[i + 1], pasted[i]] : [pasted[i], pasted[i + 1]];
			// Florist sits 20 right / 5 down from the farmer in the original.
			expect({ dx: b.x - a.x, dy: b.y - a.y }).toEqual({ dx: 20, dy: 5 });
		}
	});

	test("a paste that would overlap something is refused", async ({ page, planner }) => {
		await planner.clickCell(15, 15);
		await page.keyboard.press("Control+c");
		await page.keyboard.press("Control+v");
		await planner.clickCell(12, 12);
		await page.waitForTimeout(100);
		expect(await planner.buildingCount()).toBe(1);
	});
});

test.describe("undo / redo", () => {
	test("buttons start disabled and track the history", async ({ page, planner }) => {
		const undo = page.locator("[data-undo]");
		const redo = page.locator("[data-redo]");
		await expect(undo).toBeDisabled();
		await expect(redo).toBeDisabled();

		await planner.place(FARMER, 10, 10);
		await planner.place(FLORIST, 40, 10);
		await expect(undo).toBeEnabled();

		await undo.click();
		await expect.poll(() => planner.buildingCount()).toBe(1);
		await expect(redo).toBeEnabled();
		await undo.click();
		await expect.poll(() => planner.buildingCount()).toBe(0);
		await expect(undo).toBeDisabled();

		await redo.click();
		await redo.click();
		await expect.poll(() => planner.buildingCount()).toBe(2);
		await expect(redo).toBeDisabled();
	});

	test("keyboard shortcuts: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and Cmd+Z", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await page.keyboard.press("Control+z");
		await expect.poll(() => planner.buildingCount()).toBe(0);
		await page.keyboard.press("Control+Shift+z");
		await expect.poll(() => planner.buildingCount()).toBe(1);
		await page.keyboard.press("Meta+z");
		await expect.poll(() => planner.buildingCount()).toBe(0);
		await page.keyboard.press("Control+y");
		await expect.poll(() => planner.buildingCount()).toBe(1);
	});

	test("undo restores moves, rotations and deletions exactly", async ({ page, planner }) => {
		await planner.place(RESIDENCE, 10, 10);
		const original = await planner.buildings();
		await planner.clickCell(15, 15);
		await page.keyboard.press("ArrowRight");
		const p = await planner.cellPoint(16, 15);
		await page.mouse.click(p.x, p.y, { button: "right" });
		await page.locator('.action-menu [data-action="rotate"]').click();
		await page.keyboard.press("Delete");
		expect(await planner.buildingCount()).toBe(0);

		await page.keyboard.press("Control+z"); // delete
		await page.keyboard.press("Control+z"); // rotate
		await page.keyboard.press("Control+z"); // nudge
		await expect.poll(() => planner.buildings()).toEqual(original);
	});

	test("a new edit after undo clears the redo stack", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await page.keyboard.press("Control+z");
		expect((await planner.undoRedoState()).redo).toBe(1);
		await planner.place(FLORIST, 40, 10);
		expect((await planner.undoRedoState()).redo).toBe(0);
		await expect(page.locator("[data-redo]")).toBeDisabled();
	});

	test("history is capped at 50 states", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await planner.clickCell(15, 15);
		for (let i = 0; i < 60; i++) await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight");
		expect((await planner.undoRedoState()).undo).toBe(50);
	});
});

test.describe("clear board", () => {
	test("does nothing (and asks nothing) on an empty board", async ({ page }) => {
		let dialogs = 0;
		page.on("dialog", (d) => {
			dialogs++;
			d.dismiss();
		});
		await page.locator("[data-clear-board]").click();
		expect(dialogs).toBe(0);
	});

	test("asks first, and is undoable", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await planner.place(FLORIST, 40, 10);

		page.once("dialog", (d) => {
			expect(d.message()).toContain("removes all 2 buildings and 0 roads");
			d.dismiss();
		});
		await page.locator("[data-clear-board]").click();
		expect(await planner.buildingCount()).toBe(2);

		page.once("dialog", (d) => d.accept());
		await page.locator("[data-clear-board]").click();
		await expect.poll(() => planner.buildingCount()).toBe(0);
		await expect(page.locator(".placed-square")).toHaveCount(0);

		await page.keyboard.press("Control+z");
		await expect.poll(() => planner.buildingCount()).toBe(2);
	});
});

test.describe("styles", () => {
	test("switching style swaps the tray but keeps placed buildings on their own style", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await planner.selectStyle("Medieval Spruce");
		await expect(page.locator(".style-select")).toHaveValue("styles/medievalspruce.json");
		const trayIds = await page.locator(".shape-option").evaluateAll((els) => els.map((e) => e.dataset.shapeId));
		expect(trayIds).toContain("husbandry_altcowboy"); // only exists in Medieval Spruce

		await planner.place("husbandry_altcowboy", 40, 10);
		const placed = await planner.buildings();
		expect(placed.map((b) => [b.id, b.styleFile, b.w, b.h])).toEqual([
			[FARMER, "styles/caledonia.json", 13, 13],
			["husbandry_altcowboy", "styles/medievalspruce.json", 17, 21],
		]);

		// Selecting the Caledonia building previews Caledonia data, not the
		// same-id Medieval Spruce shape (which is 21x23).
		await planner.clickCell(15, 15);
		await expect(page.locator("[data-preview-name]")).toHaveText("Farmer");
		const previewed = await page.evaluate(() => {
			const s = getPreviewedShape();
			return { w: s.w, h: s.h };
		});
		expect(previewed).toEqual({ w: 13, h: 13 });
	});

	test("every style loads every tab with no errors", async ({ planner }) => {
		for (const label of ["Medieval Spruce", "Caledonia"]) {
			await planner.selectStyle(label);
			for (const tab of ["farming", "craftsmanship", "decoration", "education", "fundamentals", "infrastructure", "military", "mystic", "walls"]) {
				await planner.openTab(tab);
			}
		}
	});
});

test.describe("grid view", () => {
	test("zoom buttons zoom in/out within limits and reset to 1", async ({ page }) => {
		const zoom = () => page.evaluate(() => gridZoom);
		await page.locator("[data-zoom-in]").click();
		expect(await zoom()).toBeCloseTo(1.25);
		await page.locator("[data-zoom-out]").click();
		await page.locator("[data-zoom-out]").click();
		expect(await zoom()).toBeCloseTo(0.8);
		for (let i = 0; i < 10; i++) await page.locator("[data-zoom-out]").click();
		expect(await zoom()).toBe(0.5);
		for (let i = 0; i < 20; i++) await page.locator("[data-zoom-in]").click();
		expect(await zoom()).toBe(4);
		await page.locator("[data-zoom-reset]").click();
		expect(await zoom()).toBe(1);
	});

	test("Ctrl+wheel zooms; plain wheel scrolls", async ({ page, planner }) => {
		const p = await planner.cellPoint(50, 50);
		await page.mouse.move(p.x, p.y);
		await page.keyboard.down("Control");
		await page.mouse.wheel(0, -100);
		await page.keyboard.up("Control");
		await expect.poll(() => page.evaluate(() => gridZoom)).toBeGreaterThan(1);

		await page.mouse.wheel(0, 300);
		await expect.poll(() => page.evaluate(() => root.scrollTop)).toBeGreaterThan(0);
	});

	test("placement still lands on the right cell when zoomed", async ({ page, planner }) => {
		await page.locator("[data-zoom-in]").click();
		await page.locator("[data-zoom-in]").click();
		await page.evaluate(() => root.scrollTo(0, 0)); // zoom anchors on the viewport center
		await planner.place(FARMER, 20, 20);
		expect((await planner.buildings())[0]).toMatchObject({ x: 20, y: 20 });
	});

	test("right-drag pans the map without selecting anything", async ({ page, planner }) => {
		await planner.dragCells({ x: 100, y: 80 }, { x: 40, y: 30 }, { button: "right" });
		const scroll = await page.evaluate(() => ({ left: root.scrollLeft, top: root.scrollTop }));
		expect(scroll.left).toBeGreaterThan(200);
		expect(scroll.top).toBeGreaterThan(150);
		await expect(page.locator(".placed-square.is-selected")).toHaveCount(0);
	});

	test("go-to coordinates centers the view on a block", async ({ page }) => {
		for (const zoomClicks of [0, 2]) {
			for (let i = 0; i < zoomClicks; i++) await page.locator("[data-zoom-in]").click();
			await page.locator("[data-goto-x]").fill("300");
			await page.locator("[data-goto-z]").fill("250");
			await page.locator("[data-goto-form] button").click();
			// The viewport's center point should resolve to that exact block.
			const cell = await page.evaluate(() => {
				const rect = root.getBoundingClientRect();
				return getCellFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
			});
			expect(cell, `after ${zoomClicks} zoom-ins`).toEqual({ x: 300, y: 250 });
		}
	});

	test("a click anywhere inside a drawn cell maps to that cell", async ({ page }) => {
		// Cells are drawn inside .grid's border - check both the first and
		// last on-screen pixel of a cell, at normal and zoomed-in scale.
		for (const zoomClicks of [0, 3]) {
			for (let i = 0; i < zoomClicks; i++) await page.locator("[data-zoom-in]").click();
			const cells = await page.evaluate(() => {
				const r = grid.getBoundingClientRect();
				const size = cellSize * gridZoom;
				const left = r.left + grid.clientLeft * gridZoom + 10 * size;
				const top = r.top + grid.clientTop * gridZoom + 10 * size;
				return [
					getCellFromPoint(left + 0.25, top + 0.25),
					getCellFromPoint(left + size - 0.25, top + size - 0.25),
				];
			});
			expect(cells, `after ${zoomClicks} zoom-ins`).toEqual([{ x: 10, y: 10 }, { x: 10, y: 10 }]);
		}
	});

	test("hovering the grid shows block coordinates", async ({ page, planner }) => {
		const p = await planner.cellPoint(42, 17);
		await page.mouse.move(p.x, p.y);
		await expect(page.locator("[data-hover-coords]")).toBeVisible();
		await expect(page.locator("[data-hover-coords]")).toContainText("Block (42, 17)");
	});
});
