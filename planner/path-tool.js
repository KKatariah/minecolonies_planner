// The Roads & Rivers tool's settings and its controls in the tray: which
// type to draw, the paint width, and paint vs. erase. Each paint type (Path,
// canal) remembers its own width; the piece types (walls, Caledonia's road
// families) are sized by their pieces. The tool is
// armed while the "Roads & Rivers" tab is open (tray.js calls
// setPathToolActive).

import { cellSize } from "./config.js";
import { brushExtent } from "./cell-geometry.js";
import { cols, rows } from "./grid-view.js";
import {
	eraserHoverEl,
	pathControlsHintEl,
	pathEraseToggleButton,
	pathTypePicker,
	pathWidthField,
	pathWidthInput,
	pathWidthStepper,
} from "./layout.js";
import { DIRT_PATH_ICON } from "./paths.js";
import {
	PAINT_DEFAULT_WIDTHS,
	PATH_MAX_WIDTH,
	PATH_MIN_WIDTH,
	getAvailableRoadTypes,
	getFixedPaintWidth,
	isFreehandType,
	isPaintType,
	roadTypeColor,
	roadTypeLabel,
} from "./road-types.js";
import { getActiveRunKit } from "./run-network.js";

export let pathToolActive = false;
export let pathType = "default";
export let pathEraseMode = false;
// Each paint type's width, in blocks.
const paintWidths = { ...PAINT_DEFAULT_WIDTHS };
// The active paint type's width (with a piece type active, the last one).
export let pathWidth = paintWidths[pathType];

// The width the active type paints (and the eraser clears) at.
export function getPathWidth() {
	return pathWidth;
}

// Whether the active type places blueprint pieces rather than painting.
export function isPieceMode() {
	return !!getActiveRunKit(pathType);
}

export function setPathToolActive(on) {
	pathToolActive = on;
	// Leaving the tab turns the eraser off, so it isn't still on next visit.
	if (!on) setPathEraseMode(false);
}

export function setPathEraseMode(on) {
	pathEraseMode = on;
	pathEraseToggleButton.classList.toggle("is-active", on);
	pathEraseToggleButton.textContent = on ? "Eraser (on)" : "Eraser";
	if (!on) hideEraserHoverPreview();
}

// Pieces are placed buildings, not painted cells, so width and eraser
// don't apply to them. A width the style locks (Medieval Spruce's canal)
// hides the width control too, but keeps the eraser.
function updatePathControlsForType() {
	const pieces = isPieceMode();
	const fixed = getFixedPaintWidth(pathType);
	if (fixed !== null) pathWidth = fixed;
	else if (isPaintType(pathType)) pathWidth = paintWidths[pathType];
	showPathWidth();
	pathWidthField.hidden = pieces || fixed !== null;
	pathEraseToggleButton.hidden = pieces;
	if (pieces && pathEraseMode) setPathEraseMode(false);
	pathControlsHintEl.textContent = pieces
		? `Click and drag a straight run to place real ${roadTypeLabel(pathType).toLowerCase().replace(/s$/, "")} pieces - ends snap to nearby runs, and turns, tees and crosses get the matching piece. Hold Alt (Option on Mac) to place a run without snapping. Right-click drag to pan the map.`
		: isFreehandType(pathType)
			? `${fixed !== null ? `${fixed} blocks wide - the water between the style's canal walls. ` : ""}Click and drag to paint (or erase). Hold Shift for a straight line. Right-click drag to pan the map.`
			: "Click and drag a straight run to paint it - ends snap to nearby runs, so turns, extensions and T junctions join up. Hold Alt (Option on Mac) to paint without snapping; erasing through a junction splits the paths apart. Right-click drag to pan the map.";
}

function swatchBackground(type) {
	if (type === "default") return `url(${DIRT_PATH_ICON}) center / cover`;
	return roadTypeColor(type);
}

// A palette of swatches, one per type available in the active style.
// Piece types are styled as buildings, since they don't paint a color.
export function renderPathControls() {
	const types = getAvailableRoadTypes();
	if (!types.includes(pathType)) pathType = types[0];
	pathTypePicker.innerHTML = types
		.map((type) => {
			const pieces = !!getActiveRunKit(type);
			const classes = ["path-type-swatch"];
			if (type === pathType) classes.push("is-active");
			if (pieces) classes.push("path-type-swatch--building");
			const title = `${roadTypeLabel(type)}${pieces ? " (places real blueprint pieces, not a paint color)" : ""}`;
			return `
				<button type="button" class="${classes.join(" ")}" data-path-type-option="${type}" title="${title}">
					<span class="path-type-swatch__color" style="background:${swatchBackground(type)};"></span>
					<span class="path-type-swatch__label">${roadTypeLabel(type)}</span>
				</button>
			`;
		})
		.join("");
	setPathEraseMode(pathEraseMode);
	updatePathControlsForType();
}

// Sets the active paint type's width, clamped to the range; a non-number
// keeps the current width.
function setPathWidth(width) {
	if (Number.isFinite(width)) pathWidth = Math.max(PATH_MIN_WIDTH, Math.min(PATH_MAX_WIDTH, width));
	if (isPaintType(pathType)) paintWidths[pathType] = pathWidth;
	showPathWidth();
}

// The stepper's buttons switch off at either end of the range.
function showPathWidth() {
	pathWidthInput.value = pathWidth;
	pathWidthStepper.querySelector('[data-path-width-step="-1"]').disabled = pathWidth <= PATH_MIN_WIDTH;
	pathWidthStepper.querySelector('[data-path-width-step="1"]').disabled = pathWidth >= PATH_MAX_WIDTH;
}

// Outlines the cells an eraser click at `cell` would clear (same footprint
// as the brush, clipped to the grid).
export function updateEraserHoverPreview(cell) {
	if (!pathToolActive || !pathEraseMode || !cell) {
		hideEraserHoverPreview();
		return;
	}
	const { before, after } = brushExtent(getPathWidth());
	const minX = Math.max(0, cell.x - before);
	const maxX = Math.min(cols - 1, cell.x + after);
	const minY = Math.max(0, cell.y - before);
	const maxY = Math.min(rows - 1, cell.y + after);
	eraserHoverEl.style.display = "block";
	eraserHoverEl.style.left = `${minX * cellSize}px`;
	eraserHoverEl.style.top = `${minY * cellSize}px`;
	eraserHoverEl.style.width = `${(maxX - minX + 1) * cellSize}px`;
	eraserHoverEl.style.height = `${(maxY - minY + 1) * cellSize}px`;
}

export function hideEraserHoverPreview() {
	eraserHoverEl.style.display = "none";
}

export function initPathTool() {
	pathTypePicker.addEventListener("click", (event) => {
		const button = event.target.closest("[data-path-type-option]");
		if (!button) return;
		pathType = button.dataset.pathTypeOption;
		for (const swatch of pathTypePicker.querySelectorAll(".path-type-swatch")) {
			swatch.classList.toggle("is-active", swatch === button);
		}
		updatePathControlsForType();
	});

	pathWidthInput.min = PATH_MIN_WIDTH;
	pathWidthInput.max = PATH_MAX_WIDTH;
	showPathWidth();
	pathWidthInput.addEventListener("change", () => setPathWidth(Math.round(Number(pathWidthInput.value))));
	pathWidthStepper.addEventListener("click", (event) => {
		const button = event.target.closest("[data-path-width-step]");
		if (button) setPathWidth(pathWidth + Number(button.dataset.pathWidthStep));
	});

	pathEraseToggleButton.addEventListener("click", () => setPathEraseMode(!pathEraseMode));
}
