// The whole plan as one unit: serializing the board, clearing it, and
// loading a validated plan onto it. Shared by saving/loading
// (persistence.js) and undo/redo (history.js).

import { activeStyleFile } from "./catalog.js";
import { clearBuildings, placeBuilding, placedSquares, resolveShapeData } from "./buildings.js";
import { emit } from "./events.js";
import { cols, rows, setGridSize } from "./grid-view.js";
import { SAVE_FORMAT_VERSION, sanitizePlanData } from "./plan-format.js";
import { clearPaths, hidePathMenu, restorePaths, serializePaths } from "./paths.js";
import { dismissSelection } from "./selection.js";
import { getWorldBackgroundSaveData } from "./world-background.js";

// includeBackground embeds the background image inline (JSON export). It's
// opt-in because undo snapshots are taken on every edit and must stay small;
// autosave and named plans store the image separately (see
// getWorldBackgroundSaveDataLocal).
export function serializePlan({ includeBackground = false } = {}) {
	const data = {
		formatVersion: SAVE_FORMAT_VERSION,
		styleFile: activeStyleFile,
		savedAt: new Date().toISOString(),
		grid: { rows, cols },
		buildings: placedSquares.map((placed) => ({
			id: placed.id,
			x: placed.x,
			y: placed.y,
			w: placed.w,
			h: placed.h,
			label: placed.label,
			category: placed.category,
			emoji: placed.emoji,
			styleFile: placed.styleFile,
			rotated: placed.rotated,
			rotation: placed.rotation,
		})),
		roads: { paths: serializePaths() },
	};
	if (includeBackground) data.background = getWorldBackgroundSaveData();
	return data;
}

export function clearPlan() {
	dismissSelection();
	hidePathMenu();
	clearBuildings();
	clearPaths();
	emit("plan-changed");
}

// Validates plan data (see sanitizePlanData) against the current style
// catalog. Call after switching to the plan's style.
export function sanitizeForBoard(data) {
	return sanitizePlanData(data, { resolveShape: resolveShapeData, defaultRows: rows, defaultCols: cols });
}

// Replaces the board's contents with a sanitized plan (not the background).
export function loadPlanContents(plan) {
	clearPlan();
	setGridSize(plan.rows, plan.cols);
	for (const building of plan.buildings) placeBuilding(building.x, building.y, building);
	restorePaths(plan.paths);
}
