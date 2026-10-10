// Top-down render data (rooftop-data/*.json, made by
// scripts/generate_rooftop_renders.js). Only part of the catalog has renders,
// so every lookup can come back empty.

import { renderGrid } from "../lib/rooftop-render.js";
import { activeStyleFile } from "./catalog.js";
import { rotateFootprintPoint } from "./cell-geometry.js";
import { cellSize } from "./config.js";
import { emit } from "./events.js";

// "<styleFile>::<shapeId>" -> data file path.
export let rooftopManifest = {};

export async function loadRooftopManifest() {
	try {
		const response = await fetch("rooftop-data/manifest.json");
		rooftopManifest = response.ok ? await response.json() : {};
	} catch {
		// No manifest (e.g. the generator hasn't been run) just means no renders.
	}
	emit("rooftop-manifest-loaded");
}

// The data file for a shape, or null if it has no render. A shape without
// its own styleFile is a tray shape from the active style.
export function getRooftopDataPath(shape) {
	if (!shape) return null;
	const styleFile = shape.styleFile || activeStyleFile;
	return rooftopManifest[`${styleFile}::${shape.id}`] || null;
}

const rooftopDataCache = new Map(); // dataPath -> Promise<gridData>

// De-duplicated fetch of one render's data. A failed request isn't cached,
// so a brief network error doesn't leave that building flat until reload.
export function fetchRooftopData(dataPath) {
	if (!rooftopDataCache.has(dataPath)) {
		const request = fetch(dataPath)
			.then((response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status} for ${dataPath}`);
				return response.json();
			})
			.catch((error) => {
				rooftopDataCache.delete(dataPath);
				throw error;
			});
		rooftopDataCache.set(dataPath, request);
	}
	return rooftopDataCache.get(dataPath);
}

// Each blueprint is drawn once, unrotated, at grid scale; every placed copy
// blits (and if needed rotates) this shared image. Doors aren't drawn into
// it - at 5px a block they'd vanish when zoomed out - buildings.js marks
// them on top instead.
const renderedImageCache = new Map(); // dataPath -> Promise<HTMLCanvasElement>

export function getRenderedRooftopImage(gridData, dataPath) {
	if (!renderedImageCache.has(dataPath)) {
		const offscreen = document.createElement("canvas");
		renderedImageCache.set(
			dataPath,
			renderGrid(gridData, offscreen, { cellSize, showDoors: false, showCompass: false }).then(() => offscreen),
		);
	}
	return renderedImageCache.get(dataPath);
}

// A render's exterior doors, as the planner marks them: the middle of each
// door cell in blocks, turned `rotation` quarter turns clockwise with the
// building, and whether the doorway runs across (horizontal) or down.
export function getExteriorDoors(gridData, rotation) {
	const doors = [];
	gridData.grid.forEach((row, z) =>
		row.forEach((cell, x) => {
			if (!cell?.hasDoor || !cell.doorIsExterior) return;
			const point = rotateFootprintPoint({ x: x + 0.5, y: z + 0.5 }, gridData.size_x, gridData.size_z, rotation);
			const horizontal = (cell.doorOrientation === "horizontal") === (rotation % 2 === 0);
			doors.push({ ...point, horizontal });
		}),
	);
	return doors;
}
