// Everything the mouse does on the grid. Each drag is its own gesture
// (lib/pointer-gesture.js), with its state in a closure:
//
//   left-drag a building          move it (and the rest of the selection)
//   left-drag the selected path   move the path
//   left-drag, Roads & Rivers     paint (canal: freehand), draw a run, or erase
//   left-drag empty grid          marquee select (Shift adds)
//   right-drag empty grid         pan
//
// and clicks:
//   building        select it (Shift toggles); right-click opens its menu
//   path            select it and open its menu
//   empty grid      place the armed shape or stamp a copy; otherwise deselect
//
// Buildings and paths are handled by delegation from the grid, so they carry
// no listeners of their own. A drag that really moved swallows the click
// that follows it (suppressNextClick), so finishing a drag never also
// places or deselects.

import { suppressNextClick, trackPointerGesture } from "../lib/pointer-gesture.js";
import { formatBiomeName } from "../lib/world-terrain.js";
import { getStampTargets, isStampArmed, stampAt } from "./building-actions.js";
import { canPlaceAt, getBuildingForElement, moveBuilding, placeBuilding } from "./buildings.js";
import {
	bresenhamLine,
	brushExtent,
	cellKey,
	constrainToAxis,
	getCellBounds,
	keysToCells,
	runRect,
	stampBrush,
} from "./cell-geometry.js";
import { cellSize, chunkSize } from "./config.js";
import { emit, on } from "./events.js";
import {
	cols,
	getCellFromPoint,
	getCenteredSnapPoint,
	getGridPointFromClient,
	isSnapModifier,
	rows,
	snapToGrid,
} from "./grid-view.js";
import { commitUndoSnapshot, pushUndoState, takeUndoSnapshot } from "./history.js";
import {
	grid,
	hoverCoordsBiomeEl,
	hoverCoordsEl,
	hoverCoordsPosEl,
	marqueeEl,
	previewSidebar,
	root,
	runDrawPreviewEl,
} from "./layout.js";
import {
	getPathWidth,
	hideEraserHoverPreview,
	isPieceMode,
	pathEraseMode,
	pathToolActive,
	pathType,
	updateEraserHoverPreview,
} from "./path-tool.js";
import {
	addPath,
	eraseCells,
	findPath,
	hidePathMenu,
	renderPathOnly,
	rerenderAllPaths,
	rerenderPathsNear,
	selectPath,
	paths,
	selectedPathId,
	showPathMenuFor,
	splitDisconnectedPaths,
} from "./paths.js";
import {
	commitMarqueeSelection,
	dismissSelection,
	getSelectedEntries,
	hideActionMenu,
	refreshMenuPosition,
	selectBuilding,
	selectedPlaced,
	selectedPrimary,
	setMarqueeSelection,
	setPrimary,
	showMenuFor,
} from "./selection.js";
import { disarmShape, getSelectedShape, getSelectedShapeDimensions, pendingRotated } from "./tray.js";
import { flashPlacementBlocked, hidePlacementGhosts, showPlacementGhosts } from "./placement-ghost.js";
import { placeRoadRun, resolveRoadRun, translateRuns } from "./road-runs.js";
import { isFreehandType } from "./road-types.js";
import { getActiveRunKit, placePieceRun, resolvePieceRun } from "./run-network.js";
import { worldBackground } from "./world-background.js";

// Movement (CSS px) before a press becomes a drag rather than a click.
const DRAG_THRESHOLD = 4;

let buildingDragActive = false;

const gridBounds = () => ({ cols, rows });

// ---------- moving buildings ----------

// The anchor position range that keeps every building in the group on the grid.
function clampGroupAnchor(anchorX, anchorY, items) {
	let minX = -Infinity;
	let maxX = Infinity;
	let minY = -Infinity;
	let maxY = Infinity;
	for (const { item, dx, dy } of items) {
		minX = Math.max(minX, -dx);
		maxX = Math.min(maxX, cols - item.w - dx);
		minY = Math.max(minY, -dy);
		maxY = Math.min(maxY, rows - item.h - dy);
	}
	return { x: Math.min(Math.max(anchorX, minX), maxX), y: Math.min(Math.max(anchorY, minY), maxY) };
}

// Moves the group so the anchor's center follows the cursor, kept on the
// grid. It goes over other buildings too, outlined red while it's somewhere
// it can't stay; dropped there, it snaps back (see startBuildingDrag).
// Returns whether the group fits where it is.
function moveDragGroup(group, event) {
	const { anchor, items } = group;
	const step = isSnapModifier(event) ? chunkSize : 1;
	const snap = getCenteredSnapPoint(event.clientX, event.clientY, anchor.w, anchor.h, step);
	if (!snap) return group.fits;
	const at = clampGroupAnchor(snap.x, snap.y, items);
	for (const { item, dx, dy } of items) moveBuilding(item, at.x + dx, at.y + dy);
	group.fits = items.every(({ item }) => canPlaceAt(item.x, item.y, item.w, item.h, selectedPlaced));
	for (const { item } of items) item.el.classList.toggle("is-blocked", !group.fits);
	return group.fits;
}

function startBuildingDrag(event, entry) {
	// Pressing an unselected building selects it; Shift-press leaves the
	// toggle to the click that follows.
	if (!selectedPlaced.has(entry) && !event.shiftKey) selectBuilding(entry, false);
	if (!selectedPlaced.has(entry)) return;
	let group = null;
	trackPointerGesture(event, {
		captureTarget: entry.el,
		captureOnStart: true,
		threshold: DRAG_THRESHOLD,
		onStart: (move) => {
			move.preventDefault();
			buildingDragActive = true;
			hideActionMenu();
			group = {
				anchor: entry,
				items: getSelectedEntries().map((item) => ({
					item,
					dx: item.x - entry.x,
					dy: item.y - entry.y,
					from: { x: item.x, y: item.y },
				})),
				fits: true,
				// Committed to history only if the drop stands.
				undoSnapshot: takeUndoSnapshot(),
			};
			for (const { item } of group.items) item.el.classList.add("is-dragging");
		},
		onMove: (move) => moveDragGroup(group, move),
		onEnd: (_, { started }) => {
			if (!started) return;
			buildingDragActive = false;
			const moved = group.items.some(({ item, from }) => item.x !== from.x || item.y !== from.y);
			for (const { item, from } of group.items) {
				item.el.classList.remove("is-dragging", "is-blocked");
				if (!group.fits) moveBuilding(item, from.x, from.y);
			}
			if (group.fits && moved) {
				commitUndoSnapshot(group.undoSnapshot);
				emit("plan-changed");
			}
			refreshMenuPosition();
			suppressNextClick();
		},
	});
}

// ---------- paths ----------

function startPathDrag(event, path) {
	const startCell = getCellFromPoint(event.clientX, event.clientY);
	if (!startCell) return;
	event.preventDefault();
	const origCells = path.cells.map((c) => ({ ...c }));
	const origRuns = path.runs;
	const bounds = getCellBounds(path.cells);
	let dragging = false;
	trackPointerGesture(event, {
		captureTarget: grid,
		onMove: (move) => {
			const cell = getCellFromPoint(move.clientX, move.clientY);
			if (!cell) return;
			const dx = cell.x - startCell.x;
			const dy = cell.y - startCell.y;
			if (!dragging && (dx || dy)) {
				dragging = true;
				pushUndoState();
			}
			if (!dragging) return;
			// Clamped so the whole path stays on the grid.
			const cdx = Math.max(-bounds.minX, Math.min(cols - 1 - bounds.maxX, dx));
			const cdy = Math.max(-bounds.minY, Math.min(rows - 1 - bounds.maxY, dy));
			path.cells = origCells.map((c) => ({ x: c.x + cdx, y: c.y + cdy }));
			translateRuns(path, origRuns, cdx, cdy);
			rerenderAllPaths();
		},
		onEnd: () => {
			if (!dragging) return;
			emit("plan-changed");
			suppressNextClick();
		},
	});
}

// Drags out a straight Path run (along whichever axis moved further),
// painted on release, snapped to nearby runs (road-runs.js) unless Alt is
// held. A plain click paints a single square.
function startRoadDraw(event, startCell) {
	event.preventDefault();
	const width = getPathWidth();
	let axis = "horizontal";
	let endCell = startCell;
	trackPointerGesture(event, {
		captureTarget: grid,
		onMove: (move) => {
			const cell = getCellFromPoint(move.clientX, move.clientY);
			if (!cell) return;
			if (endCell === startCell && cell.x === startCell.x && cell.y === startCell.y) return;
			move.preventDefault();
			endCell = constrainToAxis(startCell, cell);
			axis = endCell.y === startCell.y ? "horizontal" : "vertical";
			const run = resolveRoadRun(pathType, width, axis, startCell, endCell, { snap: !move.altKey });
			showRunPreview(runRect(run, width));
		},
		onEnd: (up, { cancelled }) => {
			runDrawPreviewEl.style.display = "none";
			if (cancelled) return;
			pushUndoState();
			const path = placeRoadRun(pathType, width, axis, startCell, endCell, gridBounds(), { snap: !up.altKey });
			renderPathOnly(path);
			// Neighboring paths' edges are only reconciled once, at the end.
			rerenderAllPaths();
			emit("plan-changed");
		},
	});
}

// Paints a freehand stroke (canal). Every pointer sample stamps a brush
// square, with the gap since the previous sample filled in, so fast strokes
// have no holes. Holding Shift constrains the stroke from where Shift went
// down to a straight line, recomputed from that point on each move so the
// line can swing; releasing Shift keeps the line and goes back to freehand.
// Nothing snaps.
function startPaintStroke(event, cell) {
	event.preventDefault();
	pushUndoState();
	const path = addPath({ type: pathType, width: getPathWidth() });
	const keys = new Set();
	stampBrush(keys, cell.x, cell.y, path.width, gridBounds());
	path.cells = keysToCells(keys);
	renderPathOnly(path);
	let lastCell = cell;
	let shiftAnchor = null;
	let shiftBaseline = null;
	const stampLine = (into, from, to) => {
		for (const point of bresenhamLine(from.x, from.y, to.x, to.y)) {
			stampBrush(into, point.x, point.y, path.width, gridBounds());
		}
	};
	trackPointerGesture(event, {
		captureTarget: grid,
		onMove: (move) => {
			const cell = getCellFromPoint(move.clientX, move.clientY);
			if (!cell) return;
			if (move.shiftKey) {
				if (!shiftAnchor) {
					shiftAnchor = lastCell;
					shiftBaseline = new Set(keys);
				}
				const preview = new Set(shiftBaseline);
				stampLine(preview, shiftAnchor, constrainToAxis(shiftAnchor, cell));
				path.cells = keysToCells(preview);
			} else {
				if (shiftAnchor) {
					// Shift released: keep the straight segment, continue from its end.
					keys.clear();
					for (const c of path.cells) keys.add(cellKey(c.x, c.y));
					lastCell = constrainToAxis(shiftAnchor, cell);
					shiftAnchor = null;
					shiftBaseline = null;
				}
				stampLine(keys, lastCell, cell);
				lastCell = cell;
				path.cells = keysToCells(keys);
			}
			renderPathOnly(path);
		},
		onEnd: () => {
			// Neighboring paths' edges are only reconciled once, at the end.
			rerenderAllPaths();
			emit("plan-changed");
		},
	});
}

// Erases brush squares along the stroke from every path. A path the stroke
// cuts in two (say, through a T junction) becomes two paths at the end.
function startEraseStroke(event, cell) {
	event.preventDefault();
	pushUndoState();
	const touched = new Set();
	const eraseAlong = (from, to) => {
		const keys = new Set();
		for (const point of bresenhamLine(from.x, from.y, to.x, to.y)) {
			stampBrush(keys, point.x, point.y, getPathWidth(), gridBounds());
		}
		const changed = eraseCells(keys);
		if (!changed.length) return;
		for (const path of changed) touched.add(path);
		rerenderPathsNear(keys);
	};
	eraseAlong(cell, cell);
	let lastCell = cell;
	trackPointerGesture(event, {
		captureTarget: grid,
		onMove: (move) => {
			const next = getCellFromPoint(move.clientX, move.clientY);
			if (!next) return;
			eraseAlong(lastCell, next);
			lastCell = next;
		},
		onEnd: () => {
			const before = paths.length;
			splitDisconnectedPaths(touched);
			if (paths.length !== before) rerenderAllPaths();
			emit("plan-changed");
		},
	});
}

// Outlines where a run will go: { x, y, w, h } in cells.
function showRunPreview(rect) {
	Object.assign(runDrawPreviewEl.style, {
		display: "block",
		left: `${rect.x * cellSize}px`,
		top: `${rect.y * cellSize}px`,
		width: `${rect.w * cellSize}px`,
		height: `${rect.h * cellSize}px`,
	});
}

// A piece run covers the drawn span exactly, at the kit's thickness.
function showPieceRunPreview(kit, run) {
	const horizontal = run.axis === "horizontal";
	const line = horizontal ? run.start.y : run.start.x;
	const across = line - brushExtent(kit.thickness).before;
	const runMin = horizontal ? Math.min(run.start.x, run.end.x) : Math.min(run.start.y, run.end.y);
	const runLength = (horizontal ? Math.abs(run.end.x - run.start.x) : Math.abs(run.end.y - run.start.y)) + 1;
	showRunPreview({
		x: horizontal ? runMin : across,
		y: horizontal ? across : runMin,
		w: horizontal ? runLength : kit.thickness,
		h: horizontal ? kit.thickness : runLength,
	});
}

// Drags out a straight run of blueprint pieces (walls, Caledonia's road
// families) along whichever axis moved further, placed on release - snapped
// to nearby runs unless Alt is held. A plain
// click instead selects the building under it - the pointer is captured by
// the grid, so the building's own click would never arrive.
function startPieceRunDraw(event, startCell) {
	event.preventDefault();
	const downTarget = event.target;
	const type = pathType;
	const kit = getActiveRunKit(type);
	let axis = null;
	let endCell = null;
	trackPointerGesture(event, {
		captureTarget: grid,
		onMove: (move) => {
			const cell = getCellFromPoint(move.clientX, move.clientY);
			if (!cell) return;
			if (!endCell && cell.x === startCell.x && cell.y === startCell.y) return;
			move.preventDefault();
			endCell = constrainToAxis(startCell, cell);
			axis = endCell.y === startCell.y ? "horizontal" : "vertical";
			showPieceRunPreview(kit, resolvePieceRun(type, axis, startCell, endCell, { snap: !move.altKey }));
		},
		onEnd: (up, { cancelled }) => {
			runDrawPreviewEl.style.display = "none";
			if (cancelled) return;
			if (endCell) {
				pushUndoState();
				placePieceRun(type, axis, startCell, endCell, { snap: !up.altKey });
				emit("plan-changed");
				return;
			}
			const buildingEl = downTarget.closest?.(".placed-square");
			if (buildingEl) {
				selectBuilding(getBuildingForElement(buildingEl), up.shiftKey);
				suppressNextClick();
			}
		},
	});
}

// ---------- empty grid ----------

function startPan(event) {
	const startLeft = root.scrollLeft;
	const startTop = root.scrollTop;
	// Captured immediately: a trackpad's first move can already be outside
	// the grid.
	trackPointerGesture(event, {
		captureTarget: grid,
		threshold: DRAG_THRESHOLD,
		onStart: () => grid.classList.add("is-panning"),
		onMove: (move) => {
			move.preventDefault();
			root.scrollLeft = startLeft - (move.clientX - event.clientX);
			root.scrollTop = startTop - (move.clientY - event.clientY);
		},
		onEnd: (_, { started }) => {
			if (!started) return;
			grid.classList.remove("is-panning");
			suppressNextClick();
		},
	});
}

// Rubber-band selection: everything the rectangle touches, plus (with
// Shift) whatever was already selected.
function startMarquee(event) {
	event.preventDefault();
	const preserved = event.shiftKey ? new Set(selectedPlaced) : new Set();
	const start = getGridPointFromClient(event.clientX, event.clientY);
	trackPointerGesture(event, {
		captureTarget: grid,
		threshold: DRAG_THRESHOLD,
		onStart: () => {
			marqueeEl.style.display = "block";
		},
		onMove: (move) => {
			move.preventDefault();
			const point = getGridPointFromClient(move.clientX, move.clientY);
			const rect = {
				x: Math.min(start.x, point.x),
				y: Math.min(start.y, point.y),
				w: Math.abs(point.x - start.x),
				h: Math.abs(point.y - start.y),
			};
			Object.assign(marqueeEl.style, {
				left: `${rect.x * cellSize}px`,
				top: `${rect.y * cellSize}px`,
				width: `${rect.w * cellSize}px`,
				height: `${rect.h * cellSize}px`,
			});
			setMarqueeSelection(preserved, rect);
		},
		onEnd: (_, { started }) => {
			if (!started) return;
			marqueeEl.style.display = "none";
			commitMarqueeSelection();
			refreshMenuPosition();
			suppressNextClick();
		},
	});
}

// Whether a left click is for placing: a tray building or a copy is armed.
// Clicks over existing buildings then try to place too (and show why they
// can't) rather than selecting them.
function isPlacementArmed() {
	return !pathToolActive && (!!getSelectedShape() || isStampArmed());
}

function handlePointerDown(event) {
	const buildingEl = event.target.closest(".placed-square");
	// With the road tool off, a building takes the press (right-click is its
	// menu, see the contextmenu handler) - unless a placement is armed.
	if (buildingEl && !pathToolActive && !(isPlacementArmed() && event.button === 0)) {
		if (event.button === 0) startBuildingDrag(event, getBuildingForElement(buildingEl));
		return;
	}

	if (!pathToolActive && selectedPathId && event.button === 0) {
		const pathEl = event.target.closest(".placed-path");
		if (pathEl && pathEl.dataset.pathId === selectedPathId) {
			const path = findPath(selectedPathId);
			if (path) startPathDrag(event, path);
			return;
		}
	}

	// Left button is the brush while the Roads & Rivers tool is armed, even
	// over a building; panning stays on the right button.
	if (pathToolActive && event.button === 0) {
		const cell = getCellFromPoint(event.clientX, event.clientY);
		if (!cell) return;
		if (pathEraseMode) startEraseStroke(event, cell);
		else if (isPieceMode()) startPieceRunDraw(event, cell);
		else if (isFreehandType(pathType)) startPaintStroke(event, cell);
		else startRoadDraw(event, cell);
		return;
	}

	if (event.target.closest(".placed-square, .placed-path, .action-menu, .path-action-menu")) return;
	if (event.button === 2) startPan(event);
	// While a copy is armed, a left press is for stamping it (on click).
	else if (event.button === 0 && !isStampArmed()) startMarquee(event);
}

// ---------- clicks ----------

// Where the armed tray shape would go for a pointer at (clientX, clientY):
// { shape, x, y, w, h, fits }, or null with nothing armed or off the grid.
function getArmedShapePlacement(clientX, clientY, snapToChunks) {
	const shape = getSelectedShape();
	if (!shape) return null;
	const { w, h } = getSelectedShapeDimensions(shape);
	const cell = getCellFromPoint(clientX, clientY);
	if (!cell) return null;
	const snap = snapToGrid(cell.x, cell.y, w, h, snapToChunks ? chunkSize : 1);
	if (!snap) return null;
	return { shape, x: snap.x, y: snap.y, w, h, fits: canPlaceAt(snap.x, snap.y, w, h) };
}

function placeArmedShape(event) {
	const placement = getArmedShapePlacement(event.clientX, event.clientY, isSnapModifier(event));
	if (!placement) return;
	if (!placement.fits) {
		flashPlacementBlocked();
		return;
	}
	const { shape, x, y, w, h } = placement;
	pushUndoState();
	placeBuilding(x, y, { ...shape, w, h, rotated: pendingRotated });
	disarmShape();
}

function handleGridClick(event) {
	if (event.target.closest(".action-menu, .path-action-menu")) return;

	// A building click selects it - except under the road brush (the click
	// was a paint stroke), but the piece brushes only draw on a real drag.
	const buildingEl = event.target.closest(".placed-square");
	if (buildingEl && (!pathToolActive || isPieceMode()) && !isPlacementArmed()) {
		selectBuilding(getBuildingForElement(buildingEl), event.shiftKey);
		return;
	}

	hidePathMenu();
	if (!pathToolActive) {
		const pathEl = event.target.closest(".placed-path");
		if (pathEl?.dataset.pathId) {
			selectPath(pathEl.dataset.pathId);
			showPathMenuFor(pathEl.dataset.pathId);
			return;
		}
	}
	if (!buildingEl && !isStampArmed()) dismissSelection();
	if (pathToolActive) return;
	if (isStampArmed()) {
		const cell = getCellFromPoint(event.clientX, event.clientY);
		if (cell && !stampAt(cell, event)) flashPlacementBlocked();
	} else {
		placeArmedShape(event);
	}
	updatePlacementGhost();
}

// Right-click on a building opens its menu (selecting it first if needed).
// The browser's own menu is suppressed everywhere on the grid, since
// right-drag pans.
function handleContextMenu(event) {
	event.preventDefault();
	const buildingEl = event.target.closest(".placed-square");
	if (!buildingEl || buildingDragActive) return;
	const entry = getBuildingForElement(buildingEl);
	if (!selectedPlaced.has(entry)) selectBuilding(entry, event.shiftKey);
	else if (!selectedPrimary) setPrimary(entry);
	showMenuFor(selectedPrimary || entry);
}

// Clicking anywhere outside the grid's buildings deselects - except in the
// preview pane, whose controls (e.g. the cost level buttons) are about the
// selection. composedPath() rather than closest(): those buttons re-render
// on click, so by now the clicked element may be detached.
function handleDocumentClick(event) {
	if (event.target.closest(".action-menu, .placed-square")) return;
	if (event.composedPath().includes(previewSidebar)) return;
	dismissSelection();
}

// ---------- placement ghost ----------

// The last pointer position over the grid (null once it leaves), so the
// ghost can be redrawn when something other than the mouse changes it: R
// rotating the armed shape, Ctrl/Cmd toggling chunk snapping, Escape.
let lastPointer = null;

// Shows the armed building (or copy) where a click would place it, green or
// red by whether it fits (placement-ghost.js), or hides it. `snapToChunks`
// defaults to the last pointer event's modifier.
function updatePlacementGhost(snapToChunks = lastPointer?.snapToChunks ?? false) {
	if (!lastPointer || pathToolActive || buildingDragActive || lastPointer.buttons) {
		hidePlacementGhosts();
		return;
	}
	const { clientX, clientY } = lastPointer;
	if (isStampArmed()) {
		const cell = getCellFromPoint(clientX, clientY);
		const placement = cell && getStampTargets(cell, { ctrlKey: snapToChunks });
		if (!placement) return hidePlacementGhosts();
		const ghosts = placement.targets.map(({ item, x, y }) => ({
			shape: item,
			x,
			y,
			w: item.w,
			h: item.h,
			rotation: item.rotation ?? (item.rotated ? 1 : 0),
		}));
		showPlacementGhosts(ghosts, placement.fits);
		return;
	}
	const placement = getArmedShapePlacement(clientX, clientY, snapToChunks);
	if (!placement) return hidePlacementGhosts();
	const { shape, x, y, w, h, fits } = placement;
	showPlacementGhosts([{ shape, x, y, w, h, rotation: pendingRotated ? 1 : 0 }], fits);
}

function trackPointerForGhost(event) {
	// No hover on touch, so a ghost would just be left behind.
	if (event.pointerType === "touch") {
		lastPointer = null;
	} else {
		lastPointer = {
			clientX: event.clientX,
			clientY: event.clientY,
			buttons: event.buttons,
			snapToChunks: isSnapModifier(event),
		};
	}
	updatePlacementGhost();
}

function handleGhostKey(event) {
	if (!lastPointer) return;
	// Let the key's own handler (rotate, disarm) run first.
	queueMicrotask(() => {
		lastPointer.snapToChunks = isSnapModifier(event);
		updatePlacementGhost();
	});
}

// ---------- hover readout ----------

// Block coordinates under the cursor, plus the biome with a world background.
function handleHover(event) {
	const cell = getCellFromPoint(event.clientX, event.clientY);
	updateEraserHoverPreview(cell);
	if (!cell) {
		hoverCoordsEl.hidden = true;
		return;
	}
	hoverCoordsEl.hidden = false;
	hoverCoordsPosEl.textContent = `Block (${cell.x}, ${cell.y})`;
	const info = worldBackground?.biomeAt?.(worldBackground.minCx * 16 + cell.x, worldBackground.minCz * 16 + cell.y);
	hoverCoordsBiomeEl.textContent = info?.biome ? formatBiomeName(info.biome) : "";
}

export function initGridPointer() {
	grid.addEventListener("pointerdown", handlePointerDown);
	grid.addEventListener("click", handleGridClick);
	grid.addEventListener("contextmenu", handleContextMenu);
	document.addEventListener("click", handleDocumentClick);
	grid.addEventListener("pointermove", handleHover);
	grid.addEventListener("pointermove", trackPointerForGhost);
	grid.addEventListener("pointerleave", () => {
		hoverCoordsEl.hidden = true;
		hideEraserHoverPreview();
		lastPointer = null;
		hidePlacementGhosts();
	});
	document.addEventListener("keydown", handleGhostKey);
	document.addEventListener("keyup", handleGhostKey);
	// Arming, disarming or switching tabs from the tray.
	on("selection-changed", () => updatePlacementGhost());
}
