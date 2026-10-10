// Pure cell math for painted paths, walls and building footprints - no DOM
// or app state, so it's unit-tested directly (tests/unit/cell-geometry.test.js).
//
// Cells are often held in Sets as numeric keys: cheaper to build and look up
// than "x,y" strings across tens of thousands of cells.

import { MAX_PLAN_GRID_DIMENSION } from "./config.js";

// Wider than any grid can be, so x - 1 / x + 1 never alias a cell in the
// neighboring row.
export const CELL_KEY_STRIDE = MAX_PLAN_GRID_DIMENSION + 2;

export function cellKey(x, y) {
	return y * CELL_KEY_STRIDE + x;
}

export function cellFromKey(key) {
	return { x: key % CELL_KEY_STRIDE, y: Math.floor(key / CELL_KEY_STRIDE) };
}

export function keysToCells(keys) {
	return [...keys].map(cellFromKey);
}

// A loop rather than Math.min(...xs): spreading a large painted area's cells
// as arguments can exceed the engine's argument limit.
export function getCellBounds(cells) {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const c of cells) {
		if (c.x < minX) minX = c.x;
		if (c.x > maxX) maxX = c.x;
		if (c.y < minY) minY = c.y;
		if (c.y > maxY) maxY = c.y;
	}
	return { minX, maxX, minY, maxY };
}

// Every cell on a straight line between two cells (Bresenham, any angle) -
// fills the gaps between pointermove samples during a fast brush stroke.
export function bresenhamLine(x0, y0, x1, y1) {
	const cells = [];
	let x = x0;
	let y = y0;
	const dx = Math.abs(x1 - x0);
	const dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;
	for (;;) {
		cells.push({ x, y });
		if (x === x1 && y === y1) break;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y += sy;
		}
	}
	return cells;
}

// How far a `width`-wide brush reaches either side of its center. An even
// width can't be symmetric, so the extra cell goes after the center
// (4 -> 1 before, 2 after).
export function brushExtent(width) {
	const before = Math.floor((width - 1) / 2);
	return { before, after: width - 1 - before };
}

// Adds the width x width square centered on (cx, cy) to `keys`, skipping
// cells outside a cols x rows grid.
export function stampBrush(keys, cx, cy, width, { cols, rows }) {
	const { before, after } = brushExtent(width);
	for (let dx = -before; dx <= after; dx++) {
		for (let dy = -before; dy <= after; dy++) {
			const x = cx + dx;
			const y = cy + dy;
			if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
			keys.add(cellKey(x, y));
		}
	}
}

// Locks `cell` to whichever axis it moved further along from `start`, for
// straight runs.
export function constrainToAxis(start, cell) {
	const dx = Math.abs(cell.x - start.x);
	const dy = Math.abs(cell.y - start.y);
	return dx >= dy ? { x: cell.x, y: start.y } : { x: start.x, y: cell.y };
}

// ---------- straight runs (the road brush) ----------
// A run is a straight centerline { axis: "horizontal" | "vertical", start,
// end }, with start and end on the same row (horizontal) or column.

const alongKey = (axis) => (axis === "horizontal" ? "x" : "y");
const acrossKey = (axis) => (axis === "horizontal" ? "y" : "x");

// Where a new `axis` run's end at `cell` should snap to, or null. First
// choice is the nearest existing run end within `tolerance` (Manhattan), so
// turns and extensions meet exactly; failing that, the nearest point on a
// perpendicular run's centerline that `cell` is beside, which makes a T.
export function findRunSnap(runs, axis, cell, tolerance) {
	let best = null;
	for (const run of runs) {
		for (const end of [run.start, run.end]) {
			const dist = Math.abs(end.x - cell.x) + Math.abs(end.y - cell.y);
			if (dist <= tolerance && (!best || dist < best.dist)) best = { run, cell: { x: end.x, y: end.y }, dist };
		}
	}
	if (best) return best;
	for (const run of runs) {
		if (run.axis === axis) continue;
		const a = alongKey(run.axis);
		const c = acrossKey(run.axis);
		if (cell[a] < Math.min(run.start[a], run.end[a]) || cell[a] > Math.max(run.start[a], run.end[a])) continue;
		const dist = Math.abs(cell[c] - run.start[c]);
		if (dist <= tolerance && (!best || dist < best.dist)) best = { run, cell: { [a]: cell[a], [c]: run.start[c] }, dist };
	}
	return best;
}

// A dragged run with both ends snapped (findRunSnap) and kept straight: the
// row/column comes from the start's snap, else the end's, else the start.
// `joins` are the existing runs it snapped to.
export function resolveRun(runs, axis, start, end, tolerance) {
	const startSnap = findRunSnap(runs, axis, start, tolerance);
	const endSnap = findRunSnap(runs, axis, end, tolerance);
	const c = acrossKey(axis);
	const line = (startSnap?.cell ?? endSnap?.cell ?? start)[c];
	return {
		axis,
		start: { ...(startSnap?.cell ?? start), [c]: line },
		end: { ...(endSnap?.cell ?? end), [c]: line },
		joins: [...new Set([startSnap?.run, endSnap?.run].filter(Boolean))],
	};
}

// Adds a `width`-wide run's cells to `keys`: the brush stamped along its
// centerline, so it also reaches past each end by the brush's half-width -
// two runs sharing an end cell meet in a square corner.
export function stampRun(keys, run, width, bounds) {
	for (const point of bresenhamLine(run.start.x, run.start.y, run.end.x, run.end.y)) {
		stampBrush(keys, point.x, point.y, width, bounds);
	}
}

// The rectangle stampRun paints, unclipped: { x, y, w, h }.
export function runRect(run, width) {
	const { before } = brushExtent(width);
	const minX = Math.min(run.start.x, run.end.x);
	const minY = Math.min(run.start.y, run.end.y);
	return {
		x: minX - before,
		y: minY - before,
		w: Math.abs(run.end.x - run.start.x) + width,
		h: Math.abs(run.end.y - run.start.y) + width,
	};
}

// Adds `run` to `runs` (mutated), merging it with any run on the same line
// it overlaps or touches end to end, so an extended run is one run.
export function addRun(runs, run) {
	const a = alongKey(run.axis);
	const c = acrossKey(run.axis);
	let lo = Math.min(run.start[a], run.end[a]);
	let hi = Math.max(run.start[a], run.end[a]);
	for (let i = runs.length - 1; i >= 0; i--) {
		const other = runs[i];
		if (other.axis !== run.axis || other.start[c] !== run.start[c]) continue;
		const otherLo = Math.min(other.start[a], other.end[a]);
		const otherHi = Math.max(other.start[a], other.end[a]);
		if (otherLo > hi + 1 || otherHi < lo - 1) continue;
		lo = Math.min(lo, otherLo);
		hi = Math.max(hi, otherHi);
		runs.splice(i, 1);
	}
	runs.push({
		axis: run.axis,
		start: { [a]: lo, [c]: run.start[c] },
		end: { [a]: hi, [c]: run.start[c] },
	});
}

// Plans saved before the paintbrush stored roads as a from/to line with a
// fixed width. These two rebuild that line's cells when such a plan loads.
export function legacyOrthogonalLine(x0, y0, x1, y1) {
	const cells = [];
	if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
		const sx = x0 < x1 ? 1 : -1;
		for (let x = x0; x !== x1; x += sx) cells.push({ x, y: y0 });
		cells.push({ x: x1, y: y0 });
	} else {
		const sy = y0 < y1 ? 1 : -1;
		for (let y = y0; y !== y1; y += sy) cells.push({ x: x0, y });
		cells.push({ x: x0, y: y1 });
	}
	return cells;
}

// The old tool's brush: a symmetric radius of floor(width / 2).
export function legacyThickenLine(lineCells, width, { cols, rows }) {
	const r = Math.floor(width / 2);
	const keys = new Set();
	for (const { x, y } of lineCells) {
		for (let dx = -r; dx <= r; dx++) {
			for (let dy = -r; dy <= r; dy++) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
				keys.add(cellKey(nx, ny));
			}
		}
	}
	return keysToCells(keys);
}

// A point { x, y } in an unrotated w x h footprint, carried along when the
// footprint turns `turns` quarter turns clockwise. Points are in blocks, so a
// block's center is at +0.5.
export function rotateFootprintPoint(point, w, h, turns) {
	let { x, y } = point;
	for (let i = 0; i < turns; i++) {
		[x, y] = [h - y, x];
		[w, h] = [h, w];
	}
	return { x, y };
}

// Splits cells into groups that touch, sides or corners (a 1-wide diagonal
// stroke is still one piece). Returns [[{ x, y }]], largest group first.
export function groupConnectedCells(cells) {
	const unvisited = new Map(cells.map((c) => [cellKey(c.x, c.y), c]));
	const groups = [];
	for (const [startKey, startCell] of unvisited) {
		unvisited.delete(startKey);
		const group = [startCell];
		for (let i = 0; i < group.length; i++) {
			const { x, y } = group[i];
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const key = cellKey(x + dx, y + dy);
					const next = unvisited.get(key);
					if (!next) continue;
					unvisited.delete(key);
					group.push(next);
				}
			}
		}
		groups.push(group);
	}
	return groups.sort((a, b) => b.length - a.length);
}
