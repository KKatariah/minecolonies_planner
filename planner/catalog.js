// The building catalog: every style's shapes, which style the tray is
// showing, and how shapes are grouped into tabs and sub-tabs.
//
// All styles stay loaded at once. A placed building remembers the style it
// came from and always resolves against that style, so switching the tray to
// another style never changes buildings already on the grid.

import { STYLE_FILES } from "./config.js";

const styleCache = new Map(); // file -> { id, shapes }

// The style the tray shows and new buildings are placed from.
export let activeStyleFile = STYLE_FILES[0].file;
// That style's shapes.
export let shapes = [];

async function loadStyle(file) {
	const response = await fetch(file);
	if (!response.ok) throw new Error(`Failed to load style file ${file}.`);
	const data = await response.json();
	return Array.isArray(data.shapes) ? data.shapes : [];
}

// A style that fails to load is cached as empty, so the rest still work.
async function ensureStyleLoaded(file) {
	if (styleCache.has(file)) return;
	const id = STYLE_FILES.find((entry) => entry.file === file)?.id;
	try {
		styleCache.set(file, { id, shapes: await loadStyle(file) });
	} catch (error) {
		console.error(`Failed to load style ${file}`, error);
		styleCache.set(file, { id, shapes: [] });
	}
}

export async function loadAllStyles() {
	await Promise.all(STYLE_FILES.map((entry) => ensureStyleLoaded(entry.file)));
}

export function isLoadedStyle(file) {
	return styleCache.has(file);
}

export async function setActiveStyleFile(file) {
	await ensureStyleLoaded(file);
	activeStyleFile = file;
	shapes = getStyleShapes(file);
}

export function getStyleShapes(file) {
	return styleCache.get(file)?.shapes || [];
}

// The style's folder name under images/ (e.g. "caledonia").
export function getStyleIdForFile(file) {
	const idFor = (f) => styleCache.get(f)?.id || STYLE_FILES.find((entry) => entry.file === f)?.id;
	return idFor(file) || idFor(activeStyleFile) || STYLE_FILES[0].id;
}

// Possible front-view photo URLs for a shape, best guess first:
// images/<style>/<name>_front.jpg, where <name> is tried as the shape id,
// the id's last word, then the label. Only some shapes have one.
export function getFrontImageCandidates(shape) {
	const id = String(shape.id || "").trim().toLowerCase();
	const lastToken = id.split("_").filter(Boolean).pop() || "";
	const label = (shape.label || "").trim().toLowerCase().replace(/\s+/g, "_");
	const styleId = getStyleIdForFile(shape.styleFile || activeStyleFile);
	return [...new Set([id, lastToken, label].filter(Boolean))].map((name) => `images/${styleId}/${name}_front.jpg`);
}

// ---------- tabs ----------

// Shape categories, in tray order. "roads" isn't a category any shape has:
// it's the tab for the road/river brush (see path-tool.js).
export const TABS = [
	{ id: "farming", label: "Farming" },
	{ id: "craftsmanship", label: "Craftsmanship" },
	{ id: "decoration", label: "Decoration" },
	{ id: "education", label: "Education" },
	{ id: "fundamentals", label: "Fundamentals" },
	{ id: "infrastructure", label: "Infrastructure" },
	{ id: "military", label: "Military" },
	{ id: "mystic", label: "Mystic" },
	{ id: "walls", label: "Walls" },
	{ id: "roads", label: "Roads & Rivers" },
];

export const CATEGORY_IDS = TABS.map((tab) => tab.id).filter((id) => id !== "roads");

export function getCategory(shape) {
	return shape.category || "farming";
}

// Sub-tabs per category. Most shapes don't declare a subcategory; it's
// derived from the id prefix (e.g. "alleys_long" -> "alleys").
export const SUBCATEGORIES = {
	farming: ["horticulture", "husbandry"],
	craftsmanship: ["carpentry", "luxury", "masonry", "metallurgy", "storage"],
	decoration: ["arches", "decorative", "planning", "plaza", "supplies", "utility", "misc"],
	infrastructure: ["alleys", "avenues", "birail", "fields", "monorail", "plaza", "roads", "canal"],
	walls: ["corners", "gates", "misc", "stairs", "walls", "corner", "gate", "segment", "tower"],
};

export function getSubcategory(shape) {
	if (shape.subcategory) return shape.subcategory;
	const category = shape.category || "";
	const id = shape.id || "";
	const allowed = SUBCATEGORIES[category];
	if (!allowed) return "";
	if (category === "walls" && id.startsWith("walls_")) {
		if (id.startsWith("walls_corners_")) return "corners";
		if (id.startsWith("walls_gates_")) return "gates";
		if (id.startsWith("walls_misc_")) return "misc";
		if (id.startsWith("walls_stairs_")) return "stairs";
		return "walls";
	}
	const firstToken = id.split("_")[0] || "";
	if (allowed.includes(firstToken)) return firstToken;
	if (id.startsWith("infra_plaza_")) return "plaza";
	return "";
}

// "horticulture" -> "Horticulture", "some_key" -> "Some Key".
export function formatSubcategoryLabel(key) {
	return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
