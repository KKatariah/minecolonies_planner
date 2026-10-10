// The world background: real terrain from uploaded region files, drawn
// behind the grid. Parsing and painting are lib/world-terrain.js (shared with
// World Viewer); this module positions the map, keeps it with the plan, and
// maps grid cells to world coordinates.
//
// The background is always anchored at grid cell (0, 0), and loading one
// sizes the grid to match it exactly, so no manual alignment is needed.
// Saved plans store the rendered image (not the .mca files), so reloading
// doesn't require uploading again.

import { buildTerrainImage, filterMcaFiles } from "../lib/world-terrain.js";
import { getBackground, getBackgroundStamp, putBackground } from "./background-store.js";
import { placedSquares } from "./buildings.js";
import { MAX_PLAN_GRID_DIMENSION, cellSize } from "./config.js";
import { emit } from "./events.js";
import { centerGridOn, setGridSize } from "./grid-view.js";
import {
	bgControlsEl,
	bgFileInput,
	bgFileTriggerButton,
	bgFolderInput,
	bgFolderTriggerButton,
	bgRemoveButton,
	bgStatusEl,
	bgVisibleCheckbox,
	gotoForm,
	gotoXInput,
	gotoZInput,
	grid,
	worldBgCanvas,
	worldBgLayer,
} from "./layout.js";
import { paths } from "./paths.js";

// { gridW, gridH, minCx, minCz, biomeAt, biomeCompact } or null.
// minCx/minCz: the world chunk at grid cell (0, 0).
export let worldBackground = null;

// Bumped whenever the image changes, so saves know when to re-encode it.
let worldBgVersion = 0;
let worldBgDataUrlCache = null; // { version, dataUrl }
// Bumped by every upload, restore and removal; an upload still parsing
// gives up once a newer one starts.
let bgGeneration = 0;

// The world (x, z) at a grid cell, or null without a background.
export function cellToWorld(cellX, cellY) {
	if (!worldBackground) return null;
	return { x: worldBackground.minCx * 16 + cellX, z: worldBackground.minCz * 16 + cellY };
}

// Encoding a multi-region map takes tens of ms on the main thread, so it's
// done once per version, not once per save.
function getWorldBgDataUrl() {
	if (!worldBgDataUrlCache || worldBgDataUrlCache.version !== worldBgVersion) {
		worldBgDataUrlCache = { version: worldBgVersion, dataUrl: worldBgCanvas.toDataURL("image/png") };
	}
	return worldBgDataUrlCache.dataUrl;
}

// A fresh upload's biomeAt() closes over the full parse, which can't be
// saved. This keeps one biome per 4x4 cell (biomes are never finer than
// that), so hovering still names biomes after a reload: ~32KB for a
// 512x512 area instead of 700KB+ per block.
function buildCompactBiomeGrid(result) {
	const cellsX = Math.ceil(result.gridW / 4);
	const cellsZ = Math.ceil(result.gridH / 4);
	const names = [null];
	const ids = new Map();
	const biomeGrid = new Array(cellsX * cellsZ).fill(0);
	for (let cz = 0; cz < cellsZ; cz++) {
		for (let cx = 0; cx < cellsX; cx++) {
			const info = result.biomeAt(result.minCx * 16 + cx * 4 + 2, result.minCz * 16 + cz * 4 + 2);
			if (!info || !info.biome) continue;
			let id = ids.get(info.biome);
			if (id === undefined) {
				id = names.length;
				names.push(info.biome);
				ids.set(info.biome, id);
			}
			biomeGrid[cz * cellsX + cx] = id;
		}
	}
	return { cellsX, cellsZ, names, grid: biomeGrid };
}

function biomeAtFromCompact(compact, minCx, minCz, worldX, worldZ) {
	const cx = Math.floor((worldX - minCx * 16) / 4);
	const cz = Math.floor((worldZ - minCz * 16) / 4);
	if (cx < 0 || cx >= compact.cellsX || cz < 0 || cz >= compact.cellsZ) return null;
	const id = compact.grid[cz * compact.cellsX + cx];
	return id ? { biome: compact.names[id] } : null;
}

function applyWorldBgVisibility() {
	const visible = Boolean(worldBackground) && bgVisibleCheckbox.checked;
	worldBgLayer.hidden = !visible;
	grid.classList.toggle("has-world-bg", visible);
}

// Draws the map at 1 canvas pixel per block, displayed at cellSize per block
// via CSS (crisp, see .world-bg-layer canvas in styles.css).
export function drawWorldBgCanvas(source, gridW, gridH) {
	worldBgVersion++;
	worldBgCanvas.width = gridW;
	worldBgCanvas.height = gridH;
	worldBgCanvas.getContext("2d").drawImage(source, 0, 0);
	worldBgCanvas.style.width = `${gridW * cellSize}px`;
	worldBgCanvas.style.height = `${gridH * cellSize}px`;
	worldBgCanvas.style.left = "0px";
	worldBgCanvas.style.top = "0px";
}

export function removeWorldBackground() {
	worldBackground = null;
	worldBgVersion++;
	worldBgDataUrlCache = null;
	bgGeneration++;
	applyWorldBgVisibility();
	bgControlsEl.hidden = true;
	bgStatusEl.textContent = "";
	bgFileInput.value = "";
	bgFolderInput.value = "";
}

// How far placed buildings and paths reach, so a new background never
// shrinks the grid out from under them.
function computeContentExtent() {
	let maxX = 0;
	let maxY = 0;
	for (const placed of placedSquares) {
		maxX = Math.max(maxX, placed.x + placed.w);
		maxY = Math.max(maxY, placed.y + placed.h);
	}
	for (const path of paths) {
		for (const cell of path.cells) {
			maxX = Math.max(maxX, cell.x + 1);
			maxY = Math.max(maxY, cell.y + 1);
		}
	}
	return { maxX, maxY };
}

async function handleBackgroundFiles(files) {
	const generation = ++bgGeneration;
	const isStale = () => generation !== bgGeneration;
	// The first background of a session jumps the view to world (0, 0);
	// replacing one leaves the view where the user is already looking.
	const shouldJumpToOrigin = !worldBackground;

	bgStatusEl.textContent = `Parsing ${files.length} region file${files.length === 1 ? "" : "s"}…`;
	const result = await buildTerrainImage(files, {
		onStatus: (text) => {
			if (!isStale()) bgStatusEl.textContent = text;
		},
		isStale,
	});
	if (isStale() || result.stale) return;
	if (!result.ok) {
		bgStatusEl.textContent = result.message;
		return;
	}

	drawWorldBgCanvas(result.canvas, result.gridW, result.gridH);
	const extent = computeContentExtent();
	setGridSize(Math.max(result.gridH, extent.maxY), Math.max(result.gridW, extent.maxX));

	worldBackground = {
		gridW: result.gridW,
		gridH: result.gridH,
		minCx: result.minCx,
		minCz: result.minCz,
		biomeAt: result.biomeAt,
		biomeCompact: buildCompactBiomeGrid(result),
	};
	bgControlsEl.hidden = false;
	applyWorldBgVisibility();
	emit("plan-changed");

	if (shouldJumpToOrigin) centerGridOn(-worldBackground.minCx * 16, -worldBackground.minCz * 16);

	const loadedCount = files.length - result.fileErrors.length;
	const successMsg = `Loaded ${result.totalChunks.toLocaleString()} chunks from ${loadedCount} file${loadedCount === 1 ? "" : "s"} (${result.gridW}×${result.gridH} blocks).`;
	bgStatusEl.textContent = result.fileErrors.length
		? `${successMsg} Skipped ${result.fileErrors.length}: ${result.fileErrors.join("; ")}`
		: successMsg;
}

// ---------- saving ----------

// Fully self-contained, image inline - for JSON export.
export function getWorldBackgroundSaveData() {
	if (!worldBackground) return null;
	return {
		dataUrl: getWorldBgDataUrl(),
		gridW: worldBackground.gridW,
		gridH: worldBackground.gridH,
		minCx: worldBackground.minCx,
		minCz: worldBackground.minCz,
		biomeCompact: worldBackground.biomeCompact,
	};
}

// For autosave and named plans: stores the image and biome grid (the parts
// that grow with the upload) in IndexedDB under storeKey and returns only
// the fixed-size metadata for localStorage. Where IndexedDB is unavailable
// it returns everything inline instead.
//
// Autosave runs after every edit but the background rarely changes, so the
// write is skipped when IndexedDB already holds this version. That's checked
// against the stored stamp, not remembered here, so another tab replacing
// the entry (or a deleted plan) is noticed.
const BG_SESSION_ID = Math.random().toString(36).slice(2);
export async function getWorldBackgroundSaveDataLocal(storeKey) {
	if (!worldBackground) return null;
	const { gridW, gridH, minCx, minCz, biomeCompact } = worldBackground; // may be removed while awaiting
	const meta = { gridW, gridH, minCx, minCz };
	const payload = () => ({ dataUrl: getWorldBgDataUrl(), biomeCompact });
	try {
		const stamp = `${BG_SESSION_ID}:${worldBgVersion}`;
		if ((await getBackgroundStamp(storeKey)) === stamp) return meta;
		await putBackground(storeKey, payload(), stamp);
		return meta;
	} catch {
		return { ...meta, ...payload() };
	}
}

// ---------- restoring ----------

// Fills in a saved background's image from IndexedDB when it isn't inline
// (exports and the no-IndexedDB fallback are). A missing entry just means no
// background.
export async function resolveBackgroundForRestore(bg, storeKey) {
	if (!bg) return null;
	if (bg.dataUrl) return bg;
	if (!storeKey) return null;
	try {
		const payload = await getBackground(storeKey);
		return payload ? { ...bg, ...payload } : null;
	} catch {
		return null;
	}
}

const isGridDimension = (v) => Number.isInteger(v) && v > 0 && v <= MAX_PLAN_GRID_DIMENSION;

export async function restoreWorldBackgroundFromSaved(bg) {
	const generation = ++bgGeneration;
	// From an imported file, so untrusted. Only a data: image may reach an
	// <img> - any other URL would make the browser fetch it, telling whoever
	// wrote the file the viewer's IP. The size must be sane before it becomes
	// a canvas.
	const valid =
		bg &&
		typeof bg.dataUrl === "string" &&
		/^data:image\//.test(bg.dataUrl) &&
		isGridDimension(bg.gridW) &&
		isGridDimension(bg.gridH);
	if (!valid) {
		removeWorldBackground();
		return;
	}
	const img = new Image();
	try {
		await new Promise((resolve, reject) => {
			img.onload = resolve;
			img.onerror = () => reject(new Error("image decode failed"));
			img.src = bg.dataUrl;
		});
	} catch {
		removeWorldBackground();
		return;
	}
	if (generation !== bgGeneration) return; // superseded while decoding
	drawWorldBgCanvas(img, bg.gridW, bg.gridH);
	const hasBiomes = bg.biomeCompact && Number.isFinite(bg.minCx) && Number.isFinite(bg.minCz);
	worldBackground = {
		gridW: bg.gridW,
		gridH: bg.gridH,
		minCx: bg.minCx,
		minCz: bg.minCz,
		biomeAt: hasBiomes ? (x, z) => biomeAtFromCompact(bg.biomeCompact, bg.minCx, bg.minCz, x, z) : null,
		biomeCompact: bg.biomeCompact || null,
	};
	bgControlsEl.hidden = false;
	applyWorldBgVisibility();
}

export function initWorldBackground() {
	bgFileTriggerButton.addEventListener("click", () => bgFileInput.click());
	bgFileInput.addEventListener("change", () => {
		if (bgFileInput.files?.length) handleBackgroundFiles(filterMcaFiles([...bgFileInput.files]));
	});
	bgFolderTriggerButton.addEventListener("click", () => bgFolderInput.click());
	bgFolderInput.addEventListener("change", () => {
		const files = filterMcaFiles([...(bgFolderInput.files || [])]);
		if (files.length) handleBackgroundFiles(files);
		else bgStatusEl.textContent = "No .mca region files found in that folder.";
	});
	bgVisibleCheckbox.addEventListener("change", applyWorldBgVisibility);
	bgRemoveButton.addEventListener("click", () => {
		removeWorldBackground();
		emit("plan-changed");
	});

	// Go to coordinates: real world X/Z with a background, plain grid cells
	// without one.
	gotoForm.addEventListener("submit", (event) => {
		event.preventDefault();
		const x = Number(gotoXInput.value);
		const z = Number(gotoZInput.value);
		if (!Number.isFinite(x) || !Number.isFinite(z)) return;
		const origin = cellToWorld(0, 0) || { x: 0, z: 0 };
		centerGridOn(x - origin.x, z - origin.z);
	});
}
