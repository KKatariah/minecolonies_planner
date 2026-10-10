// The planning grid's size, zoom and scroll position, and conversion between
// screen coordinates and grid cells (1 cell = 1 block).
//
// Zoom is a CSS transform on .grid-shell; everything inside the grid stays
// positioned in unzoomed pixels and is scaled with it. A transform doesn't
// change layout size, so .grid-zoom-sizer is sized to the zoomed grid to
// keep #root's scrollbars right, and pointer math divides by
// cellSize * gridZoom.

import { readStored, writeStored } from "../lib/storage.js";
import { DEFAULT_GRID_SIZE, cellSize } from "./config.js";
import { grid, gridShell, gridZoomSizer, root, worldBgLayer, zoomControls } from "./layout.js";

export let rows = DEFAULT_GRID_SIZE;
export let cols = DEFAULT_GRID_SIZE;
export let gridZoom = 1;
// The grid's unzoomed size in CSS px.
export let gridWidth = 0;
export let gridHeight = 0;

const MIN_GRID_ZOOM = 0.5;
const MAX_GRID_ZOOM = 4;

export function setGridSize(nextRows, nextCols) {
	rows = nextRows;
	cols = nextCols;
	gridWidth = cols * cellSize;
	gridHeight = rows * cellSize;
	grid.style.width = `${gridWidth}px`;
	grid.style.height = `${gridHeight}px`;
	// The world background is cropped to the grid.
	worldBgLayer.style.width = `${gridWidth}px`;
	worldBgLayer.style.height = `${gridHeight}px`;
	applyGridZoom();
}

function applyGridZoom() {
	gridShell.style.transform = `scale(${gridZoom})`;
	// For overlays that stay the same size on screen (door markers).
	gridShell.style.setProperty("--grid-zoom", gridZoom);
	gridZoomSizer.style.width = `${gridWidth * gridZoom}px`;
	gridZoomSizer.style.height = `${gridHeight * gridZoom}px`;
}

const clampZoom = (zoom) => Math.max(MIN_GRID_ZOOM, Math.min(MAX_GRID_ZOOM, zoom));

// Zooms keeping the content under the anchor point (client coordinates)
// where it is, so zooming doesn't jump the view back to the origin.
export function setGridZoom(nextZoom, anchorClientX, anchorClientY) {
	const clamped = clampZoom(nextZoom);
	if (clamped === gridZoom) return;
	const rootRect = root.getBoundingClientRect();
	const contentX = (anchorClientX - rootRect.left + root.scrollLeft) / gridZoom;
	const contentY = (anchorClientY - rootRect.top + root.scrollTop) / gridZoom;
	gridZoom = clamped;
	applyGridZoom();
	root.scrollLeft = contentX * gridZoom - (anchorClientX - rootRect.left);
	root.scrollTop = contentY * gridZoom - (anchorClientY - rootRect.top);
}

function zoomAtViewportCenter(factor) {
	const rect = root.getBoundingClientRect();
	setGridZoom(gridZoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

// Scrolls so grid cell (cellX, cellY) is centered, at the current zoom.
export function centerGridOn(cellX, cellY) {
	const rect = root.getBoundingClientRect();
	// Where cell (0, 0) sits in #root's scrollable content (the grid is inset
	// by its border and padding).
	const origin = getGridOrigin();
	const originX = origin.left - rect.left + root.scrollLeft;
	const originY = origin.top - rect.top + root.scrollTop;
	const onScreenCellSize = cellSize * gridZoom;
	root.scrollLeft = originX + (cellX + 0.5) * onScreenCellSize - rect.width / 2;
	root.scrollTop = originY + (cellY + 0.5) * onScreenCellSize - rect.height / 2;
}

// ---------- remembered view ----------

const GRID_VIEW_STORAGE_KEY = "minecolonies.gridView.v1";
let gridViewSaveTimer = null;

// Debounced; called on every scroll, which also covers zooming and go-to.
function saveGridView() {
	clearTimeout(gridViewSaveTimer);
	gridViewSaveTimer = setTimeout(() => {
		writeStored(
			GRID_VIEW_STORAGE_KEY,
			JSON.stringify({ zoom: gridZoom, scrollLeft: root.scrollLeft, scrollTop: root.scrollTop }),
		);
	}, 300);
}

// Must run after the grid has its final size (a restored plan can resize
// it), or the browser clamps the scroll position to the smaller grid.
export function restoreGridView() {
	try {
		const saved = JSON.parse(readStored(GRID_VIEW_STORAGE_KEY));
		if (!saved) return;
		if (Number.isFinite(saved.zoom)) {
			gridZoom = clampZoom(saved.zoom);
			applyGridZoom();
		}
		if (Number.isFinite(saved.scrollLeft)) root.scrollLeft = saved.scrollLeft;
		if (Number.isFinite(saved.scrollTop)) root.scrollTop = saved.scrollTop;
	} catch {
		// Corrupt saved view - start at the origin.
	}
}

// ---------- screen <-> grid ----------

// Screen position of cell (0, 0)'s top-left corner: inside .grid's border,
// which getBoundingClientRect() includes.
export function getGridOrigin() {
	const rect = grid.getBoundingClientRect();
	return {
		left: rect.left + grid.clientLeft * gridZoom,
		top: rect.top + grid.clientTop * gridZoom,
	};
}

// The cell under a client point, or null outside the grid.
export function getCellFromPoint(clientX, clientY) {
	const origin = getGridOrigin();
	const onScreenCellSize = cellSize * gridZoom;
	const x = Math.floor((clientX - origin.left) / onScreenCellSize);
	const y = Math.floor((clientY - origin.top) / onScreenCellSize);
	if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
	return { x, y };
}

// Fractional cell coordinates, clamped to the grid (for the marquee, which
// tracks the cursor exactly and keeps going past the edge).
export function getGridPointFromClient(clientX, clientY) {
	const origin = getGridOrigin();
	const onScreenCellSize = cellSize * gridZoom;
	return {
		x: Math.max(0, Math.min(cols, (clientX - origin.left) / onScreenCellSize)),
		y: Math.max(0, Math.min(rows, (clientY - origin.top) / onScreenCellSize)),
	};
}

// Ctrl, or Cmd on a Mac (where Ctrl+click is a right-click).
export function isSnapModifier(event) {
	return event.ctrlKey || event.metaKey;
}

export function clampToBounds(x, y, w, h) {
	return {
		x: Math.min(Math.max(x, 0), cols - w),
		y: Math.min(Math.max(y, 0), rows - h),
	};
}

// Rounds (x, y) to a multiple of step and keeps a w x h footprint on the
// grid. null if the footprint can't fit at all.
export function snapToGrid(x, y, w, h, step) {
	if (w > cols || h > rows) return null;
	const snapStep = Math.max(1, step || 1);
	return clampToBounds(Math.round(x / snapStep) * snapStep, Math.round(y / snapStep) * snapStep, w, h);
}

// Top-left cell for a w x h footprint centered on a client point.
export function getCenteredSnapPoint(clientX, clientY, w, h, step) {
	const origin = getGridOrigin();
	const onScreenCellSize = cellSize * gridZoom;
	const x = Math.round((clientX - origin.left) / onScreenCellSize - w / 2);
	const y = Math.round((clientY - origin.top) / onScreenCellSize - h / 2);
	return snapToGrid(x, y, w, h, step);
}

// ---------- controls ----------

export function initGridView() {
	setGridSize(rows, cols);

	zoomControls.querySelector("[data-zoom-in]").addEventListener("click", () => zoomAtViewportCenter(1.25));
	zoomControls.querySelector("[data-zoom-out]").addEventListener("click", () => zoomAtViewportCenter(1 / 1.25));
	zoomControls.querySelector("[data-zoom-reset]").addEventListener("click", () => zoomAtViewportCenter(1 / gridZoom));

	root.addEventListener("scroll", saveGridView);

	// Ctrl/Cmd+wheel zooms (it's also how browsers report a trackpad pinch);
	// a plain wheel scrolls natively.
	root.addEventListener(
		"wheel",
		(event) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			setGridZoom(gridZoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), event.clientX, event.clientY);
		},
		{ passive: false },
	);
}
