// Planner: everything that survives a reload or leaves the browser -
// autosave, JSON export/import, PNG export, named "My Plans" slots, and the
// small per-viewer preferences (toggles, collapsed panes, zoom/scroll).

const fs = require("fs");
const { test, expect, Planner } = require("./fixtures");

const FARMER = "horticulture_farmer";
const FLORIST = "horticulture_florist";

test.beforeEach(async ({ planner }) => {
	await planner.goto();
});

// Strips run-specific fields so two plan snapshots can be compared.
const comparable = (plan) => ({
	styleFile: plan.styleFile,
	grid: plan.grid,
	buildings: plan.buildings,
	paths: plan.roads.paths,
});

async function buildSamplePlan(planner) {
	await planner.place(FARMER, 10, 10);
	await planner.place("fundamentals_residence", 40, 10);
	await planner.clickCell(45, 15);
	const p = await planner.cellPoint(45, 15);
	await planner.page.mouse.click(p.x, p.y, { button: "right" });
	await planner.page.locator('.action-menu [data-action="rotate"]').click();
	await planner.openTab("roads");
	await planner.dragCells({ x: 10, y: 60 }, { x: 70, y: 60 });
	await planner.openTab("farming");
}

async function importPlanFile(page, plan, name = "plan.json") {
	await page.locator("[data-import-json]").setInputFiles({
		name,
		mimeType: "application/json",
		buffer: Buffer.from(typeof plan === "string" ? plan : JSON.stringify(plan)),
	});
}

test.describe("autosave", () => {
	test("buildings, rotation and roads survive a reload", async ({ page, planner }) => {
		await buildSamplePlan(planner);
		await planner.waitForAutosave();
		const before = { buildings: await planner.buildings(), paths: await planner.paths() };
		expect(before.buildings.find((b) => b.rotated)).toBeTruthy();

		await planner.reload();
		expect(await planner.buildings()).toEqual(before.buildings);
		expect(await planner.paths()).toEqual(before.paths);
		await expect(page.locator(".placed-square")).toHaveCount(2);
		await expect(page.locator(".placed-path")).toHaveCount(1);
	});

	test("buildings from different styles each keep their style across a reload", async ({ planner }) => {
		await planner.place(FARMER, 10, 10);
		await planner.selectStyle("Medieval Spruce");
		await planner.place(FARMER, 40, 10);
		await planner.waitForAutosave();
		await planner.reload();
		expect((await planner.buildings()).map((b) => [b.styleFile, b.w, b.h])).toEqual([
			["styles/caledonia.json", 13, 13],
			["styles/medievalspruce.json", 21, 23],
		]);
	});

	test("the active style is restored", async ({ page, planner }) => {
		await planner.selectStyle("Medieval Spruce");
		await planner.place(FARMER, 10, 10);
		await planner.waitForAutosave();
		await planner.reload();
		await expect(page.locator(".style-select")).toHaveValue("styles/medievalspruce.json");
	});

	test("an empty board autosaves as empty (clearing isn't undone by a reload)", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await planner.waitForAutosave();
		page.once("dialog", (d) => d.accept());
		await page.locator("[data-clear-board]").click();
		await page.waitForTimeout(700);
		await planner.reload();
		expect(await planner.buildingCount()).toBe(0);
	});

	test("a corrupt autosave doesn't break startup", async ({ page, planner, pageErrors }) => {
		pageErrors.allow(/Failed to restore autosave/);
		await page.evaluate(() => localStorage.setItem(AUTOSAVE_STORAGE_KEY, "{not json"));
		await planner.reload();
		expect(await planner.buildingCount()).toBe(0);
		await planner.place(FARMER, 10, 10); // still fully usable
	});

	test("undo history starts fresh after a reload", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await planner.waitForAutosave();
		await planner.reload();
		await expect(page.locator("[data-undo]")).toBeDisabled();
	});
});

test.describe("JSON export / import", () => {
	test("export downloads the current plan in the save format", async ({ page, planner }) => {
		await buildSamplePlan(planner);
		const downloadPromise = page.waitForEvent("download");
		await page.locator("[data-export-json]").click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/^minecolonies-plan-\d+\.json$/);
		const plan = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
		expect(plan.formatVersion).toBe(1);
		expect(plan.background).toBeNull();
		expect(plan.buildings.map((b) => b.id)).toEqual([FARMER, "fundamentals_residence"]);
		expect(plan.roads.paths).toHaveLength(1);
		const live = await page.evaluate(() => serializePlan());
		expect(comparable(plan)).toEqual(comparable(live));
	});

	test("export -> clear -> import round-trips exactly", async ({ page, planner }) => {
		await buildSamplePlan(planner);
		const downloadPromise = page.waitForEvent("download");
		await page.locator("[data-export-json]").click();
		const file = fs.readFileSync(await (await downloadPromise).path(), "utf8");
		const before = { buildings: await planner.buildings(), paths: await planner.paths() };

		page.once("dialog", (d) => d.accept());
		await page.locator("[data-clear-board]").click();
		expect(await planner.buildingCount()).toBe(0);

		await importPlanFile(page, file);
		await expect.poll(() => planner.buildingCount()).toBe(2);
		expect(await planner.buildings()).toEqual(before.buildings);
		expect(await planner.paths()).toEqual(before.paths);
		// Importing resets history rather than mixing it with the old board.
		await expect(page.locator("[data-undo]")).toBeDisabled();
	});

	test("importing replaces (not merges with) the current board", async ({ page, planner }) => {
		await planner.place(FLORIST, 80, 80);
		await importPlanFile(page, Planner.planJson({
			buildings: [{ id: FARMER, x: 5, y: 6, w: 13, h: 13, label: "Farmer", category: "farming", styleFile: "styles/caledonia.json" }],
		}));
		await expect.poll(() => planner.buildings()).toEqual([
			expect.objectContaining({ id: FARMER, x: 5, y: 6 }),
		]);
	});

	test("importing a plan switches to its style", async ({ page, planner }) => {
		await importPlanFile(page, Planner.planJson({ styleFile: "styles/medievalspruce.json" }));
		await expect(page.locator(".style-select")).toHaveValue("styles/medievalspruce.json");
	});

	test("a minimal plan with only ids fills the rest in from the style", async ({ page, planner }) => {
		await importPlanFile(page, Planner.planJson({ buildings: [{ id: FARMER, x: 1, y: 2 }] }));
		await expect.poll(() => planner.buildingCount()).toBe(1);
		expect((await planner.buildings())[0]).toMatchObject({ label: "Farmer", w: 13, h: 13, category: "farming" });
	});

	test("invalid JSON leaves the board untouched", async ({ page, planner, pageErrors }) => {
		pageErrors.allow(/Failed to read plan file/);
		await planner.place(FARMER, 10, 10);
		await importPlanFile(page, "{ this is not json");
		await page.waitForTimeout(300);
		expect(await planner.buildingCount()).toBe(1);
	});

	test("an unknown format version is refused", async ({ page, planner, pageErrors }) => {
		pageErrors.allow(/Unsupported or missing plan format version/);
		await planner.place(FARMER, 10, 10);
		await importPlanFile(page, { ...Planner.planJson(), formatVersion: 99 });
		await page.waitForTimeout(300);
		expect(await planner.buildingCount()).toBe(1);
	});

	test("the same file can be imported twice in a row", async ({ page, planner }) => {
		const plan = Planner.planJson({ buildings: [{ id: FARMER, x: 1, y: 2 }] });
		await importPlanFile(page, plan);
		await expect.poll(() => planner.buildingCount()).toBe(1);
		page.once("dialog", (d) => d.accept());
		await page.locator("[data-clear-board]").click();
		await importPlanFile(page, plan);
		await expect.poll(() => planner.buildingCount()).toBe(1);
	});

	test("old pre-paintbrush road saves (from/to lines) are migrated", async ({ page, planner }) => {
		await importPlanFile(page, Planner.planJson({
			paths: [{ id: "path_7", from: { x: 10, y: 20 }, to: { x: 30, y: 20 } }],
		}));
		await expect.poll(async () => (await planner.paths()).length).toBe(1);
		const [p] = await planner.paths();
		expect(p).toMatchObject({ id: "path_7", type: "default", width: 5 });
		const xs = p.cells.map((c) => c.x);
		expect(Math.min(...xs)).toBeLessThanOrEqual(10);
		expect(Math.max(...xs)).toBeGreaterThanOrEqual(30);
		// New paths get ids past the imported ones.
		await planner.openTab("roads");
		await planner.clickCell(80, 80);
		expect((await planner.paths())[1].id).toBe("path_8");
	});

	test("hostile values in an imported plan are sanitized", async ({ page, planner }) => {
		await importPlanFile(page, Planner.planJson({
			buildings: [
				null,
				{ x: 1, y: 1 }, // no id - skipped
				{ id: FARMER, x: 5, y: 5, label: '<img src=x onerror="window.__xss=1">' },
			],
			paths: [
				{ id: "path_1", type: "__proto__", width: 999, cells: [{ x: 1, y: 1 }, { x: "a", y: 2 }, null] },
				{ id: "path_2", cells: [] }, // empty - dropped
			],
		}));
		await expect.poll(() => planner.buildingCount()).toBe(1);
		const [p] = await planner.paths();
		expect(p).toMatchObject({ type: "default", width: 10, cells: [{ x: 1, y: 1 }] });
		await expect(page.locator(".placed-badge")).toHaveText('<img src=x onerror="window.__xss=1">');
		await planner.clickCell(7, 7); // select it so the preview pane renders the label too
		await page.waitForTimeout(200);
		expect(await page.evaluate(() => window.__xss)).toBeUndefined();
	});
});

test.describe("PNG export", () => {
	test("downloads a real PNG of the plan", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		const downloadPromise = page.waitForEvent("download");
		await page.locator("[data-export-png]").click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.png$/);
		const bytes = fs.readFileSync(await download.path());
		expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		// IHDR width/height = full grid at 5px per block.
		expect(bytes.readUInt32BE(16)).toBe(512 * 5);
		expect(bytes.readUInt32BE(20)).toBe(512 * 5);
	});
});

test.describe("My Plans (named saves)", () => {
	const rows = (page) => page.locator(".left-sidebar__plan-row");

	async function saveAs(page, name) {
		await page.locator("[data-plan-name-input]").fill(name);
		await page.locator("[data-save-named-plan]").click();
	}

	test("starts empty", async ({ page }) => {
		await expect(page.locator("[data-named-plans-empty]")).toBeVisible();
		await expect(rows(page)).toHaveCount(0);
	});

	test("save, switch, and load back", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await saveAs(page, "Village A");
		await expect(rows(page)).toHaveCount(1);
		await expect(rows(page).locator(".left-sidebar__plan-name")).toHaveText("Village A");
		await expect(page.locator("[data-named-plans-empty]")).toBeHidden();
		await expect(page.locator("[data-plan-name-input]")).toHaveValue("");

		page.once("dialog", (d) => d.accept());
		await page.locator("[data-clear-board]").click();
		await planner.place(FLORIST, 60, 60);

		await rows(page).getByRole("button", { name: "Load" }).click();
		await expect.poll(() => planner.buildings()).toEqual([expect.objectContaining({ id: FARMER, x: 10, y: 10 })]);
	});

	test("Enter in the name box saves too; blank names are ignored", async ({ page }) => {
		await page.locator("[data-plan-name-input]").fill("   ");
		await page.locator("[data-save-named-plan]").click();
		await expect(rows(page)).toHaveCount(0);
		await page.locator("[data-plan-name-input]").fill("  Trimmed  ");
		await page.locator("[data-plan-name-input]").press("Enter");
		await expect(rows(page).locator(".left-sidebar__plan-name")).toHaveText("Trimmed");
	});

	test("saved plans persist across reloads, newest first", async ({ page, planner }) => {
		await saveAs(page, "First");
		await page.waitForTimeout(20);
		await saveAs(page, "Second");
		await planner.reload();
		await expect(rows(page).locator(".left-sidebar__plan-name")).toHaveText(["Second", "First"]);
	});

	test("overwriting asks first", async ({ page, planner }) => {
		await planner.place(FARMER, 10, 10);
		await saveAs(page, "Same");
		await planner.place(FLORIST, 40, 10);

		page.once("dialog", (d) => {
			expect(d.message()).toContain('"Same" already exists');
			d.dismiss();
		});
		await saveAs(page, "Same");
		let stored = await page.evaluate(() => loadNamedPlans().Same.plan.buildings.length);
		expect(stored).toBe(1);

		page.once("dialog", (d) => d.accept());
		await saveAs(page, "Same");
		await expect.poll(() => page.evaluate(() => loadNamedPlans().Same.plan.buildings.length)).toBe(2);
		await expect(rows(page)).toHaveCount(1);
	});

	test("delete asks first", async ({ page }) => {
		await saveAs(page, "Doomed");
		page.once("dialog", (d) => d.dismiss());
		await rows(page).getByRole("button", { name: "Delete" }).click();
		await expect(rows(page)).toHaveCount(1);
		page.once("dialog", (d) => d.accept());
		await rows(page).getByRole("button", { name: "Delete" }).click();
		await expect(rows(page)).toHaveCount(0);
		await expect(page.locator("[data-named-plans-empty]")).toBeVisible();
	});

	test("names that look like code or object internals are stored as plain text", async ({ page, planner }) => {
		for (const name of ["__proto__", "constructor", '<b onmouseover="x">hi</b>']) {
			await saveAs(page, name);
		}
		await planner.reload();
		await expect(rows(page)).toHaveCount(3);
		const names = await rows(page).locator(".left-sidebar__plan-name").allTextContents();
		expect(names.sort()).toEqual(["<b onmouseover=\"x\">hi</b>", "__proto__", "constructor"].sort());
		await expect(page.locator(".left-sidebar__plan-name b")).toHaveCount(0);
	});
});

test.describe("preferences", () => {
	test("display toggles persist across reloads", async ({ page, planner }) => {
		const boxes = {
			rooftop: page.locator("[data-rooftop-toggle]"),
			doors: page.locator("[data-door-toggle]"),
			names: page.locator("[data-names-toggle]"),
			gridLines: page.locator("[data-grid-lines-toggle]"),
		};
		await expect(boxes.rooftop).not.toBeChecked();
		await expect(boxes.names).toBeChecked();
		await expect(boxes.gridLines).toBeChecked();

		await boxes.rooftop.check();
		await boxes.doors.setChecked(false);
		await boxes.names.uncheck();
		await boxes.gridLines.uncheck();
		await expect(page.locator("body")).toHaveClass(/hide-topdown-overlay/);
		await expect(page.locator(".grid")).toHaveClass(/hide-grid-lines/);

		await planner.reload();
		await expect(boxes.rooftop).toBeChecked();
		await expect(boxes.doors).not.toBeChecked();
		await expect(boxes.names).not.toBeChecked();
		await expect(boxes.gridLines).not.toBeChecked();
		await expect(page.locator("body")).toHaveClass(/hide-topdown-overlay/);
		await expect(page.locator(".grid")).toHaveClass(/hide-grid-lines/);
	});

	test("Left Ctrl toggles name tags (mirrored in the checkbox)", async ({ page }) => {
		const names = page.locator("[data-names-toggle]");
		await page.keyboard.press("ControlLeft");
		await expect(names).not.toBeChecked();
		await page.keyboard.press("ControlLeft");
		await expect(names).toBeChecked();
	});

	test("collapsed side panes stay collapsed", async ({ page, planner }) => {
		await page.locator("[data-left-toggle]").click();
		await expect(page.locator(".left-sidebar")).toHaveClass(/is-collapsed/);
		await expect(page.locator("[data-left-toggle]")).toHaveAttribute("aria-expanded", "false");
		await page.locator(".preview-sidebar__toggle").click();
		await expect(page.locator("body")).toHaveClass(/preview-collapsed/);

		await planner.reload();
		await expect(page.locator(".left-sidebar")).toHaveClass(/is-collapsed/);
		await expect(page.locator("body")).toHaveClass(/preview-collapsed/);

		await page.locator("[data-left-toggle]").click();
		await expect(page.locator(".left-sidebar")).not.toHaveClass(/is-collapsed/);
	});

	test("collapsing a pane gives the grid more room", async ({ page }) => {
		const width = () => page.evaluate(() => root.getBoundingClientRect().width);
		const before = await width();
		await page.locator("[data-left-toggle]").click();
		await expect.poll(width).toBeGreaterThan(before);
	});

	test("zoom and scroll position are restored after a reload", async ({ page, planner }) => {
		await page.locator("[data-zoom-in]").click();
		await page.evaluate(() => root.scrollTo(400, 300));
		await page.waitForTimeout(400); // saveGridView is debounced 300ms
		const before = await page.evaluate(() => ({ zoom: gridZoom, left: root.scrollLeft, top: root.scrollTop }));
		await planner.reload();
		const after = await page.evaluate(() => ({ zoom: gridZoom, left: root.scrollLeft, top: root.scrollTop }));
		expect(after).toEqual(before);
	});
});
