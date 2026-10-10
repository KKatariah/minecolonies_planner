// planner/cell-geometry.js - the brush, line and cell-key math behind
// painted paths and walls.

const test = require("node:test");
const assert = require("node:assert/strict");

const G = require("../../planner/cell-geometry.js");

const GRID = { cols: 100, rows: 100 };
const sortedCells = (keys) => G.keysToCells(keys).sort((a, b) => a.y - b.y || a.x - b.x);

test("cell keys round-trip, and horizontal neighbors never alias another row", () => {
	for (const [x, y] of [[0, 0], [5, 7], [16383, 0], [0, 16383], [16383, 16383]]) {
		assert.deepEqual(G.cellFromKey(G.cellKey(x, y)), { x, y });
	}
	// The cell left of x=0 and right of the widest grid are never real cells.
	assert.notEqual(G.cellKey(-1, 5), G.cellKey(16383, 4));
	assert.notEqual(G.cellKey(16384, 4), G.cellKey(0, 5));
});

test("getCellBounds handles more cells than Math.min(...spread) can", () => {
	const cells = [];
	for (let i = 0; i < 300_000; i++) cells.push({ x: i % 1000, y: Math.floor(i / 1000) + 3 });
	assert.deepEqual(G.getCellBounds(cells), { minX: 0, maxX: 999, minY: 3, maxY: 302 });
});

test("brush widths paint exactly width x width, extra cell after the center when even", () => {
	for (let width = 1; width <= 10; width++) {
		const keys = new Set();
		G.stampBrush(keys, 50, 50, width, GRID);
		assert.equal(keys.size, width * width, `width ${width}`);
		const { minX, maxX } = G.getCellBounds(G.keysToCells(keys));
		assert.equal(maxX - minX + 1, width);
		const { before, after } = G.brushExtent(width);
		assert.equal(minX, 50 - before);
		assert.equal(maxX, 50 + after);
		assert.ok(after - before === 0 || after - before === 1);
	}
});

test("the brush is clipped at the grid edge", () => {
	const keys = new Set();
	G.stampBrush(keys, 0, 0, 5, GRID);
	assert.deepEqual(G.getCellBounds(G.keysToCells(keys)), { minX: 0, maxX: 2, minY: 0, maxY: 2 });
	assert.equal(keys.size, 9);
});

test("bresenhamLine connects any two cells without gaps", () => {
	for (const [x1, y1] of [[10, 0], [0, 10], [7, 3], [-4, 9], [-6, -6]]) {
		const line = G.bresenhamLine(0, 0, x1, y1);
		assert.deepEqual(line[0], { x: 0, y: 0 });
		assert.deepEqual(line[line.length - 1], { x: x1, y: y1 });
		for (let i = 1; i < line.length; i++) {
			const step = Math.max(Math.abs(line[i].x - line[i - 1].x), Math.abs(line[i].y - line[i - 1].y));
			assert.equal(step, 1, "consecutive cells must touch");
		}
	}
});

test("constrainToAxis keeps whichever axis moved further", () => {
	assert.deepEqual(G.constrainToAxis({ x: 5, y: 5 }, { x: 15, y: 8 }), { x: 15, y: 5 });
	assert.deepEqual(G.constrainToAxis({ x: 5, y: 5 }, { x: 7, y: -20 }), { x: 5, y: -20 });
	assert.deepEqual(G.constrainToAxis({ x: 5, y: 5 }, { x: 9, y: 9 }), { x: 9, y: 5 }, "ties go horizontal");
});

test("legacy from/to roads rebuild their old symmetric 5-wide footprint", () => {
	const line = G.legacyOrthogonalLine(10, 20, 14, 21);
	assert.deepEqual(line, [10, 11, 12, 13, 14].map((x) => ({ x, y: 20 })), "the longer axis wins");
	const keys = new Set(G.legacyThickenLine(line, 5, GRID).map((c) => G.cellKey(c.x, c.y)));
	assert.equal(keys.size, 9 * 5);
	assert.deepEqual(G.getCellBounds(sortedCells(keys)), { minX: 8, maxX: 16, minY: 18, maxY: 22 });
});

const run = (axis, sx, sy, ex, ey) => ({ axis, start: { x: sx, y: sy }, end: { x: ex, y: ey } });

test("a run's end snaps to the nearest existing run end within tolerance", () => {
	const runs = [run("horizontal", 10, 40, 80, 40)];
	const resolved = G.resolveRun(runs, "vertical", { x: 82, y: 43 }, { x: 82, y: 120 }, 9);
	assert.deepEqual(resolved.start, { x: 80, y: 40 });
	// Kept straight: the end moves onto the snapped column.
	assert.deepEqual(resolved.end, { x: 80, y: 120 });
	assert.deepEqual(resolved.joins, [runs[0]]);
	// Out of tolerance: nothing moves.
	const far = G.resolveRun(runs, "vertical", { x: 95, y: 43 }, { x: 95, y: 120 }, 9);
	assert.deepEqual([far.start, far.end, far.joins], [{ x: 95, y: 43 }, { x: 95, y: 120 }, []]);
});

test("a perpendicular run beside another's middle snaps onto its centerline (a T)", () => {
	const runs = [run("horizontal", 10, 40, 80, 40)];
	const resolved = G.resolveRun(runs, "vertical", { x: 45, y: 120 }, { x: 45, y: 44 }, 9);
	assert.deepEqual(resolved.end, { x: 45, y: 40 });
	assert.deepEqual(resolved.joins, [runs[0]]);
	// A parallel run beside the middle doesn't snap.
	assert.deepEqual(G.resolveRun(runs, "horizontal", { x: 30, y: 44 }, { x: 60, y: 44 }, 9).joins, []);
});

test("runs meeting at a shared end cell paint a square corner", () => {
	const keys = new Set();
	G.stampRun(keys, run("horizontal", 20, 40, 60, 40), 7, GRID);
	G.stampRun(keys, run("vertical", 60, 40, 60, 80), 7, GRID);
	// The outside corner is filled, and nothing pokes past either run.
	assert.ok(keys.has(G.cellKey(63, 37)));
	const { minX, maxX, minY, maxY } = G.getCellBounds(G.keysToCells(keys));
	assert.deepEqual({ minX, maxX, minY, maxY }, { minX: 17, maxX: 63, minY: 37, maxY: 83 });
	assert.deepEqual(G.runRect(run("horizontal", 20, 40, 60, 40), 7), { x: 17, y: 37, w: 47, h: 7 });
});

test("addRun merges runs on the same line that overlap or touch, and nothing else", () => {
	const runs = [];
	G.addRun(runs, run("horizontal", 10, 40, 30, 40));
	G.addRun(runs, run("horizontal", 50, 40, 31, 40)); // touching, drawn backwards
	G.addRun(runs, run("horizontal", 10, 41, 30, 41)); // next row - separate
	G.addRun(runs, run("vertical", 30, 40, 30, 90)); // perpendicular - separate
	assert.equal(runs.length, 3);
	const merged = runs.find((r) => r.axis === "horizontal" && r.start.y === 40);
	assert.deepEqual([merged.start, merged.end], [{ x: 10, y: 40 }, { x: 50, y: 40 }]);
});

test("rotateFootprintPoint turns a point with its footprint, and four turns are a no-op", () => {
	assert.deepEqual(G.rotateFootprintPoint({ x: 0.5, y: 1.5 }, 4, 2, 0), { x: 0.5, y: 1.5 });
	assert.deepEqual(G.rotateFootprintPoint({ x: 0.5, y: 1.5 }, 4, 2, 1), { x: 0.5, y: 0.5 });
	assert.deepEqual(G.rotateFootprintPoint({ x: 0.5, y: 1.5 }, 4, 2, 2), { x: 3.5, y: 0.5 });
	assert.deepEqual(G.rotateFootprintPoint({ x: 3, y: 1 }, 4, 2, 4), { x: 3, y: 1 });
});

test("groupConnectedCells splits cells that don't touch, keeping diagonal strokes whole", () => {
	const cells = [
		{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
		{ x: 10, y: 10 }, { x: 11, y: 11 }, { x: 12, y: 12 }, { x: 13, y: 13 },
		{ x: 5, y: 0 },
	];
	const groups = G.groupConnectedCells(cells);
	assert.deepEqual(groups.map((group) => group.length), [4, 3, 1]);
	assert.deepEqual(G.groupConnectedCells([]), []);
});
