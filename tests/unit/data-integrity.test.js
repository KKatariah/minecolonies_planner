// Static data checks: the style catalogs, rooftop renders, material icons
// and every asset the HTML/CSS reference. The site has no build step, so a
// typo in one of these JSON files or a missing image would otherwise only
// show up as a silently broken thumbnail/tray item in the browser.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { loadBrowserScripts, REPO_ROOT } = require("../helpers/load-browser-script.js");

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const exists = (rel) => fs.existsSync(path.join(REPO_ROOT, rel));

// Mirrors STYLE_FILES and the `tabs` list in app.js. If one of those changes,
// update here too - the e2e suite also cross-checks STYLE_FILES at runtime.
const STYLE_FILES = ["styles/caledonia.json", "styles/medievalspruce.json"];
const SHAPE_CATEGORIES = new Set([
	"farming", "craftsmanship", "decoration", "education", "fundamentals",
	"infrastructure", "military", "mystic", "walls",
]);
// Default grid is 512x512 blocks; nothing bigger can ever be placed.
const MAX_FOOTPRINT = 512;

// Known data problems, allow-listed so the suite stays green while they're
// open. The "known issues are still real" test below fails once one is fixed,
// as a reminder to delete its entry here.
const KNOWN_LEVEL_ISSUES = new Set([]);

// Rooftop renders whose blueprint size differs from the shape's w/h in the
// style file. applyBuildingVisualMode() in app.js refuses to draw a render
// that doesn't fit the footprint, so such a building never shows its
// top-down render on the planner grid (it falls back to the flat block).
// The blueprint is the source of truth - fix the style JSON's w/h (or the
// generator's blueprint match) rather than adding entries here.
const KNOWN_FOOTPRINT_MISMATCHES = new Set([]);

const styles = STYLE_FILES.map((file) => ({ file, data: readJson(file) }));

function levelProblem(shape) {
	if (shape.levels === undefined) return null; // optional - cost card just hides
	if (!Array.isArray(shape.levels) || shape.levels.length === 0) return "levels must be a non-empty array";
	for (let i = 0; i < shape.levels.length; i++) {
		if (shape.levels[i].level !== i + 1) {
			return `levels[${i}].level is ${shape.levels[i].level}, expected ${i + 1}`;
		}
	}
	return null;
}

test("every style file is valid JSON with a name and a non-empty shapes list", () => {
	for (const { file, data } of styles) {
		assert.equal(typeof data.name, "string", `${file}: name`);
		assert.ok(Array.isArray(data.shapes) && data.shapes.length > 0, `${file}: shapes`);
	}
});

test("every shape has a unique id, a label, a sane footprint and a known category", () => {
	for (const { file, data } of styles) {
		const ids = new Set();
		for (const shape of data.shapes) {
			const where = `${file}::${shape.id}`;
			assert.match(String(shape.id), /^[a-z0-9_]+$/, `${where}: id format`);
			assert.ok(!ids.has(shape.id), `${where}: duplicate id`);
			ids.add(shape.id);
			assert.ok(typeof shape.label === "string" && shape.label.trim(), `${where}: label`);
			for (const dim of ["w", "h"]) {
				assert.ok(
					Number.isInteger(shape[dim]) && shape[dim] >= 1 && shape[dim] <= MAX_FOOTPRINT,
					`${where}: ${dim}=${shape[dim]}`,
				);
			}
			assert.ok(SHAPE_CATEGORIES.has(shape.category), `${where}: unknown category ${shape.category}`);
			assert.equal(typeof shape.emoji, "string", `${where}: emoji`);
		}
	}
});

test("shape level data is sequential and material counts are positive integers", () => {
	for (const { file, data } of styles) {
		for (const shape of data.shapes) {
			const key = `${file}::${shape.id}`;
			if (!KNOWN_LEVEL_ISSUES.has(key)) {
				assert.equal(levelProblem(shape), null, key);
			}
			for (const level of shape.levels || []) {
				for (const field of ["materials", "upgradeCost"]) {
					if (level[field] === undefined) continue;
					for (const [material, count] of Object.entries(level[field])) {
						assert.ok(
							Number.isInteger(count) && count > 0,
							`${key} level ${level.level} ${field}.${material} = ${count}`,
						);
					}
				}
			}
		}
	}
});

test("allow-listed known issues are still real (remove the entry once fixed)", () => {
	for (const key of KNOWN_LEVEL_ISSUES) {
		const [file, id] = key.split("::");
		const shape = readJson(file).shapes.find((s) => s.id === id);
		assert.ok(shape, `${key} no longer exists - remove it from KNOWN_LEVEL_ISSUES`);
		assert.notEqual(levelProblem(shape), null, `${key} looks fixed - remove it from KNOWN_LEVEL_ISSUES`);
	}
});

test("every shape emoji has a matching hand-drawn icon", () => {
	const window = loadBrowserScripts(["icons.js"]);
	const missing = new Set();
	for (const { data } of styles) {
		for (const shape of data.shapes) {
			if (!window.MCIcons.ICONS[shape.emoji]) missing.add(shape.emoji);
		}
	}
	assert.deepEqual([...missing], [], "these emoji fall back to the generic default icon");
});

test("icons.js renders well-formed SVG and falls back for unknown keys", () => {
	const { MCIcons } = loadBrowserScripts(["icons.js"]);
	const svg = MCIcons.getIconSvg("🌾", { size: 24, className: "x" });
	assert.match(svg, /^<svg viewBox="0 0 24 24" width="24" height="24" class="mc-icon x"/);
	assert.match(svg, /<\/svg>$/);
	assert.equal(MCIcons.getIconMarkup("not-a-real-icon"), MCIcons.DEFAULT_ICON);
	for (const [key, markup] of Object.entries(MCIcons.ICONS)) {
		assert.ok(!/<script|on\w+=/i.test(markup), `icon ${key} contains script/handlers`);
	}
});

test("rooftop manifest entries point at real shapes and real render files", () => {
	const manifest = readJson("rooftop-data/manifest.json");
	const shapeIdsByFile = new Map(styles.map(({ file, data }) => [file, new Set(data.shapes.map((s) => s.id))]));
	assert.ok(Object.keys(manifest).length > 0);
	for (const [key, dataPath] of Object.entries(manifest)) {
		const [styleFile, shapeId] = key.split("::");
		assert.ok(shapeIdsByFile.has(styleFile), `${key}: unknown style file`);
		assert.ok(shapeIdsByFile.get(styleFile).has(shapeId), `${key}: no such shape in ${styleFile}`);
		assert.match(dataPath, /^rooftop-data\/[a-z0-9_]+\.json$/, `${key}: path format`);
		assert.ok(exists(dataPath), `${key}: ${dataPath} missing`);
	}
});

test("every rooftop render file is referenced by the manifest (no orphans)", () => {
	const referenced = new Set(Object.values(readJson("rooftop-data/manifest.json")));
	const orphans = fs
		.readdirSync(path.join(REPO_ROOT, "rooftop-data"))
		.filter((f) => f !== "manifest.json" && !referenced.has(`rooftop-data/${f}`));
	assert.deepEqual(orphans, []);
});

test("rooftop render grids match their declared size and reference real textures", () => {
	const manifest = readJson("rooftop-data/manifest.json");
	const missingTextures = new Set();
	for (const dataPath of new Set(Object.values(manifest))) {
		const render = readJson(dataPath);
		const sizeX = Number(render.size_x);
		const sizeZ = Number(render.size_z);
		assert.ok(sizeX > 0 && sizeZ > 0, `${dataPath}: size`);
		assert.equal(render.grid.length, sizeZ, `${dataPath}: row count`);
		for (const row of render.grid) {
			assert.equal(row.length, sizeX, `${dataPath}: row width`);
			for (const cell of row) {
				if (!cell) continue;
				for (const field of ["icon", "underlayIcon"]) {
					if (cell[field] && !exists(cell[field])) missingTextures.add(`${dataPath}: ${cell[field]}`);
				}
			}
		}
	}
	assert.deepEqual([...missingTextures], []);
});

function footprintMismatches() {
	const manifest = readJson("rooftop-data/manifest.json");
	const mismatches = new Map();
	for (const [key, dataPath] of Object.entries(manifest)) {
		const [styleFile, shapeId] = key.split("::");
		const shape = styles.find((s) => s.file === styleFile).data.shapes.find((s) => s.id === shapeId);
		const render = readJson(dataPath);
		const dims = [Number(render.size_x), Number(render.size_z)].sort((a, b) => a - b);
		const footprint = [shape.w, shape.h].sort((a, b) => a - b);
		if (dims[0] !== footprint[0] || dims[1] !== footprint[1]) {
			mismatches.set(key, `render ${dims.join("x")} vs shape ${footprint.join("x")}`);
		}
	}
	return mismatches;
}

test("rooftop renders match their shape's footprint (either orientation)", () => {
	const unexpected = [...footprintMismatches()]
		.filter(([key]) => !KNOWN_FOOTPRINT_MISMATCHES.has(key))
		.map(([key, detail]) => `${key}: ${detail}`);
	assert.deepEqual(unexpected, []);
});

test("allow-listed footprint mismatches are still real (remove the entry once fixed)", () => {
	const current = footprintMismatches();
	const fixed = [...KNOWN_FOOTPRINT_MISMATCHES].filter((key) => !current.has(key));
	assert.deepEqual(fixed, [], "these now match - remove them from KNOWN_FOOTPRINT_MISMATCHES");
});

test("material-icons.json maps ids to existing image files", () => {
	const icons = readJson("images/material-icons.json");
	assert.ok(Object.keys(icons).length > 100);
	const missing = Object.entries(icons).filter(([, file]) => !exists(file));
	assert.deepEqual(missing, []);
});

test("every style has preview images and they're all named <name>_front.jpg", () => {
	for (const { file } of styles) {
		const styleId = path.basename(file, ".json");
		const dir = path.join(REPO_ROOT, "images", styleId);
		assert.ok(fs.existsSync(dir), `images/${styleId}/ missing`);
		const files = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
		assert.ok(files.length > 0);
		for (const f of files) assert.match(f, /^[a-z0-9_]+_front\.jpg$/, `images/${styleId}/${f}`);
	}
});

test("every HTML page's scripts and stylesheets exist", () => {
	const pages = fs.readdirSync(REPO_ROOT).filter((f) => f.endsWith(".html"));
	assert.ok(pages.length >= 4);
	for (const page of pages) {
		const html = fs.readFileSync(path.join(REPO_ROOT, page), "utf8");
		const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
		assert.ok(refs.length > 0, `${page} references nothing`);
		for (const ref of refs) {
			if (/^(https?:)?\/\//.test(ref) || ref.startsWith("#")) continue;
			assert.ok(exists(ref), `${page} -> ${ref} missing`);
		}
		// nav.js depends on icons.js; every page bootstraps through both.
		assert.ok(html.indexOf("icons.js") < html.indexOf("nav.js"), `${page}: icons.js must load before nav.js`);
	}
});

test("every url() in styles.css points at a real file", () => {
	const css = fs.readFileSync(path.join(REPO_ROOT, "styles.css"), "utf8");
	const urls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]).filter((u) => !u.startsWith("data:"));
	assert.ok(urls.length > 0);
	for (const url of urls) assert.ok(exists(url), `styles.css -> ${url} missing`);
});

test("nav links point at pages that exist", () => {
	const nav = fs.readFileSync(path.join(REPO_ROOT, "nav.js"), "utf8");
	const links = [...nav.matchAll(/href="([^"]+\.html)"/g)].map((m) => m[1]);
	assert.ok(links.length >= 4);
	for (const link of links) assert.ok(exists(link), `nav -> ${link} missing`);
});

test("sample data used by the 'Try an example' buttons is present", () => {
	assert.ok(exists("sample-data/example-colony.dat"));
	assert.ok(exists("sample-data/r.0.0.mca"));
});
