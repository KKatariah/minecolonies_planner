// The kinds of run the Roads & Rivers tool draws. Two behave like paint, at
// any width, in every style:
//   "default" (labelled Path) - Minecraft dirt path; uses the theme's
//     --path-cell-bg / --path-cell-border
//   canal - flat water blue, the same as the world background's water
// The rest place a style's real blueprint pieces (run-kits.js): walls, and
// Caledonia's road families. Those families also have a paint color, for
// painted paths of theirs in plans saved before they placed pieces.
//
// Lookups use Object.hasOwn: a path's type comes from imported plan files,
// and a type of "__proto__" would otherwise resolve to Object.prototype.

import { activeStyleFile, formatSubcategoryLabel } from "./catalog.js";
import { RUN_KITS } from "./run-kits.js";

export const ROAD_TYPE_COLORS = {
	roads: "rgba(185, 167, 137, 0.55)",
	alleys: "rgba(120, 120, 120, 0.5)",
	avenues: "rgba(201, 160, 106, 0.55)",
	birail: "rgba(90, 75, 60, 0.6)",
	monorail: "rgba(110, 140, 165, 0.55)",
	// The same blue world-terrain.js uses for rivers and lakes, so a canal
	// next to real water on a world background reads as the same water.
	canal: "#3355DD",
	// Only used for its swatch: walls are always pieces.
	walls: "rgba(150, 150, 156, 0.6)",
};

// Painted opaque with no cell borders and no block texture, so a canal
// reads as one body of water.
export const ROAD_TYPE_SOLID = new Set(["canal"]);

// The paint types, each with the width it starts at, in blocks. Canal's is
// the narrow side of Medieval Spruce's canal_straight (8x9, the 9 being the
// run); tests/unit/data-integrity.test.js checks it.
export const PAINT_DEFAULT_WIDTHS = {
	default: 5,
	canal: 8,
};

// Paint types a style locks to the width of its own blueprint pieces, so a
// painted outline can be built over with them exactly. Medieval Spruce's
// canal water is 8 wide wall to wall (piers jut 1 in from each wall every
// other block or so): canal_bridge is 4 bank + 8 water + 4 bank, and
// canal_straight is one half - 4 bank + 4 water - so two mirrored straights
// give the same 8. Read off the blueprints' voxels; the top-down renders
// hide some of the water under the bridge deck and bank slabs.
export const FIXED_PAINT_WIDTHS = {
	"styles/medievalspruce.json": { canal: 8 },
};

// The active style's locked width for `type`, or null if it's adjustable.
export function getFixedPaintWidth(type) {
	const widths = FIXED_PAINT_WIDTHS[activeStyleFile];
	return widths && Object.hasOwn(widths, type) ? widths[type] : null;
}

export function isPaintType(type) {
	return Object.hasOwn(PAINT_DEFAULT_WIDTHS, type);
}

// Painted freehand (Shift for a straight line, no snapping) rather than in
// straight runs - a canal follows the land like a river.
export function isFreehandType(type) {
	return type === "canal";
}

// The paint width range.
export const PATH_MIN_WIDTH = 1;
export const PATH_MAX_WIDTH = 16;

export function isKnownRoadType(type) {
	return type === "default" || Object.hasOwn(ROAD_TYPE_COLORS, type);
}

// The paint color, or null for the theme default.
export function roadTypeColor(type) {
	return Object.hasOwn(ROAD_TYPE_COLORS, type) ? ROAD_TYPE_COLORS[type] : null;
}

export function roadTypeLabel(type) {
	return type === "default" ? "Path" : formatSubcategoryLabel(type);
}

// The types to offer for the active style: Path first, then the road
// families the style has pieces for and canal, and walls last, set apart
// because it's a different kind of thing.
export function getAvailableRoadTypes() {
	const kits = RUN_KITS[activeStyleFile] || {};
	const families = Object.keys(kits).filter((type) => type !== "walls");
	const types = ["default", ...[...families, "canal"].sort()];
	if (kits.walls) types.push("walls");
	return types;
}
