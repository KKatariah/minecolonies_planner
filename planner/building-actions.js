// Edits to the selected buildings: delete, rotate, nudge, and copying -
// either with the Duplicate button or Ctrl+C / Ctrl+V. Both copy flows arm
// a "stamp": the next grid click places the copied group there.

import { canPlaceAt, moveBuilding, placeBuilding, removeBuildings, rotateBuilding } from "./buildings.js";
import { chunkSize } from "./config.js";
import { emit } from "./events.js";
import { clampToBounds, cols, isSnapModifier, rows, snapToGrid } from "./grid-view.js";
import { pushUndoState } from "./history.js";
import { actionMenu } from "./layout.js";
import {
	clearSelection,
	dismissSelection,
	getSelectedEntries,
	hideActionMenu,
	isMenuOpen,
	refreshMenuPosition,
	selectedPlaced,
	selectedPrimary,
	showMenuFor,
} from "./selection.js";

export function deleteSelected() {
	const entries = getSelectedEntries();
	if (!entries.length) return;
	pushUndoState();
	removeBuildings(entries);
	clearSelection();
	disarmStamp();
	dismissSelection();
}

// Rotates the primary selected building about its center, if the turned
// footprint fits.
export function rotateSelected() {
	const entry = selectedPrimary;
	if (!entry) return;
	const nextW = entry.h;
	const nextH = entry.w;
	const desiredX = Math.round(entry.x + entry.w / 2 - nextW / 2);
	const desiredY = Math.round(entry.y + entry.h / 2 - nextH / 2);
	const { x, y } = clampToBounds(desiredX, desiredY, nextW, nextH);
	if (!canPlaceAt(x, y, nextW, nextH, entry)) return;
	pushUndoState();
	rotateBuilding(entry, x, y);
	// Keep an open menu beside the new footprint (but don't open it for R).
	if (isMenuOpen()) showMenuFor(entry);
	emit("plan-changed");
}

// Moves the whole selection by (dx, dy) blocks, if every building fits.
export function moveSelectedBy(dx, dy) {
	const entries = getSelectedEntries();
	if (!entries.length) return false;
	const fits = entries.every((entry) => {
		const x = entry.x + dx;
		const y = entry.y + dy;
		if (x < 0 || y < 0 || x + entry.w > cols || y + entry.h > rows) return false;
		return canPlaceAt(x, y, entry.w, entry.h, selectedPlaced);
	});
	if (!fits) return false;
	pushUndoState();
	for (const entry of entries) moveBuilding(entry, entry.x + dx, entry.y + dy);
	refreshMenuPosition();
	emit("plan-changed");
	return true;
}

// ---------- copying ----------

// The armed copy: { anchor: { w, h }, items: [{ item, dx, dy }] }, offsets
// relative to the anchor building, which lands at the clicked cell.
let stamp = null;
// The last Ctrl+C. A snapshot of plain data, not live entries, so it can be
// pasted any number of times, even after the originals move or are deleted.
let clipboard = null;

export function isStampArmed() {
	return stamp !== null;
}

export function hasClipboard() {
	return clipboard !== null;
}

function disarmStamp() {
	stamp = null;
}

// The selection as an anchor plus offsets, or null if nothing is selected.
function captureSelection() {
	const entries = getSelectedEntries();
	if (!entries.length) return null;
	const anchor = (selectedPrimary && entries.includes(selectedPrimary) && selectedPrimary) || entries[0];
	return { anchor, entries };
}

// The Duplicate button: arms a stamp of the selection.
export function armDuplicate() {
	const captured = captureSelection();
	if (!captured) return;
	const { anchor, entries } = captured;
	stamp = {
		anchor,
		items: entries.map((item) => ({ item, dx: item.x - anchor.x, dy: item.y - anchor.y })),
	};
	hideActionMenu();
}

export function copySelection() {
	const captured = captureSelection();
	if (!captured) return;
	const { anchor, entries } = captured;
	clipboard = {
		anchor: { w: anchor.w, h: anchor.h },
		items: entries.map((item) => ({
			item: {
				id: item.id,
				label: item.label,
				w: item.w,
				h: item.h,
				category: item.category,
				emoji: item.emoji,
				styleFile: item.styleFile,
				rotated: item.rotated,
				rotation: item.rotation,
			},
			dx: item.x - anchor.x,
			dy: item.y - anchor.y,
		})),
	};
}

// Re-armed from the clipboard each time, so one copy can be pasted repeatedly.
export function pasteClipboard() {
	if (!clipboard) return;
	stamp = { anchor: clipboard.anchor, items: clipboard.items };
	hideActionMenu();
}

// Where the armed copy would go with its anchor at `cell` (snapped to
// chunks with Ctrl/Cmd): { targets: [{ item, x, y }], fits }, or null with
// no copy armed or no spot on the grid. `fits` is false if any building
// would leave the grid or overlap another.
export function getStampTargets(cell, event) {
	if (!stamp) return null;
	const step = isSnapModifier(event) ? chunkSize : 1;
	const snap = snapToGrid(cell.x, cell.y, stamp.anchor.w || 1, stamp.anchor.h || 1, step);
	if (!snap) return null;
	const targets = stamp.items.map(({ item, dx, dy }) => ({ item, x: snap.x + dx, y: snap.y + dy }));
	const fits = targets.every(({ item, x, y }) => {
		if (x < 0 || y < 0 || x + item.w > cols || y + item.h > rows) return false;
		return canPlaceAt(x, y, item.w, item.h);
	});
	return { targets, fits };
}

// Places the armed copy with its anchor at `cell`. Returns whether it was
// placed - not if any building wouldn't fit.
export function stampAt(cell, event) {
	const placement = getStampTargets(cell, event);
	if (!placement?.fits) return false;
	pushUndoState();
	for (const { item, x, y } of placement.targets) placeBuilding(x, y, item);
	disarmStamp();
	return true;
}

export function initBuildingActions() {
	actionMenu.addEventListener("click", (event) => {
		const action = event.target.closest("button")?.dataset.action;
		if (action === "rotate") rotateSelected();
		else if (action === "delete") deleteSelected();
		else if (action === "duplicate") armDuplicate();
	});
}
