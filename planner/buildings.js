// Buildings placed on the grid. This module owns `placedSquares` - other
// modules read it, but every addition, move, rotation and removal goes
// through the functions here, which keep the entries and their DOM in step.
//
// An entry: { el, x, y, w, h, id, label, category, emoji, styleFile, huts,
// rotation, rotated, rooftopCanvas, doorLayer }. x/y/w/h are in blocks; w/h
// are the footprint as placed (already swapped if rotated). rotation is quarter
// turns clockwise from the blueprint (0-3); rotated is just "rotation is
// odd", which is all the footprint depends on.

import { getStyleShapes, activeStyleFile } from "./catalog.js";
import { cellSize } from "./config.js";
import { settings } from "./display-settings.js";
import { emit, on } from "./events.js";
import { grid } from "./layout.js";
import { fetchRooftopData, getExteriorDoors, getRenderedRooftopImage, getRooftopDataPath } from "./rooftop.js";

export const placedSquares = [];
const entriesByElement = new WeakMap();

export function getBuildingForElement(el) {
	return entriesByElement.get(el) || null;
}

// Fills in whatever a saved or copied building leaves out from its style's
// catalog entry. A building with its own styleFile keeps resolving against
// that style, whatever the tray currently shows.
export function resolveShapeData(shape) {
	const styleFile = shape.styleFile || activeStyleFile;
	const base = shape.id ? getStyleShapes(styleFile).find((item) => item.id === shape.id) : null;
	return {
		id: shape.id || base?.id,
		label: shape.label || base?.label || "Unknown",
		w: shape.w ?? base?.w ?? 1,
		h: shape.h ?? base?.h ?? 1,
		category: shape.category || base?.category || "farming",
		emoji: shape.emoji || base?.emoji,
		styleFile,
		huts: base?.huts,
	};
}

// Font size for a flat building's name, scaled to fit its footprint.
export function getBadgeFontSize(w, h) {
	const scaled = Math.round(Math.min(w, h) * cellSize * 0.18);
	return Math.max(8, Math.min(18, scaled));
}

function positionElement(entry) {
	entry.el.style.left = `${entry.x * cellSize}px`;
	entry.el.style.top = `${entry.y * cellSize}px`;
	entry.el.style.width = `${entry.w * cellSize}px`;
	entry.el.style.height = `${entry.h * cellSize}px`;
}

// Adds a building with its top-left at (x, y) and returns its entry. Doesn't
// check for overlap - callers decide whether a spot is allowed.
// shape.rotation: quarter turns clockwise from the blueprint's own
// orientation (w/h must already be swapped when odd); a bare
// shape.rotated means one turn. It's needed because a square footprint
// looks the same either way.
export function placeBuilding(x, y, shape) {
	const resolved = resolveShapeData(shape);
	const el = document.createElement("div");
	el.className = `placed-square category-${resolved.category}`;
	const badge = document.createElement("div");
	badge.className = "placed-badge";
	badge.textContent = resolved.label;
	badge.style.fontSize = `${getBadgeFontSize(resolved.w, resolved.h)}px`;
	const rooftopCanvas = document.createElement("canvas");
	rooftopCanvas.className = "placed-square__rooftop-canvas";
	rooftopCanvas.hidden = true;
	const doorLayer = document.createElement("div");
	doorLayer.className = "placed-square__doors";
	el.append(badge, rooftopCanvas, doorLayer);
	grid.appendChild(el);

	const entry = { ...resolved, el, x, y, rooftopCanvas, doorLayer };
	setRotation(entry, normalizeRotation(shape));
	positionElement(entry);
	placedSquares.push(entry);
	entriesByElement.set(el, entry);
	applyBuildingVisualMode(entry);
	emit("plan-changed");
	return entry;
}

export function moveBuilding(entry, x, y) {
	entry.x = x;
	entry.y = y;
	positionElement(entry);
}

// A shape's rotation as 0-3, from `rotation` or the older `rotated` flag.
export function normalizeRotation(shape) {
	return Number.isInteger(shape.rotation) ? (((shape.rotation % 4) + 4) % 4) : shape.rotated ? 1 : 0;
}

function setRotation(entry, rotation) {
	entry.rotation = rotation;
	entry.rotated = rotation % 2 === 1;
}

// Turns a building a quarter turn clockwise, with its new top-left at (x, y).
export function rotateBuilding(entry, x, y) {
	[entry.w, entry.h] = [entry.h, entry.w];
	setRotation(entry, (entry.rotation + 1) % 4);
	moveBuilding(entry, x, y);
	applyBuildingVisualMode(entry);
}

export function removeBuildings(entries) {
	const doomed = new Set(entries);
	if (!doomed.size) return;
	for (let i = placedSquares.length - 1; i >= 0; i--) {
		if (doomed.has(placedSquares[i])) placedSquares.splice(i, 1);
	}
	for (const entry of doomed) entry.el.remove();
	emit("plan-changed");
}

export function clearBuildings() {
	removeBuildings([...placedSquares]);
}

export function rectanglesOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
	return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Whether a w x h footprint at (x, y) is free. `ignore`: an entry, or a Set
// of entries, to leave out (e.g. the buildings being moved).
export function canPlaceAt(x, y, w, h, ignore = null) {
	return !placedSquares.some((placed) => {
		if (ignore instanceof Set ? ignore.has(placed) : placed === ignore) return false;
		return rectanglesOverlap(x, y, w, h, placed.x, placed.y, placed.w, placed.h);
	});
}

// ---------- top-down renders ----------

// .has-topdown switches CSS to the render look (small name tag instead of a
// full-size label). The flat label's font size is inline and must be
// cleared, or it would override the tag's size from CSS.
function setBuildingTopDownMode(entry, on) {
	entry.el.classList.toggle("has-topdown", on);
	const badge = entry.el.querySelector(".placed-badge");
	if (badge) badge.style.fontSize = on ? "" : `${getBadgeFontSize(entry.w, entry.h)}px`;
}

// Exterior door markers over the render: DOM, not pixels in the render, so
// CSS can keep them a readable size on screen at any zoom.
function showDoorMarkers(entry, doors) {
	entry.doorLayer.replaceChildren(
		...doors.map((door) => {
			const marker = document.createElement("div");
			marker.className = `door-marker door-marker--${door.horizontal ? "horizontal" : "vertical"}`;
			marker.style.left = `${door.x * cellSize}px`;
			marker.style.top = `${door.y * cellSize}px`;
			return marker;
		}),
	);
}

function showFlat(entry) {
	entry.rooftopCanvas.hidden = true;
	showDoorMarkers(entry, []);
	setBuildingTopDownMode(entry, false);
}

// Shows the building's top-down render if renders are on and it has one,
// otherwise its flat category color.
export async function applyBuildingVisualMode(entry) {
	const dataPath = settings.topDownRenders.get() ? getRooftopDataPath(entry) : null;
	if (!dataPath) {
		showFlat(entry);
		return;
	}
	// Renders are async; the building may have been removed, or renders
	// turned off, by the time each step finishes.
	const stillWanted = () => settings.topDownRenders.get() && placedSquares.includes(entry);
	try {
		const gridData = await fetchRooftopData(dataPath);
		if (!stillWanted()) return;
		// Repair: a non-square footprint matching the other orientation can
		// only be the blueprint turned a quarter with the flag missing (plans
		// saved before walls recorded it).
		if (
			gridData.size_x !== gridData.size_z &&
			entry.w === (entry.rotated ? gridData.size_x : gridData.size_z) &&
			entry.h === (entry.rotated ? gridData.size_z : gridData.size_x)
		) {
			setRotation(entry, (entry.rotation + 1) % 4);
			emit("plan-changed");
		}
		// A footprint that doesn't match the blueprint (corrupt or hand-edited
		// data) stays flat rather than drawing a distorted render.
		const expectedW = entry.rotated ? gridData.size_z : gridData.size_x;
		const expectedH = entry.rotated ? gridData.size_x : gridData.size_z;
		if (entry.w !== expectedW || entry.h !== expectedH) {
			showFlat(entry);
			return;
		}
		const sourceCanvas = await getRenderedRooftopImage(gridData, dataPath);
		if (!stillWanted()) return;
		drawRenderTurned(entry.rooftopCanvas, sourceCanvas, entry.w, entry.h, entry.rotation);
		entry.rooftopCanvas.hidden = false;
		showDoorMarkers(entry, settings.doorLabels.get() ? getExteriorDoors(gridData, entry.rotation) : []);
		setBuildingTopDownMode(entry, true);
	} catch {
		// Keep the flat look if the data can't be fetched.
	}
}

// Draws a building's top-down render (made unrotated) into `canvas`, sized
// to a w x h footprint and turned `rotation` quarter turns clockwise. The
// render turned about its center exactly fills the turned footprint.
export function drawRenderTurned(canvas, sourceCanvas, w, h, rotation) {
	canvas.width = w * cellSize;
	canvas.height = h * cellSize;
	const ctx = canvas.getContext("2d");
	ctx.imageSmoothingEnabled = false;
	if (rotation) {
		ctx.save();
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate((rotation * Math.PI) / 2);
		ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
		ctx.restore();
	} else {
		ctx.drawImage(sourceCanvas, 0, 0);
	}
}

function applyVisualModeToAll() {
	for (const entry of placedSquares) applyBuildingVisualMode(entry);
}

export function initBuildings() {
	on("display-changed", (setting) => {
		if (setting === "topDownRenders" || setting === "doorLabels") applyVisualModeToAll();
	});
	// Buildings restored before the manifest arrived had nothing to show.
	on("rooftop-manifest-loaded", applyVisualModeToAll);
}
