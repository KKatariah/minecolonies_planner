// Shared Playwright fixtures for the e2e suite.
//
// - `pageErrors` (automatic): every test fails if the page throws, logs a
//   console.error, or a request 404s - except the expected misses listed
//   in EXPECTED_MISSES. Tests that deliberately trigger an error call
//   `pageErrors.allow(/regex/)` first.
// - `planner`: helpers for driving index.html. The app is plain classic
//   scripts, so its top-level `let`/`const` state (placedSquares, paths,
//   gridZoom, ...) is reachable by name from page.evaluate() - tests use
//   that to read state, and the real mouse/keyboard to change it.

const base = require("@playwright/test");
const { expect } = base;

// The tray/preview look up a front photo by trying several candidate
// filenames in turn (getPreviewImageCandidates in app.js), so 404s for
// those are normal - not every building has a photo.
const EXPECTED_MISSES = [/\/images\/[a-z]+\/[a-z0-9_]+_front\.jpg$/, /\/favicon\.ico$/];
const isExpectedMiss = (url) => EXPECTED_MISSES.some((re) => re.test(url));

const test = base.test.extend({
	pageErrors: [
		async ({ page }, use) => {
			const errors = [];
			const allowed = [];
			page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
			page.on("console", (msg) => {
				if (msg.type() !== "error") return;
				const url = msg.location()?.url || "";
				if (/Failed to load resource/.test(msg.text()) && isExpectedMiss(url)) return;
				errors.push(`console.error: ${msg.text()} ${url}`);
			});
			page.on("response", (res) => {
				if (res.status() >= 400 && !isExpectedMiss(res.url())) {
					errors.push(`HTTP ${res.status()}: ${res.url()}`);
				}
			});
			const api = {
				errors,
				allow: (re) => allowed.push(re),
			};
			await use(api);
			const unexpected = errors.filter((e) => !allowed.some((re) => re.test(e)));
			expect(unexpected, "page produced unexpected errors").toEqual([]);
		},
		{ auto: true },
	],

	planner: async ({ page }, use) => {
		await use(new Planner(page));
	},
});

class Planner {
	constructor(page) {
		this.page = page;
	}

	// Opens the planner and waits for both style catalogs, the tray, and the
	// startup autosave restore (which ends with runPlanCheck) to finish.
	async goto() {
		await this.page.goto("/index.html");
		await this.waitForReady();
	}

	async reload() {
		await this.page.reload();
		await this.waitForReady();
	}

	async waitForReady() {
		await this.page.waitForFunction(
			() =>
				typeof styleCache !== "undefined" &&
				styleCache.size === STYLE_FILES.length &&
				shapes.length > 0 &&
				planCheckEl.innerHTML.trim().length > 0,
		);
	}

	// Client (viewport) coordinates of the center of grid cell (x, y) as
	// drawn on screen - i.e. inside .grid's border, where buildings and grid
	// lines actually render.
	async cellPoint(x, y) {
		return this.page.evaluate(
			([cx, cy]) => {
				const rect = grid.getBoundingClientRect();
				const size = cellSize * gridZoom;
				return {
					x: rect.left + grid.clientLeft * gridZoom + (cx + 0.5) * size,
					y: rect.top + grid.clientTop * gridZoom + (cy + 0.5) * size,
				};
			},
			[x, y],
		);
	}

	// modifiers: e.g. ["Shift"] - held via the keyboard, since
	// page.mouse.click() has no modifiers option of its own.
	async clickCell(x, y, { modifiers = [], button = "left" } = {}) {
		const p = await this.cellPoint(x, y);
		for (const m of modifiers) await this.page.keyboard.down(m);
		await this.page.mouse.click(p.x, p.y, { button });
		for (const m of modifiers) await this.page.keyboard.up(m);
	}

	// Left-drag from one cell to another in small steps (the app needs real
	// pointermove events past a 4px threshold to treat it as a drag).
	async dragCells(from, to, { button = "left", steps = 12, modifiers = [] } = {}) {
		const a = await this.cellPoint(from.x, from.y);
		const b = await this.cellPoint(to.x, to.y);
		for (const m of modifiers) await this.page.keyboard.down(m);
		await this.page.mouse.move(a.x, a.y);
		await this.page.mouse.down({ button });
		await this.page.mouse.move(b.x, b.y, { steps });
		await this.page.mouse.up({ button });
		for (const m of modifiers) await this.page.keyboard.up(m);
	}

	async openTab(tabId) {
		await this.page.locator(`.tab[data-tab-id="${tabId}"]`).click();
		await expect(this.page.locator(`.tab[data-tab-id="${tabId}"]`)).toHaveClass(/is-active/);
	}

	async shapeInfo(shapeId) {
		return this.page.evaluate((id) => {
			const s = shapes.find((shape) => shape.id === id);
			return s ? { id: s.id, label: s.label, w: s.w, h: s.h, category: s.category || "farming" } : null;
		}, shapeId);
	}

	// Arms a shape from the tray (switching to its tab first).
	async armShape(shapeId) {
		const info = await this.shapeInfo(shapeId);
		if (!info) throw new Error(`No shape ${shapeId} in the active style`);
		await this.openTab(info.category);
		await this.page.locator(`.shape-option[data-shape-id="${shapeId}"]`).click();
		await expect(this.page.locator(`.shape-option[data-shape-id="${shapeId}"]`)).toHaveClass(/is-selected/);
		return info;
	}

	// Places a building from the tray with its top-left corner at (x, y).
	async place(shapeId, x, y) {
		const before = await this.buildingCount();
		const info = await this.armShape(shapeId);
		await this.clickCell(x, y);
		await expect.poll(() => this.buildingCount()).toBe(before + 1);
		return info;
	}

	async selectStyle(label) {
		await this.page.locator(".style-select").selectOption({ label });
		await this.page.waitForFunction(
			(l) => STYLE_FILES.find((s) => s.label === l).id === activeStyleId,
			label,
		);
	}

	async buildingCount() {
		return this.page.evaluate(() => placedSquares.length);
	}

	async buildings() {
		return this.page.evaluate(() =>
			placedSquares.map(({ id, label, x, y, w, h, category, styleFile, rotated }) => ({
				id, label, x, y, w, h, category, styleFile, rotated,
			})),
		);
	}

	async paths() {
		return this.page.evaluate(() =>
			paths.map((p) => ({ id: p.id, type: p.type, width: p.width, cells: p.cells.map((c) => ({ ...c })) })),
		);
	}

	async selectedIds() {
		return this.page.evaluate(() =>
			placedSquares.filter((p) => selectedPlaced.has(p.el)).map((p) => `${p.id}@${p.x},${p.y}`),
		);
	}

	async undoRedoState() {
		return this.page.evaluate(() => ({ undo: undoStack.length, redo: redoStack.length }));
	}

	// Waits for the debounced (500ms) autosave to actually land.
	async waitForAutosave() {
		await this.page.waitForFunction(
			() => autoSaveTimer === null && window.localStorage.getItem(AUTOSAVE_STORAGE_KEY) !== null,
		);
		// The timer callback itself is async (awaits IndexedDB) - one more
		// tick for its setItem to run.
		await this.page.waitForTimeout(50);
	}

	async autosave() {
		return this.page.evaluate(() => JSON.parse(window.localStorage.getItem(AUTOSAVE_STORAGE_KEY)));
	}

	// Builds a plan JSON in the app's save format (see serializePlan).
	static planJson({ buildings = [], paths = [], styleFile = "styles/caledonia.json", grid = { rows: 512, cols: 512 } } = {}) {
		return {
			formatVersion: 1,
			styleFile,
			savedAt: new Date().toISOString(),
			grid,
			buildings,
			roads: { paths },
		};
	}
}

module.exports = { test, expect, Planner };
