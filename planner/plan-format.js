// The saved-plan format and its validation. Pure (no DOM or app state), so
// it's unit-tested directly (tests/unit/plan-format.test.js).
//
// A plan (formatVersion 1):
//   { formatVersion, styleFile, savedAt, grid: { rows, cols },
//     buildings: [{ id, x, y, w, h, label, category, emoji, styleFile, rotated, rotation? }],
//     (rotation: quarter turns clockwise, 0-3; plans from before it only
//     have rotated, meaning one turn)
//     roads: { paths: [{ id, type, width, cells: [{ x, y }] }] },
//     background?: see world-background.js }

import { MAX_PLAN_GRID_DIMENSION } from "./config.js";

export const SAVE_FORMAT_VERSION = 1;

const CATEGORY_PATTERN = /^[a-z0-9_-]+$/i;

const isGridCoord = (value) => Number.isInteger(value) && value >= 0 && value < MAX_PLAN_GRID_DIMENSION;
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;
const stringOr = (value) => (typeof value === "string" ? value : undefined);

// Checks a plan from outside (an import, a shared file, an old autosave)
// before anything on the board is touched, so a bad value can't leave the
// board half-loaded. Returns { rows, cols, buildings, paths, skippedBuildings }:
//   - buildings that are malformed or off the grid are dropped and counted;
//     invalid optional fields fall back to the style's values (via
//     resolveShape, which fills in a building's catalog data)
//   - overlapping buildings are kept: the walls tool overlaps segments on
//     purpose (see run-layout.js)
//   - the saved grid size is kept when valid (else defaultRows/defaultCols),
//     grown to fit everything saved on it, up to MAX_PLAN_GRID_DIMENSION
//   - paths are passed through for paths.js's restorePaths, which validates
//     each cell against the final grid
export function sanitizePlanData(data, { resolveShape, defaultRows, defaultCols }) {
	let rows = isPositiveInt(data.grid?.rows) ? data.grid.rows : defaultRows;
	let cols = isPositiveInt(data.grid?.cols) ? data.grid.cols : defaultCols;

	const buildings = [];
	let skippedBuildings = 0;
	for (const saved of Array.isArray(data.buildings) ? data.buildings : []) {
		if (!saved || typeof saved.id !== "string" || !saved.id) {
			skippedBuildings++;
			continue;
		}
		const shape = resolveShape({
			id: saved.id,
			w: isPositiveInt(saved.w) ? saved.w : undefined,
			h: isPositiveInt(saved.h) ? saved.h : undefined,
			label: stringOr(saved.label),
			category: typeof saved.category === "string" && CATEGORY_PATTERN.test(saved.category) ? saved.category : undefined,
			emoji: stringOr(saved.emoji),
			styleFile: stringOr(saved.styleFile),
		});
		const { x, y } = saved;
		const fits =
			isGridCoord(x) &&
			isGridCoord(y) &&
			x + shape.w <= MAX_PLAN_GRID_DIMENSION &&
			y + shape.h <= MAX_PLAN_GRID_DIMENSION;
		if (!fits) {
			skippedBuildings++;
			continue;
		}
		const rotation = [0, 1, 2, 3].includes(saved.rotation) ? saved.rotation : saved.rotated === true ? 1 : 0;
		buildings.push({ ...shape, x, y, rotated: rotation % 2 === 1, rotation });
		cols = Math.max(cols, x + shape.w);
		rows = Math.max(rows, y + shape.h);
	}

	const paths = Array.isArray(data.roads?.paths) ? data.roads.paths : [];
	for (const path of paths) {
		if (!path || !Array.isArray(path.cells)) continue;
		for (const c of path.cells) {
			if (!c || !isGridCoord(c.x) || !isGridCoord(c.y)) continue;
			cols = Math.max(cols, c.x + 1);
			rows = Math.max(rows, c.y + 1);
		}
	}

	return {
		rows: Math.min(rows, MAX_PLAN_GRID_DIMENSION),
		cols: Math.min(cols, MAX_PLAN_GRID_DIMENSION),
		buildings,
		paths,
		skippedBuildings,
	};
}
