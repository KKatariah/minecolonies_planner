// Painted paths (roads, rivers, canals): free-form sets of cells. This module
// owns `paths` and draws them; the brush gestures that create and edit them
// are in grid-pointer.js.
//
// A path: { id, type, width, cells: [{ x, y }], elements: [container] },
// plus `runs` (road-runs.js) on paths drawn this session.
// Each path is one .placed-path element (its click target and selection
// outline) with all its cells drawn into a single canvas - one element per
// cell made large maps unusably slow.

import {
	CELL_KEY_STRIDE,
	cellKey,
	getCellBounds,
	groupConnectedCells,
	legacyOrthogonalLine,
	legacyThickenLine,
} from "./cell-geometry.js";
import { cellSize } from "./config.js";
import { settings } from "./display-settings.js";
import { emit, on } from "./events.js";
import { cols, gridHeight, gridWidth, rows } from "./grid-view.js";
import { pushUndoState } from "./history.js";
import { grid, pathActionMenu } from "./layout.js";
import { PATH_MAX_WIDTH, ROAD_TYPE_SOLID, isKnownRoadType, roadTypeColor } from "./road-types.js";
import { fetchRooftopData, getRooftopDataPath, rooftopManifest } from "./rooftop.js";
import { hideActionMenu } from "./selection.js";

export const paths = [];
export let selectedPathId = null;
let nextPathId = 1;

export function addPath({ type, width }) {
	const path = { id: `path_${nextPathId++}`, type, width, cells: [], elements: [] };
	paths.push(path);
	return path;
}

export function findPath(id) {
	return paths.find((p) => p.id === id) || null;
}

function removePathAt(index) {
	const [path] = paths.splice(index, 1);
	path.elements.forEach((el) => el.remove());
	if (selectedPathId === path.id) selectedPathId = null;
}

export function removePath(path) {
	const index = paths.indexOf(path);
	if (index >= 0) removePathAt(index);
}

export function clearPaths() {
	while (paths.length) removePathAt(paths.length - 1);
}

// Every painted cell, as cellKey()s.
export function buildGlobalCellSet() {
	const keys = new Set();
	for (const path of paths) for (const c of path.cells) keys.add(cellKey(c.x, c.y));
	return keys;
}

// Removes the given cells (cellKey()s) from every path, whatever its type;
// a path left empty is deleted. Returns the paths that lost cells but are
// still there (empty if nothing changed).
export function eraseCells(keys) {
	const changed = [];
	for (let i = paths.length - 1; i >= 0; i--) {
		const path = paths[i];
		// Most paths are nowhere near the stroke - check before allocating.
		if (!path.cells.some((c) => keys.has(cellKey(c.x, c.y)))) continue;
		const remaining = path.cells.filter((c) => !keys.has(cellKey(c.x, c.y)));
		if (remaining.length) {
			path.cells = remaining;
			changed.push(path);
		} else removePathAt(i);
	}
	return changed;
}

// Splits each of `candidates` whose cells no longer all touch (say, a T
// junction erased away) into one path per connected piece, so each can be
// selected and deleted on its own. The largest piece keeps the path; each
// remembered run (road-runs.js) goes with the piece holding its start.
export function splitDisconnectedPaths(candidates) {
	for (const path of candidates) {
		if (!paths.includes(path)) continue;
		const [kept, ...rest] = groupConnectedCells(path.cells);
		if (!rest.length) continue;
		const runs = path.runs || [];
		const runsIn = (cells) => {
			const keys = new Set(cells.map((c) => cellKey(c.x, c.y)));
			return runs.filter((run) => keys.has(cellKey(run.start.x, run.start.y)));
		};
		path.cells = kept;
		path.runs = runsIn(kept);
		for (const cells of rest) {
			const piece = addPath({ type: path.type, width: path.width });
			piece.cells = cells;
			piece.runs = runsIn(cells);
		}
	}
}

// ---------- block textures (top-down mode) ----------
// With top-down renders on, a painted cell shows a real block texture.
// Path is Minecraft's dirt path block, and canal stays flat water blue
// (ROAD_TYPE_SOLID). Every other type borrows the surface blocks of its style's straight piece (alleys ->
// alleys_long, canal -> canal_straight), and every cell picks one by a hash
// of its position, weighted by how much of the piece each block covers - so
// a cell keeps its block across redraws and reloads. Decorations (torches,
// signs...) are left out, and water types use only their most common block,
// since a random water/bank mix looks like a broken channel.
// (The road families only get here for painted paths in older plans.)

const PATH_TEXTURE_SKIP = /torch|lantern|chain|decorationcontroller|_sign|_banner/;
const pathTextureCache = new Map(); // type -> [{ icon, weight, img }] | null | "loading"

export const DIRT_PATH_ICON = "images/materials/minecraft_block_dirt_path_top.png";

function loadImageOrNull(src) {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = src;
	});
}

function findPathTextureSource(type) {
	for (const key of Object.keys(rooftopManifest)) {
		if (key.endsWith(`::${type}_long`) || key.endsWith(`::${type}_straight`)) {
			const [styleFile, id] = key.split("::");
			return { styleFile, id };
		}
	}
	return null;
}

// The type's texture palette, or null while unavailable (no source piece,
// or still loading - finishing redraws every path).
function getPathTexture(type) {
	if (pathTextureCache.has(type)) {
		const cached = pathTextureCache.get(type);
		return cached === "loading" ? null : cached;
	}
	if (ROAD_TYPE_SOLID.has(type)) return null;
	if (type === "default") {
		pathTextureCache.set(type, "loading");
		loadImageOrNull(DIRT_PATH_ICON).then((img) => {
			pathTextureCache.set(type, img ? [{ icon: DIRT_PATH_ICON, weight: 1, img }] : null);
			if (settings.topDownRenders.get()) rerenderAllPaths();
		});
		return null;
	}
	const source = findPathTextureSource(type);
	const dataPath = source && getRooftopDataPath(source);
	if (!dataPath) return null; // the manifest may not have loaded yet - don't cache
	pathTextureCache.set(type, "loading");
	fetchRooftopData(dataPath)
		.then(async (gridData) => {
			const counts = new Map();
			for (const row of gridData.grid) {
				for (const block of row) {
					if (!block || !block.icon) continue;
					if (block.fenceConnections || block.wallConnections || block.topper) continue;
					if (PATH_TEXTURE_SKIP.test(block.name)) continue;
					counts.set(block.icon, (counts.get(block.icon) || 0) + 1);
				}
			}
			let palette = [...counts].map(([icon, weight]) => ({ icon, weight })).sort((a, b) => b.weight - a.weight);
			// Canvas drawing needs decoded images; a block whose icon fails to
			// load is dropped.
			const images = await Promise.all(palette.map((entry) => loadImageOrNull(entry.icon)));
			palette = palette.map((entry, i) => ({ ...entry, img: images[i] })).filter((entry) => entry.img);
			pathTextureCache.set(type, palette.length ? palette : null);
		})
		.catch(() => pathTextureCache.set(type, null))
		.finally(() => {
			if (settings.topDownRenders.get()) rerenderAllPaths();
		});
	return null;
}

// A stable 0..1 value per cell.
function cellHash(x, y) {
	let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
	h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
	return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function pickPathTextureImage(palette, x, y) {
	const total = palette.reduce((sum, entry) => sum + entry.weight, 0);
	let roll = cellHash(x, y) * total;
	for (const entry of palette) {
		roll -= entry.weight;
		if (roll < 0) return entry.img;
	}
	return palette[palette.length - 1].img;
}

// ---------- drawing ----------

// Theme colors as real values (a canvas can't use var(--x)), cached until
// the theme changes.
let pathThemeColors = null;
function getPathThemeColors() {
	if (!pathThemeColors) {
		const style = getComputedStyle(document.documentElement);
		const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
		pathThemeColors = {
			cellBg: read("--path-cell-bg", "rgba(100, 180, 220, 0.4)"),
			cellBorder: read("--path-cell-border", "rgba(60, 140, 200, 0.8)"),
			bevelLight: read("--path-bevel-light", "rgba(255, 255, 255, 0.45)"),
			bevelDark: read("--path-bevel-dark", "rgba(0, 0, 0, 0.4)"),
			gridLine: read("--grid-line-light", "rgba(255, 255, 255, 0.08)"),
		};
	}
	return pathThemeColors;
}

// Canvas pixels per CSS pixel: the device pixel ratio (capped at 2), stepped
// down for a huge path so the canvas stays within browser size limits.
const PATH_CANVAS_MAX_DIMENSION = 16000;
const PATH_CANVAS_MAX_PIXELS = 16_000_000;
function getPathCanvasScale(cssW, cssH) {
	return Math.min(
		Math.min(2, window.devicePixelRatio || 1),
		PATH_CANVAS_MAX_DIMENSION / cssW,
		PATH_CANVAS_MAX_DIMENSION / cssH,
		Math.sqrt(PATH_CANVAS_MAX_PIXELS / (cssW * cssH)),
	);
}

// (Re)draws one path. Fills and edges are batched into one canvas path per
// color. Edges are drawn only where a cell borders open ground - not another
// painted cell of any path - so touching paths read as one surface.
// globalCellSet: buildGlobalCellSet(), passed in so a full redraw builds it once.
function renderPath(path, globalCellSet) {
	path.elements.forEach((el) => el.remove());
	path.elements = [];
	const cells = path.cells;
	if (!cells.length) return;

	const { minX, maxX, minY, maxY } = getCellBounds(cells);
	const cssW = (maxX - minX + 1) * cellSize;
	const cssH = (maxY - minY + 1) * cellSize;

	const container = document.createElement("div");
	container.className = "placed-path";
	container.classList.toggle("is-selected", selectedPathId === path.id);
	container.dataset.pathId = path.id;
	Object.assign(container.style, {
		position: "absolute",
		left: `${minX * cellSize}px`,
		top: `${minY * cellSize}px`,
		width: `${cssW}px`,
		height: `${cssH}px`,
		pointerEvents: "auto",
	});

	const canvas = document.createElement("canvas");
	canvas.className = "placed-path__canvas";
	const scale = getPathCanvasScale(cssW, cssH);
	canvas.width = Math.max(1, Math.round(cssW * scale));
	canvas.height = Math.max(1, Math.round(cssH * scale));
	const ctx = canvas.getContext("2d");
	ctx.setTransform(scale, 0, 0, scale, 0, 0);
	ctx.imageSmoothingEnabled = false;

	const color = roadTypeColor(path.type);
	const solid = ROAD_TYPE_SOLID.has(path.type);
	const texture = settings.topDownRenders.get() ? getPathTexture(path.type) : null;
	const theme = getPathThemeColors();
	const s = cellSize;
	const hasCell = (x, y) => globalCellSet.has(cellKey(x, y));

	if (texture) {
		// Opaque like a building's render, so no grid lines over it. Smoothed:
		// 16px textures shrunk to a few pixels turn to dots with nearest-neighbor.
		ctx.imageSmoothingEnabled = true;
		for (const c of cells) {
			ctx.drawImage(pickPathTextureImage(texture, c.x, c.y), (c.x - minX) * s, (c.y - minY) * s, s, s);
		}
	} else {
		ctx.fillStyle = color || theme.cellBg;
		ctx.beginPath();
		for (const c of cells) ctx.rect((c.x - minX) * s, (c.y - minY) * s, s, s);
		ctx.fill();
		if (solid && settings.gridLines.get()) {
			// An opaque fill hides the grid's own lines - redraw each cell's
			// left and top edge.
			ctx.fillStyle = theme.gridLine;
			ctx.beginPath();
			for (const c of cells) {
				const px = (c.x - minX) * s;
				const py = (c.y - minY) * s;
				ctx.rect(px, py, 1, s);
				ctx.rect(px, py, s, 1);
			}
			ctx.fill();
		}
	}

	const drawEdges = (fillStyle, { top, bottom, left, right }) => {
		ctx.fillStyle = fillStyle;
		ctx.beginPath();
		for (const c of cells) {
			const px = (c.x - minX) * s;
			const py = (c.y - minY) * s;
			if (top && !hasCell(c.x, c.y - 1)) ctx.rect(px, py, s, 1);
			if (bottom && !hasCell(c.x, c.y + 1)) ctx.rect(px, py + s - 1, s, 1);
			if (left && !hasCell(c.x - 1, c.y)) ctx.rect(px, py, 1, s);
			if (right && !hasCell(c.x + 1, c.y)) ctx.rect(px + s - 1, py, 1, s);
		}
		ctx.fill();
	};
	if (solid) {
		// A sunken-channel bevel: dark top/left (the channel's near wall, out
		// of a top-left light), light bottom/right.
		drawEdges(theme.bevelDark, { top: true, left: true });
		drawEdges(theme.bevelLight, { bottom: true, right: true });
	} else {
		const all = { top: true, bottom: true, left: true, right: true };
		drawEdges(texture ? "rgba(0, 0, 0, 0.45)" : theme.cellBorder, all);
	}

	container.appendChild(canvas);
	grid.appendChild(container);
	path.elements = [container];
}

// Redraws one path whose cells changed (e.g. mid-stroke). Its neighbors'
// edges aren't updated until a later full or nearby redraw.
export function renderPathOnly(path) {
	renderPath(path, buildGlobalCellSet());
}

export function rerenderAllPaths() {
	const globalCellSet = buildGlobalCellSet();
	for (const path of paths) renderPath(path, globalCellSet);
}

// Redraws only paths with a cell in or next to `keys` (cellKey()s): those are
// the only ones an erase there can change.
export function rerenderPathsNear(keys) {
	const near = new Set();
	for (const key of keys) {
		near.add(key);
		near.add(key - 1);
		near.add(key + 1);
		near.add(key - CELL_KEY_STRIDE);
		near.add(key + CELL_KEY_STRIDE);
	}
	const globalCellSet = buildGlobalCellSet();
	for (const path of paths) {
		if (path.cells.some((c) => near.has(cellKey(c.x, c.y)))) renderPath(path, globalCellSet);
	}
}

// ---------- selection and menu ----------

// Only the outline changes, so no redraw.
function updatePathSelectionClasses() {
	for (const path of paths) {
		for (const el of path.elements) el.classList.toggle("is-selected", path.id === selectedPathId);
	}
}

export function selectPath(id) {
	selectedPathId = id;
	updatePathSelectionClasses();
}

// Positioned in grid (unzoomed) pixels like the buildings' menu, at the
// path's top-right corner, kept inside the grid.
export function showPathMenuFor(id) {
	const path = findPath(id);
	if (!path || !path.elements.length) return;
	hideActionMenu();
	pathActionMenu.style.display = "flex";
	const menuWidth = pathActionMenu.offsetWidth;
	const menuHeight = pathActionMenu.offsetHeight;
	const { maxX: anchorX, minY: anchorY } = getCellBounds(path.cells);
	let left = (anchorX + 1) * cellSize + 8;
	let top = anchorY * cellSize;
	if (left + menuWidth > gridWidth) left = anchorX * cellSize - menuWidth - 8;
	if (top + menuHeight > gridHeight) top = gridHeight - menuHeight;
	pathActionMenu.style.left = `${Math.max(0, left)}px`;
	pathActionMenu.style.top = `${Math.max(0, top)}px`;
}

// Also deselects the path.
export function hidePathMenu() {
	pathActionMenu.style.display = "none";
	selectPath(null);
}

export function deleteSelectedPath() {
	const index = paths.findIndex((p) => p.id === selectedPathId);
	if (index < 0) return;
	pushUndoState();
	removePathAt(index);
	pathActionMenu.style.display = "none";
	rerenderAllPaths();
	emit("plan-changed");
}

// ---------- saving and loading ----------

export function serializePaths() {
	return paths.map((path) => ({
		id: path.id,
		type: path.type,
		width: path.width,
		cells: path.cells.map((c) => ({ x: c.x, y: c.y })),
	}));
}

const isGridCoord = (value, limit) => Number.isInteger(value) && value >= 0 && value < limit;

// Adds saved paths (as written by serializePaths, or the pre-paintbrush
// from/to format) to the board. Invalid cells and unknown types are dropped
// or defaulted; ids continue after the highest loaded one.
export function restorePaths(savedPaths) {
	if (!Array.isArray(savedPaths)) return;
	let maxId = 0;
	for (const saved of savedPaths) {
		if (!saved) continue;
		let cells;
		if (Array.isArray(saved.cells)) {
			cells = saved.cells
				.filter((c) => c && isGridCoord(c.x, cols) && isGridCoord(c.y, rows))
				.map((c) => ({ x: c.x, y: c.y }));
		} else if (saved.from && saved.to) {
			const line = legacyOrthogonalLine(saved.from.x, saved.from.y, saved.to.x, saved.to.y);
			cells = legacyThickenLine(line, 5, { cols, rows });
		} else {
			continue;
		}
		if (!cells.length) continue;
		const path = {
			id: saved.id || `path_${nextPathId++}`,
			type: isKnownRoadType(saved.type) ? saved.type : "default",
			width: Number.isFinite(saved.width) ? Math.max(1, Math.min(PATH_MAX_WIDTH, Math.round(saved.width))) : 5,
			cells,
			elements: [],
		};
		paths.push(path);
		const match = /_(\d+)$/.exec(String(path.id));
		if (match) maxId = Math.max(maxId, Number(match[1]));
	}
	nextPathId = Math.max(nextPathId, maxId + 1);
	rerenderAllPaths();
}

export function initPaths() {
	pathActionMenu.addEventListener("click", (event) => {
		if (event.target.closest("button")?.dataset.pathAction === "delete") deleteSelectedPath();
	});

	on("display-changed", (setting) => {
		// Textures (top-down) and canal grid lines are drawn into the canvas.
		if ((setting === "topDownRenders" || setting === "gridLines") && paths.length) rerenderAllPaths();
	});
	// Paths restored before the manifest loaded couldn't find their textures.
	on("rooftop-manifest-loaded", () => {
		if (settings.topDownRenders.get() && paths.length) rerenderAllPaths();
	});
	// Path colors come from the theme.
	new MutationObserver(() => {
		pathThemeColors = null;
		if (paths.length) rerenderAllPaths();
	}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
