// planner/plan-format.js - validating plan files before they touch the board.

const test = require("node:test");
const assert = require("node:assert/strict");

const { SAVE_FORMAT_VERSION, sanitizePlanData } = require("../../planner/plan-format.js");
const { MAX_PLAN_GRID_DIMENSION } = require("../../planner/config.js");

// Stands in for the style catalog: a 13x13 farmer.
const CATALOG = { farmer: { id: "farmer", label: "Farmer", w: 13, h: 13, category: "farming" } };
const resolveShape = (shape) => {
	const base = CATALOG[shape.id] || {};
	return {
		id: shape.id,
		label: shape.label || base.label || "Unknown",
		w: shape.w ?? base.w ?? 1,
		h: shape.h ?? base.h ?? 1,
		category: shape.category || base.category || "farming",
		emoji: shape.emoji,
		styleFile: shape.styleFile || "styles/test.json",
	};
};
const sanitize = (data) => sanitizePlanData(data, { resolveShape, defaultRows: 512, defaultCols: 512 });
const plan = (fields) => ({ formatVersion: SAVE_FORMAT_VERSION, grid: { rows: 512, cols: 512 }, buildings: [], roads: { paths: [] }, ...fields });

test("a valid plan passes through, filled in from the catalog", () => {
	const result = sanitize(plan({ buildings: [{ id: "farmer", x: 3, y: 4, rotated: true }] }));
	assert.equal(result.skippedBuildings, 0);
	assert.deepEqual(result.buildings, [
		{ id: "farmer", label: "Farmer", w: 13, h: 13, category: "farming", emoji: undefined, styleFile: "styles/test.json", x: 3, y: 4, rotated: true, rotation: 1 },
	]);
	assert.deepEqual([result.rows, result.cols], [512, 512]);
});

test("rotation is kept when valid, else taken from the older rotated flag", () => {
	const result = sanitize(
		plan({
			buildings: [
				{ id: "farmer", x: 0, y: 0, rotation: 2 },
				{ id: "farmer", x: 20, y: 0, rotation: 3, rotated: false },
				{ id: "farmer", x: 40, y: 0, rotation: 7, rotated: true },
				{ id: "farmer", x: 60, y: 0, rotation: "2" },
			],
		}),
	);
	assert.deepEqual(result.buildings.map((b) => [b.rotation, b.rotated]), [[2, false], [3, true], [1, true], [0, false]]);
});

test("malformed buildings are dropped and counted; the rest survive", () => {
	const result = sanitize(
		plan({
			buildings: [
				null,
				{ x: 1, y: 1 }, // no id
				{ id: 42, x: 1, y: 1 },
				{ id: "farmer", x: "q", y: 1 },
				{ id: "farmer", x: -1, y: 1 },
				{ id: "farmer", x: 1.5, y: 1 },
				{ id: "farmer", x: MAX_PLAN_GRID_DIMENSION - 5, y: 0 }, // runs off the largest grid
				{ id: "farmer", x: 20, y: 20 },
			],
		}),
	);
	assert.equal(result.skippedBuildings, 7);
	assert.deepEqual(result.buildings.map((b) => [b.x, b.y]), [[20, 20]]);
});

test("invalid optional fields fall back instead of breaking the load", () => {
	const [b] = sanitize(
		plan({ buildings: [{ id: "farmer", x: 0, y: 0, w: "wide", h: -3, category: "a b", label: 7, rotated: "yes" }] }),
	).buildings;
	assert.equal(b.w, 13);
	assert.equal(b.h, 13);
	assert.equal(b.category, "farming", "a category that isn't a safe class name is replaced");
	assert.equal(b.label, "Farmer");
	assert.equal(b.rotated, false, "only a real boolean true counts");
});

test("overlapping buildings are kept (wall runs overlap on purpose)", () => {
	const result = sanitize(plan({ buildings: [{ id: "farmer", x: 0, y: 0 }, { id: "farmer", x: 5, y: 5 }] }));
	assert.equal(result.buildings.length, 2);
});

test("an invalid grid size falls back, and the grid grows to fit its contents", () => {
	const result = sanitize(
		plan({
			grid: { rows: "abc", cols: -5 },
			buildings: [{ id: "farmer", x: 600, y: 2 }],
			roads: { paths: [{ cells: [{ x: 3, y: 700 }, { x: "bad", y: 9999 }] }] },
		}),
	);
	assert.deepEqual({ rows: result.rows, cols: result.cols }, { rows: 701, cols: 613 });
});

test("a grid larger than the maximum is capped", () => {
	const result = sanitize(plan({ grid: { rows: 10 ** 9, cols: 10 ** 9 } }));
	assert.deepEqual([result.rows, result.cols], [MAX_PLAN_GRID_DIMENSION, MAX_PLAN_GRID_DIMENSION]);
});

test("missing sections are treated as empty", () => {
	const result = sanitize({ formatVersion: SAVE_FORMAT_VERSION });
	assert.deepEqual(result, { rows: 512, cols: 512, buildings: [], paths: [], skippedBuildings: 0 });
});
