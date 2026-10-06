// world-terrain.js - region (.mca) parsing and biome coloring shared by the
// World Viewer, the planner's world background, and the Debug page.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const { loadBrowserScripts, REPO_ROOT } = require("../helpers/load-browser-script.js");
const W = require("../helpers/nbt-writer.js");
const { makeChunkNbt, buildRegion } = require("../helpers/region-builder.js");

const window = loadBrowserScripts(["nbt.js", "world-terrain.js"]);
const WT = window.WorldTerrain;

const namedFile = (name, bytes = new Uint8Array(0), extra = {}) =>
	Object.assign(new File([bytes], name), extra);

test("exposes the expected public API", () => {
	for (const fn of [
		"colorForBiome", "hashColor", "formatBiomeName", "escapeHtml", "parseRegionFilename",
		"parseRegionFile", "filterMcaFiles", "readAllDirectoryEntries", "collectFilesFromEntry",
		"checkFileSpan", "buildTerrainImage",
	]) {
		assert.equal(typeof WT[fn], "function", `${fn} should be exported`);
	}
	assert.equal(typeof WT.BIOME_COLORS, "object");
});

test("BIOME_COLORS holds valid hex colors for namespaced ids", () => {
	const entries = Object.entries(WT.BIOME_COLORS);
	assert.ok(entries.length > 50, "should cover the vanilla biome list");
	for (const [id, color] of entries) {
		assert.match(id, /^[a-z0-9_]+:[a-z0-9_/]+$/, `bad biome id ${id}`);
		assert.match(color, /^#[0-9a-fA-F]{6}$/, `bad color for ${id}: ${color}`);
	}
});

test("colorForBiome: exact match, keyword fallback, then stable hash", () => {
	assert.equal(WT.colorForBiome("minecraft:plains"), WT.BIOME_COLORS["minecraft:plains"]);
	// Modded biomes fall back to keyword colors...
	assert.equal(WT.colorForBiome("terralith:volcanic_peaks"), "#7A2E1D");
	assert.equal(WT.colorForBiome("byg:redwood_forest"), "#056621");
	// ...with more specific keywords winning (snow before forest).
	assert.equal(WT.colorForBiome("modded:snowy_forest"), "#DEDEDE");
	// No keyword at all -> deterministic hsl hash.
	const hashed = WT.colorForBiome("modded:zzqx");
	assert.match(hashed, /^hsl\(\d+, 45%, 45%\)$/);
	assert.equal(hashed, WT.colorForBiome("modded:zzqx"));
	assert.equal(WT.hashColor("abc"), WT.hashColor("abc"));
	assert.notEqual(WT.hashColor("abc"), WT.hashColor("abd"));
});

test("formatBiomeName strips the namespace and title-cases words", () => {
	assert.equal(WT.formatBiomeName("minecraft:dark_forest"), "Dark Forest");
	assert.equal(WT.formatBiomeName("plains"), "Plains");
	assert.equal(WT.formatBiomeName("mod:a__b"), "A B");
});

test("escapeHtml neutralizes every HTML-significant character", () => {
	const nasty = `minecraft:plains"><img src=x onerror='alert(1)'>&`;
	const escaped = WT.escapeHtml(nasty);
	assert.equal(
		escaped,
		"minecraft:plains&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;",
	);
	assert.doesNotMatch(escaped, /[<>"']/);
});

test("parseRegionFilename reads coordinates, including negatives", () => {
	assert.deepEqual({ ...WT.parseRegionFilename("r.0.0.mca") }, { rx: 0, rz: 0 });
	assert.deepEqual({ ...WT.parseRegionFilename("r.-3.12.mca") }, { rx: -3, rz: 12 });
	assert.deepEqual({ ...WT.parseRegionFilename("region/r.5.-1.mca") }, { rx: 5, rz: -1 });
	assert.equal(WT.parseRegionFilename("r.0.mca"), null);
	assert.equal(WT.parseRegionFilename("level.dat"), null);
	assert.equal(WT.parseRegionFilename("r.a.b.mca"), null);
});

test("filterMcaFiles keeps only .mca files and prefers region/ over poi/ and entities/", () => {
	const loose = [namedFile("r.0.0.mca"), namedFile("level.dat"), namedFile("R.1.0.MCA")];
	assert.deepEqual(WT.filterMcaFiles(loose).map((f) => f.name), ["r.0.0.mca", "R.1.0.MCA"]);

	const fromFolder = [
		namedFile("r.0.0.mca", undefined, { __mcaRelativePath: "/world/region/r.0.0.mca" }),
		namedFile("r.0.0.mca", undefined, { __mcaRelativePath: "/world/poi/r.0.0.mca" }),
		namedFile("r.0.0.mca", undefined, { __mcaRelativePath: "/world/entities/r.0.0.mca" }),
		namedFile("level.dat", undefined, { __mcaRelativePath: "/world/level.dat" }),
	];
	const picked = WT.filterMcaFiles(fromFolder);
	assert.equal(picked.length, 1);
	assert.equal(picked[0].__mcaRelativePath, "/world/region/r.0.0.mca");

	// No region/ folder at all -> fall back to every .mca rather than nothing.
	const noRegion = [namedFile("r.0.0.mca", undefined, { __mcaRelativePath: "/x/poi/r.0.0.mca" })];
	assert.equal(WT.filterMcaFiles(noRegion).length, 1);
});

test("checkFileSpan accepts adjacent regions and rejects far-apart ones", () => {
	assert.equal(WT.checkFileSpan([]).ok, true);
	assert.equal(WT.checkFileSpan([namedFile("r.0.0.mca")]).ok, true);
	assert.equal(
		WT.checkFileSpan([namedFile("r.0.0.mca"), namedFile("r.1.0.mca"), namedFile("r.0.-1.mca")]).ok,
		true,
	);
	const far = WT.checkFileSpan([namedFile("r.0.0.mca"), namedFile("r.100.0.mca")]);
	assert.equal(far.ok, false);
	assert.match(far.message, /too far apart/);
	// Unparseable names are ignored here (handled later by the per-file errors).
	assert.equal(WT.checkFileSpan([namedFile("r.0.0.mca"), namedFile("junk.mca")]).ok, true);
});

test("parseRegionFile rejects non-region filenames", async () => {
	await assert.rejects(WT.parseRegionFile(namedFile("foo.mca"), () => {}), /doesn't look like a region file/);
});

test("parseRegionFile treats a 0-byte stub as empty, but a short file as an error", async () => {
	let calls = 0;
	await WT.parseRegionFile(namedFile("r.0.0.mca"), () => calls++);
	assert.equal(calls, 0);
	await assert.rejects(
		WT.parseRegionFile(namedFile("r.0.0.mca", new Uint8Array(100)), () => {}),
		/too small to be a region file/,
	);
});

test("parseRegionFile skips ungenerated, partial, and corrupt chunks without throwing", async () => {
	const partial = W.encodeNbt(W.compound({ Status: W.str("minecraft:features") }));
	const region = buildRegion([
		{ cx: 0, cz: 0, nbt: partial },
		{ cx: 1, cz: 0, nbt: new Uint8Array([1, 2, 3, 4]).buffer, compression: 3 }, // not NBT
		{ cx: 2, cz: 0, nbt: partial, compression: 1 },
	]);
	// Also point one header entry past the end of the file.
	region[3 * 4] = 0x7f;
	region[3 * 4 + 3] = 1;
	let calls = 0;
	await WT.parseRegionFile(namedFile("r.0.0.mca", region), () => calls++);
	assert.equal(calls, 0);
});

test("parseRegionFile extracts heights, biomes and water from a synthetic chunk", async () => {
	const region = buildRegion([
		{ cx: 3, cz: 5, nbt: makeChunkNbt({ biome: "minecraft:desert", surfaceY: 70, block: "minecraft:sand" }) },
		{ cx: 4, cz: 5, nbt: makeChunkNbt({ biome: "minecraft:ocean", surfaceY: 63, block: "minecraft:water" }), compression: 1 },
	]);
	const seen = new Map();
	await WT.parseRegionFile(namedFile("r.-1.2.mca", region), (cx, cz, surface) => seen.set(`${cx},${cz}`, surface));
	// World chunk coords = region * 32 + local.
	assert.deepEqual([...seen.keys()].sort(), ["-28,69", "-29,69"]);
	const desert = seen.get("-29,69");
	assert.ok(desert.heights.every((h) => h === 70));
	assert.ok(desert.biomes.every((b) => b === "minecraft:desert"));
	assert.ok(desert.isWater.every((w) => w === false));
	const ocean = seen.get("-28,69");
	assert.ok(ocean.isWater.every((w) => w === true));
});

test("parseRegionFile extracts surface data from the bundled sample region", async () => {
	const bytes = fs.readFileSync(path.join(REPO_ROOT, "sample-data/r.0.0.mca"));
	const seen = [];
	await WT.parseRegionFile(namedFile("r.0.0.mca", bytes), (cx, cz, surface) => {
		seen.push({ cx, cz, surface });
	});
	assert.ok(seen.length > 0, "sample region should contain fully generated chunks");
	for (const { cx, cz, surface } of seen) {
		assert.ok(cx >= 0 && cx < 32 && cz >= 0 && cz < 32, `chunk ${cx},${cz} out of region bounds`);
		assert.ok(surface.heights && surface.biomes, "surface should carry heights and biomes");
		assert.equal(surface.heights.length, 256, "one height per block column in a chunk");
		assert.equal(surface.biomes.length, 256, "one biome per block column in a chunk");
	}
	const biomeNames = new Set(seen.flatMap(({ surface }) => [...surface.biomes]));
	for (const name of biomeNames) {
		if (name == null) continue;
		assert.match(String(name), /:/, `biome ${name} should be namespaced`);
	}
});
