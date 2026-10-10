// Which placed buildings are selected, and the action menu (Rotate / Delete
// / Duplicate) shown beside them. Changes are announced as
// "selection-changed"; payload.buildingSelected is true when a building was
// newly selected (the tray disarms its shape, the cost panel resets its level).

import { cellSize } from "./config.js";
import { emit } from "./events.js";
import { gridHeight, gridWidth } from "./grid-view.js";
import { actionMenu } from "./layout.js";
import { hidePathMenu } from "./paths.js";
import { placedSquares, rectanglesOverlap } from "./buildings.js";

export const selectedPlaced = new Set(); // building entries
// The building the menu and preview pane follow.
export let selectedPrimary = null;

function setSelected(entry, on) {
	entry.el.classList.toggle("is-selected", on);
	if (on) selectedPlaced.add(entry);
	else selectedPlaced.delete(entry);
}

function firstSelected() {
	return selectedPlaced.values().next().value || null;
}

// Selected entries that are still on the board, in selection order.
export function getSelectedEntries() {
	return [...selectedPlaced].filter((entry) => placedSquares.includes(entry));
}

export function clearSelection() {
	for (const entry of selectedPlaced) entry.el.classList.remove("is-selected");
	selectedPlaced.clear();
	selectedPrimary = null;
	emit("selection-changed", {});
}

// Plain click: select only this building. Shift (additive): toggle it in or
// out of the selection.
export function selectBuilding(entry, additive = false) {
	if (!additive) {
		for (const other of selectedPlaced) other.el.classList.remove("is-selected");
		selectedPlaced.clear();
		setSelected(entry, true);
		selectedPrimary = entry;
		hideActionMenu();
		emit("selection-changed", { buildingSelected: true });
		return;
	}
	let buildingSelected = false;
	if (selectedPlaced.has(entry)) {
		setSelected(entry, false);
		if (selectedPrimary === entry) selectedPrimary = firstSelected();
	} else {
		setSelected(entry, true);
		selectedPrimary = entry;
		buildingSelected = true;
	}
	if (selectedPrimary && isMenuOpen()) showMenuFor(selectedPrimary);
	else if (!selectedPrimary) hideActionMenu();
	emit("selection-changed", { buildingSelected });
}

// Makes an already-selected building the primary one.
export function setPrimary(entry) {
	selectedPrimary = entry;
}

// Live marquee: the buildings selected before the drag (preserved, for
// Shift) plus everything the rectangle overlaps. Fractional cells.
export function setMarqueeSelection(preserved, rect) {
	const next = new Set(preserved);
	for (const entry of placedSquares) {
		if (rectanglesOverlap(rect.x, rect.y, rect.w, rect.h, entry.x, entry.y, entry.w, entry.h)) next.add(entry);
	}
	for (const entry of selectedPlaced) if (!next.has(entry)) entry.el.classList.remove("is-selected");
	for (const entry of next) entry.el.classList.add("is-selected");
	selectedPlaced.clear();
	for (const entry of next) selectedPlaced.add(entry);
	selectedPrimary = firstSelected();
}

// Announces a finished marquee (skipped per-move while dragging). Unlike a
// click, it leaves an armed tray shape armed.
export function commitMarqueeSelection() {
	emit("selection-changed", {});
}

// ---------- action menu ----------

export function isMenuOpen() {
	return actionMenu.style.display === "flex";
}

// Opens the menu beside a building, kept inside the grid.
export function showMenuFor(entry) {
	if (!entry || !placedSquares.includes(entry)) return;
	hidePathMenu();
	actionMenu.style.display = "flex";
	const menuWidth = actionMenu.offsetWidth;
	const menuHeight = actionMenu.offsetHeight;
	let left = (entry.x + entry.w) * cellSize + 8;
	let top = entry.y * cellSize;
	if (left + menuWidth > gridWidth) left = entry.x * cellSize - menuWidth - 8;
	if (top + menuHeight > gridHeight) top = gridHeight - menuHeight;
	actionMenu.style.left = `${Math.max(0, left)}px`;
	actionMenu.style.top = `${Math.max(0, top)}px`;
}

// Keeps the menu beside the primary building after it moved or rotated.
export function refreshMenuPosition() {
	if (selectedPrimary && isMenuOpen()) showMenuFor(selectedPrimary);
}

export function hideActionMenu() {
	actionMenu.style.display = "none";
}

// Clicking away from the selection: hide the menu and deselect.
export function dismissSelection() {
	hideActionMenu();
	if (selectedPlaced.size) clearSelection();
}
