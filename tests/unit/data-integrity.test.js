// Static data checks: the style catalogs, rooftop renders, material icons
// and every asset the HTML/CSS reference. The site has no build step, so a
// typo in one of these JSON files or a missing image would otherwise only
// show up as a silently broken thumbnail/tray item in the browser.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { REPO_ROOT } = require("../helpers/repo-root.js");
const MCIcons = require("../../lib/icons.js");

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const exists = (rel) => fs.existsSync(path.join(REPO_ROOT, rel));

// The planner's own lists, imported rather than copied, so they can't drift.
const STYLE_FILES = require("../../planner/config.js").STYLE_FILES.map((style) => style.file);
const SHAPE_CATEGORIES = new Set(require("../../planner/catalog.js").CATEGORY_IDS);
// The default grid is 512x512 blocks; a building must fit in it.
const MAX_FOOTPRINT = require("../../planner/config.js").DEFAULT_GRID_SIZE;

// Known data problems, allow-listed so the suite stays green while they're
// open. The "known issues are still real" test below fails once one is fixed,
// as a reminder to delete its entry here.
const KNOWN_LEVEL_ISSUES = new Set([]);

// Rooftop renders whose blueprint size differs from the shape's w/h in the
// style file. applyBuildingVisualMode() (planner/buildings.js) refuses to draw a render
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
	const missing = new Set();
	for (const { data } of styles) {
		for (const shape of data.shapes) {
			if (!MCIcons.ICONS[shape.emoji]) missing.add(shape.emoji);
		}
	}
	assert.deepEqual([...missing], [], "these emoji fall back to the generic default icon");
});

test("lib/icons.js renders well-formed SVG and falls back for unknown keys", () => {
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

test("hut positions sit inside their blueprint and land inside the footprint at every rotation", () => {
	const { getHutPoints } = require("../../planner/plan-check-rules.js");
	const problems = [];
	for (const { file, data } of styles) {
		for (const shape of data.shapes) {
			if (shape.huts === undefined) continue;
			const { size_x: sx, size_z: sz, blocks } = shape.huts;
			const fits = (sx === shape.w && sz === shape.h) || (sx === shape.h && sz === shape.w);
			if (!fits || !blocks?.length) problems.push(`${file}::${shape.id}: huts size ${sx}x${sz} vs ${shape.w}x${shape.h}`);
			for (const hut of blocks || []) {
				if (hut.x < 0 || hut.x >= sx || hut.z < 0 || hut.z >= sz) problems.push(`${file}::${shape.id}: hut outside blueprint`);
			}
			for (let rotation = 0; rotation < 4; rotation++) {
				const [w, h] = rotation % 2 ? [shape.h, shape.w] : [shape.w, shape.h];
				for (const point of getHutPoints({ huts: shape.huts, x: 0, y: 0, w, h, rotation })) {
					if (point.x < 0 || point.x > w || point.y < 0 || point.y > h) {
						problems.push(`${file}::${shape.id}: rotation ${rotation} puts a hut outside the footprint`);
					}
				}
			}
		}
	}
	assert.deepEqual(problems, []);
});

test("every Plan Check fix names a building every style has", () => {
	const source = fs.readFileSync(path.join(REPO_ROOT, "planner/plan-check-rules.js"), "utf8");
	const fixes = [...new Set([...source.matchAll(/fix: "([^"]+)"/g)].map((m) => m[1]))];
	assert.ok(fixes.length >= 6, `found ${fixes}`);
	for (const { file, data } of styles) {
		const labels = new Set(data.shapes.map((shape) => shape.label));
		for (const fix of fixes) assert.ok(labels.has(fix), `${file} has no "${fix}"`);
	}
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
		const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
		assert.equal(scripts.length, 1, `${page}: expected a single entry script`);
		assert.match(scripts[0], /type="module"/, `${page}: the entry script must be an ES module`);
	}
});

// Every relative import (and worker URL) reachable from each page's entry
// module points at a real file - a typo here otherwise only shows up as a
// failed page load in the browser.
test("every page's module import graph resolves", () => {
	const pages = fs.readdirSync(REPO_ROOT).filter((f) => f.endsWith(".html"));
	const importPattern = /(?:\bimport\s[^;]*?from\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
	for (const page of pages) {
		const html = fs.readFileSync(path.join(REPO_ROOT, page), "utf8");
		const entry = /<script[^>]*src="([^"]+)"/.exec(html)[1];
		const seen = new Set();
		const queue = [path.join(REPO_ROOT, entry)];
		while (queue.length) {
			const file = queue.pop();
			if (seen.has(file)) continue;
			seen.add(file);
			assert.ok(fs.existsSync(file), `${page}: ${path.relative(REPO_ROOT, file)} is imported but missing`);
			const code = fs.readFileSync(file, "utf8");
			for (const m of code.matchAll(importPattern)) queue.push(path.join(path.dirname(file), m[1]));
		}
		assert.ok(seen.size > 1, `${page}: entry module imports nothing`);
	}
});

test("every url() in styles.css points at a real file", () => {
	const css = fs.readFileSync(path.join(REPO_ROOT, "styles.css"), "utf8");
	const urls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]).filter((u) => !u.startsWith("data:"));
	assert.ok(urls.length > 0);
	for (const url of urls) assert.ok(exists(url), `styles.css -> ${url} missing`);
});

test("nav links point at pages that exist", () => {
	const nav = fs.readFileSync(path.join(REPO_ROOT, "lib/nav.js"), "utf8");
	const links = [...nav.matchAll(/href="([^"]+\.html)"/g)].map((m) => m[1]);
	assert.ok(links.length >= 4);
	for (const link of links) assert.ok(exists(link), `nav -> ${link} missing`);
});

test("sample data used by the 'Try an example' buttons is present", () => {
	assert.ok(exists("sample-data/example-colony.dat"));
	assert.ok(exists("sample-data/r.0.0.mca"));
});

// canal_straight is half a canal (bank, then water to the middle) and
// canal_bridge spans the whole thing, so the bridge is two straights long.
test("Medieval Spruce's locked canal width matches its canal pieces", () => {
	const { FIXED_PAINT_WIDTHS } = require("../../planner/road-types.js");
	const ms = styles.find(({ file }) => file.endsWith("medievalspruce.json")).data.shapes;
	const straight = ms.find((s) => s.id === "canal_straight");
	const bridge = ms.find((s) => s.id === "canal_bridge");
	assert.equal(Math.max(bridge.w, bridge.h), 2 * Math.min(straight.w, straight.h));
	assert.equal(FIXED_PAINT_WIDTHS["styles/medievalspruce.json"].canal, Math.min(straight.w, straight.h));
});

test("canal's starting width matches the narrow side of a style's straight canal piece", () => {
	const { PAINT_DEFAULT_WIDTHS } = require("../../planner/road-types.js");
	const pieces = styles.flatMap(({ data }) => data.shapes.filter((s) => s.id === "canal_straight"));
	assert.ok(pieces.length, "no canal_straight shape in any style");
	for (const piece of pieces) {
		assert.equal(Math.min(piece.w, piece.h), PAINT_DEFAULT_WIDTHS.canal, `${piece.id} is ${piece.w}x${piece.h}`);
	}
});
