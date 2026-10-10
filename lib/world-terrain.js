// Region-file (.mca) parsing and biome-map rendering, shared by the World
// Viewer page and the planner's world background. Nothing is uploaded:
// everything is parsed in the browser.
//
// The heavy lifting (computeTerrain) has no DOM dependencies, so it runs in
// a Web Worker (terrain-worker.js) and under Node for unit tests.
// buildTerrainImage() is the main-thread entry point that hands work to the
// worker and turns the result into a canvas.
//
// Format notes (verified against real 1.20.1 saves): heightmaps AND
// block_states/biomes use padded packing (values never span two longs), and
// a region file starts with an 8KB header of chunk locations.

import { parseNbtBuffer, readCapped } from "./nbt.js";

// ---------- biome colors ----------

// Approximate map-item colors for the vanilla overworld biomes. Anything else
// (modded biomes) goes through keywordColorForBiome, then hashColor.
export const BIOME_COLORS = {
	"minecraft:plains": "#8DB360",
	"minecraft:sunflower_plains": "#B5DB88",
	"minecraft:forest": "#056621",
	"minecraft:flower_forest": "#2D8E49",
	"minecraft:birch_forest": "#307444",
	"minecraft:old_growth_birch_forest": "#307444",
	"minecraft:dark_forest": "#40511A",
	"minecraft:taiga": "#0B6659",
	"minecraft:old_growth_pine_taiga": "#596651",
	"minecraft:old_growth_spruce_taiga": "#818E79",
	"minecraft:snowy_taiga": "#31554A",
	"minecraft:savanna": "#BDB25F",
	"minecraft:savanna_plateau": "#A79D64",
	"minecraft:windswept_savanna": "#E5DA87",
	"minecraft:desert": "#FA9418",
	"minecraft:badlands": "#D94515",
	"minecraft:eroded_badlands": "#D94515",
	"minecraft:wooded_badlands": "#B09765",
	"minecraft:jungle": "#507B0C",
	"minecraft:sparse_jungle": "#628B17",
	"minecraft:bamboo_jungle": "#768E14",
	"minecraft:swamp": "#4C763C",
	"minecraft:mangrove_swamp": "#3A7D4C",
	"minecraft:mushroom_fields": "#FF00FF",
	"minecraft:beach": "#FADE55",
	"minecraft:snowy_beach": "#FAF0C0",
	"minecraft:stony_shore": "#A3A39D",
	"minecraft:river": "#2941a0",
	"minecraft:frozen_river": "#A0A0FF",
	"minecraft:ocean": "#264C7A",
	"minecraft:deep_ocean": "#193456",
	"minecraft:warm_ocean": "#1E6FA6",
	"minecraft:lukewarm_ocean": "#205C99",
	"minecraft:cold_ocean": "#2D4A7A",
	"minecraft:deep_lukewarm_ocean": "#153F6B",
	"minecraft:deep_cold_ocean": "#243A5E",
	"minecraft:deep_frozen_ocean": "#4C5FA6",
	"minecraft:frozen_ocean": "#8FA6B0",
	"minecraft:snowy_plains": "#FAFAFA",
	"minecraft:ice_spikes": "#B4DCDC",
	"minecraft:windswept_hills": "#888C74",
	"minecraft:windswept_gravelly_hills": "#888C74",
	"minecraft:windswept_forest": "#6D7434",
	"minecraft:stony_peaks": "#A2A284",
	"minecraft:jagged_peaks": "#C9DFE8",
	"minecraft:frozen_peaks": "#A0C7E3",
	"minecraft:snowy_slopes": "#DEDEDE",
	"minecraft:grove": "#6F8467",
	"minecraft:meadow": "#63A948",
	"minecraft:cherry_grove": "#E993A6",
	"minecraft:dripstone_caves": "#855B3F",
	"minecraft:lush_caves": "#2C9C2C",
	"minecraft:deep_dark": "#1A1C21",
	"minecraft:the_void": "#0A0A0A",
};

// A stable, distinct color for a biome with no better match.
function hashHue(name) {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	return Math.abs(hash) % 360;
}

export function hashColor(name) {
	return `hsl(${hashHue(name)}, 45%, 45%)`;
}

// Modded biomes are overwhelmingly named with ordinary terrain words
// ("redwood_forest", "volcanic_peaks"), so a keyword match usually gives a
// color that fits what the biome is. Checked in order, most specific first
// ("snowy_forest" should read as snow, not forest).
const BIOME_KEYWORD_COLORS = [
	[["ocean", "sea", "reef", "abyss"], "#1E6FA6"],
	[["river", "lake", "lagoon"], "#3355DD"],
	[["frozen", "glacier", "arctic", "ice"], "#8FA6B0"],
	[["snow", "tundra", "permafrost"], "#DEDEDE"],
	[["desert", "dune", "sand"], "#FA9418"],
	[["badlands", "mesa", "canyon", "wasteland", "barren"], "#D94515"],
	[["volcan", "lava", "ash", "scorched", "ember"], "#7A2E1D"],
	[["swamp", "marsh", "bog", "mangrove", "wetland"], "#4C763C"],
	[["mushroom", "fungal", "fungus", "spore"], "#FF00FF"],
	[["jungle", "rainforest", "tropical"], "#507B0C"],
	[["beach", "coast", "shore"], "#FADE55"],
	[["peak", "summit", "alpine", "highland"], "#C9DFE8"],
	[["mountain", "hill", "cliff", "crag", "ridge"], "#888C74"],
	[["taiga", "conifer", "pine"], "#0B6659"],
	[["forest", "woodland", "thicket"], "#056621"],
	[["savanna", "shrubland"], "#BDB25F"],
	[["meadow", "grove", "orchard", "garden"], "#63A948"],
	[["plains", "grassland", "steppe", "prairie", "field"], "#8DB360"],
	[["cave", "grotto", "underground"], "#5A5A5A"],
	[["crystal", "mystical", "arcane", "fae", "fairy"], "#C6A0F6"],
	[["corrupted", "blighted", "cursed", "withered", "void"], "#3A2E3E"],
];

function keywordColorForBiome(name) {
	const shortName = (name.includes(":") ? name.slice(name.indexOf(":") + 1) : name).toLowerCase();
	for (const [keywords, color] of BIOME_KEYWORD_COLORS) {
		if (keywords.some((kw) => shortName.includes(kw))) return color;
	}
	return null;
}

export function colorForBiome(name) {
	return BIOME_COLORS[name] || keywordColorForBiome(name) || hashColor(name);
}

// CSS hsl() -> sRGB, matching how the browser itself resolves hashColor().
function hslToRgb(hue, saturation, lightness) {
	const a = saturation * Math.min(lightness, 1 - lightness);
	const channel = (n) => {
		const k = (n + hue / 30) % 12;
		return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	};
	return [channel(0), channel(8), channel(4)];
}

function hexToRgb(hex) {
	const v = parseInt(hex.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const biomeRgbCache = new Map();
export function rgbForBiome(name) {
	let rgb = biomeRgbCache.get(name);
	if (!rgb) {
		const hex = BIOME_COLORS[name] || keywordColorForBiome(name);
		rgb = hex ? hexToRgb(hex) : hslToRgb(hashHue(name), 0.45, 0.45);
		biomeRgbCache.set(name, rgb);
	}
	return rgb;
}

// Biomes are only stored per 4x4 cell, but a river cell is usually only
// partly water. Non-water blocks inside a water biome are painted with a
// land color instead, so rivers follow the real water blocks rather than a
// blocky 4x4 staircase.
const WATER_BIOME_NAMES = new Set([
	"minecraft:river",
	"minecraft:frozen_river",
	"minecraft:ocean",
	"minecraft:deep_ocean",
	"minecraft:warm_ocean",
	"minecraft:lukewarm_ocean",
	"minecraft:cold_ocean",
	"minecraft:deep_lukewarm_ocean",
	"minecraft:deep_cold_ocean",
	"minecraft:deep_frozen_ocean",
	"minecraft:frozen_ocean",
]);
const BANK_FALLBACK_BIOME = "minecraft:plains";

export function formatBiomeName(id) {
	const name = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
	return name
		.split("_")
		.filter(Boolean)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}

// ---------- chunk decoding ----------

// A real chunk decompresses to at most a few hundred KB; the cap bounds a
// crafted "zip bomb" chunk.
const MAX_INFLATED_CHUNK_BYTES = 16 * 1024 * 1024;

function inflate(bytes, format) {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
	return readCapped(stream, MAX_INFLATED_CHUNK_BYTES);
}

// Bits per palette index. `1 << bits` goes negative at 31 bits and would
// loop forever, so an absurd palette size (only possible in corrupt or
// hostile data) throws instead.
function bitsNeeded(n) {
	let bits = 0;
	while (1 << bits < n) {
		bits++;
		if (bits > 30) throw new Error(`Palette too large to decode (${n} entries).`);
	}
	return bits;
}

// Value `index` from a padded long array: each long holds
// floor(64 / bitsPerValue) values, low bits first, and no value spans two
// longs. (A tightly packed reading of block_states/biomes produced
// out-of-range palette indices for up to 40% of blocks on real data.)
function unpackPadded(longs, bitsPerValue, index) {
	const valuesPerLong = Math.floor(64 / bitsPerValue);
	const longIndex = Math.floor(index / valuesPerLong);
	if (longIndex >= longs.length) return null;
	const bitOffset = BigInt((index % valuesPerLong) * bitsPerValue);
	const mask = (1n << BigInt(bitsPerValue)) - 1n;
	const raw = BigInt.asUintN(64, toBigInt(longs[longIndex]));
	return Number((raw >> bitOffset) & mask);
}

// Chunks are parsed with nbt.js's bigIntLongArrays option, so entries are
// already BigInts; Numbers or decimal strings (nbt.js's default LongArray
// form) are converted.
function toBigInt(v) {
	return typeof v === "bigint" ? v : BigInt(v);
}

const WORLD_MIN_Y = -64;
const WORLD_HEIGHT = 384; // -64..320, the 1.18+ overworld

function findSection(chunkNbt, sectionCache, sectionY) {
	let section = sectionCache.get(sectionY);
	if (section === undefined) {
		section = (chunkNbt.sections || []).find((s) => s.Y === sectionY) || null;
		sectionCache.set(sectionY, section);
	}
	return section;
}

// Biome of one 4x4 column cell, sampled at that cell's own surface height
// (neighboring cells can be in different sections, e.g. across a cliff).
function biomeForCell(chunkNbt, sectionCache, cellX, cellZ, sampleHeight) {
	const sectionY = Math.floor(sampleHeight / 16);
	const section = findSection(chunkNbt, sectionCache, sectionY);
	if (!section || !section.biomes) return null;
	const palette = section.biomes.palette || [];
	if (palette.length === 0) return null;
	if (palette.length === 1) return palette[0];

	const localY = (((sampleHeight - sectionY * 16) % 16) + 16) % 16;
	const cellIndex = (Math.floor(localY / 4) * 4 + cellZ) * 4 + cellX;
	const data = section.biomes.data;
	if (!data) return palette[0];
	const bitsPerEntry = Math.max(bitsNeeded(palette.length), 1);
	const paletteIndex = unpackPadded(data, bitsPerEntry, cellIndex);
	return palette[paletteIndex] ?? palette[0] ?? null;
}

// The block name at one position (block states are stored per block,
// unlike biomes).
function blockNameAt(chunkNbt, sectionCache, x, y, z) {
	const sectionY = Math.floor(y / 16);
	const section = findSection(chunkNbt, sectionCache, sectionY);
	if (!section || !section.block_states) return null;
	const palette = section.block_states.palette || [];
	if (palette.length === 0) return null;
	if (palette.length === 1) return palette[0].Name ?? null;

	const localX = ((x % 16) + 16) % 16;
	const localY = (((y - sectionY * 16) % 16) + 16) % 16;
	const localZ = ((z % 16) + 16) % 16;
	const data = section.block_states.data;
	if (!data) return palette[0].Name ?? null;
	// Block states always use at least 4 bits per entry (biomes: 1).
	const bitsPerEntry = Math.max(bitsNeeded(palette.length), 4);
	const index = (localY * 16 + localZ) * 16 + localX;
	const paletteIndex = unpackPadded(data, bitsPerEntry, index);
	return palette[paletteIndex]?.Name ?? palette[0]?.Name ?? null;
}

// Surface blocks that count as water (kelp and seagrass reach the surface of
// open water).
const WATER_LIKE_BLOCK_NAMES = new Set([
	"minecraft:water",
	"minecraft:bubble_column",
	"minecraft:seagrass",
	"minecraft:tall_seagrass",
	"minecraft:kelp",
	"minecraft:kelp_plant",
]);

// Everything the map needs from one chunk, per column (256 entries each):
//   heights       top non-air block (WORLD_SURFACE heightmap)
//   shadeHeights  ground height for relief shading, ignoring tree canopy and
//                 standing water
//   biomes        biome name (sampled per 4x4 cell)
//   isWater, isTree  what the surface block is
function extractChunkSurface(chunkNbt) {
	const worldSurface = chunkNbt.Heightmaps?.WORLD_SURFACE;
	if (!worldSurface || !worldSurface.length) return null;
	const bits = bitsNeeded(WORLD_HEIGHT + 1);

	const heights = new Array(256);
	for (let i = 0; i < 256; i++) {
		const packed = unpackPadded(worldSurface, bits, i);
		heights[i] = packed == null ? null : packed + WORLD_MIN_Y;
	}

	// No single vanilla heightmap gives true ground: MOTION_BLOCKING_NO_LEAVES
	// ignores leaves but reports the water surface over oceans, and
	// OCEAN_FLOOR ignores water but counts leaves. Real ground is at or below
	// both, so the minimum of the two is used (without them, tree canopies
	// show up as bumps and oceans as flat plains).
	const noLeaves = chunkNbt.Heightmaps?.MOTION_BLOCKING_NO_LEAVES;
	const oceanFloor = chunkNbt.Heightmaps?.OCEAN_FLOOR;
	const shadeHeights = new Array(256);
	for (let i = 0; i < 256; i++) {
		let sh = heights[i];
		if (noLeaves && noLeaves.length) {
			const packed = unpackPadded(noLeaves, bits, i);
			if (packed != null) sh = packed + WORLD_MIN_Y;
		}
		if (oceanFloor && oceanFloor.length) {
			const packed = unpackPadded(oceanFloor, bits, i);
			if (packed != null) sh = Math.min(sh, packed + WORLD_MIN_Y);
		}
		shadeHeights[i] = sh;
	}

	const sectionCache = new Map();
	const biomes = new Array(256).fill(null);
	for (let cellZ = 0; cellZ < 4; cellZ++) {
		for (let cellX = 0; cellX < 4; cellX++) {
			const h = heights[(cellZ * 4 + 2) * 16 + (cellX * 4 + 2)];
			if (h == null) continue;
			const biome = biomeForCell(chunkNbt, sectionCache, cellX, cellZ, h);
			if (!biome) continue;
			for (let dz = 0; dz < 4; dz++) {
				for (let dx = 0; dx < 4; dx++) {
					biomes[(cellZ * 4 + dz) * 16 + (cellX * 4 + dx)] = biome;
				}
			}
		}
	}

	// WORLD_SURFACE is one above the top block, hence h - 1.
	const blockSectionCache = new Map();
	const isWater = new Array(256).fill(false);
	const isTree = new Array(256).fill(false);
	for (let z = 0; z < 16; z++) {
		for (let x = 0; x < 16; x++) {
			const i = z * 16 + x;
			const h = heights[i];
			if (h == null) continue;
			const name = blockNameAt(chunkNbt, blockSectionCache, x, h - 1, z);
			if (!name) continue;
			isWater[i] = WATER_LIKE_BLOCK_NAMES.has(name);
			isTree[i] = name.endsWith("_leaves") || name.endsWith("_log") || name.endsWith("_wood") || name === "minecraft:mushroom_stem";
		}
	}

	return { heights, shadeHeights, biomes, isWater, isTree };
}

// ---------- region files ----------

export function parseRegionFilename(name) {
	const m = name.match(/r\.(-?\d+)\.(-?\d+)\.mca$/);
	if (!m) return null;
	return { rx: parseInt(m[1], 10), rz: parseInt(m[2], 10) };
}

const REGION_HEADER_SIZE = 8192; // 1024 chunk locations + 1024 timestamps, 4 bytes each

// Calls onChunk(worldChunkX, worldChunkZ, surface) for every fully
// generated chunk. Corrupt or unsupported chunks are skipped; only a file
// that isn't a region file at all throws.
export async function parseRegionFile(file, onChunk) {
	const coords = parseRegionFilename(file.name);
	if (!coords) throw new Error(`"${file.name}" doesn't look like a region file (expected r.X.Z.mca)`);
	const buf = await file.arrayBuffer();
	// The game creates empty 0-byte region files for areas it only touched,
	// and a world folder can have dozens - treat those as empty, not errors.
	if (buf.byteLength === 0) return;
	if (buf.byteLength < REGION_HEADER_SIZE) {
		throw new Error(`"${file.name}" is too small to be a region file (${buf.byteLength} bytes, expected at least ${REGION_HEADER_SIZE})`);
	}
	const view = new DataView(buf);
	const bytes = new Uint8Array(buf);

	for (let cz = 0; cz < 32; cz++) {
		for (let cx = 0; cx < 32; cx++) {
			const entryOffset = (cx + cz * 32) * 4;
			const sectorOffset = bytes[entryOffset] * 65536 + bytes[entryOffset + 1] * 256 + bytes[entryOffset + 2];
			const sectorCount = bytes[entryOffset + 3];
			if (sectorOffset === 0 && sectorCount === 0) continue; // never generated

			const byteOffset = sectorOffset * 4096;
			if (byteOffset + 5 > buf.byteLength) continue; // truncated
			const length = view.getUint32(byteOffset);
			const compressionType = bytes[byteOffset + 4];
			const payload = bytes.subarray(byteOffset + 5, byteOffset + 4 + length);

			let inflated;
			try {
				if (compressionType === 2) inflated = await inflate(payload, "deflate");
				else if (compressionType === 1) inflated = await inflate(payload, "gzip");
				else if (compressionType === 3) inflated = payload;
				else continue; // e.g. LZ4 or external chunks - unsupported
			} catch {
				continue;
			}

			let chunkNbt;
			try {
				const chunkBuffer = inflated.buffer.slice(inflated.byteOffset, inflated.byteOffset + inflated.byteLength);
				chunkNbt = parseNbtBuffer(chunkBuffer, { bigIntLongArrays: true }).value;
			} catch {
				continue;
			}

			if (chunkNbt.Status && chunkNbt.Status !== "minecraft:full") continue; // still generating

			let surface;
			try {
				surface = extractChunkSurface(chunkNbt);
			} catch {
				continue; // e.g. an absurd palette size
			}
			if (surface) onChunk(coords.rx * 32 + cx, coords.rz * 32 + cz, surface);
		}
	}
}

// ---------- picking files ----------

// A chosen or dropped folder can be a whole world save, which has three .mca
// trees: region/ (terrain - what we want), poi/ and entities/. Prefer files
// under region/ when paths are known; loose files are taken as-is.
export function filterMcaFiles(files) {
	const mca = files.filter((f) => f.name.toLowerCase().endsWith(".mca"));
	const relPath = (f) => f.webkitRelativePath || f.__mcaRelativePath || "";
	const withPath = mca.filter((f) => relPath(f));
	if (withPath.length === 0) return mca;
	const inRegionFolder = withPath.filter((f) => relPath(f).toLowerCase().split("/").includes("region"));
	return inRegionFolder.length > 0 ? inRegionFolder : mca;
}

// readEntries() returns a directory in batches; keep reading until empty.
export function readAllDirectoryEntries(reader) {
	return new Promise((resolve, reject) => {
		const all = [];
		const readBatch = () => {
			reader.readEntries((entries) => {
				if (entries.length === 0) {
					resolve(all);
					return;
				}
				all.push(...entries);
				readBatch();
			}, reject);
		};
		readBatch();
	});
}

function entryToFile(entry) {
	return new Promise((resolve, reject) => entry.file(resolve, reject));
}

// Collects every file under a dropped FileSystemEntry. Dropped files don't
// get webkitRelativePath, so the entry's path is kept in our own property
// for filterMcaFiles.
export async function collectFilesFromEntry(entry, out) {
	if (entry.isFile) {
		const file = await entryToFile(entry);
		file.__mcaRelativePath = entry.fullPath;
		out.push(file);
	} else if (entry.isDirectory) {
		const children = await readAllDirectoryEntries(entry.createReader());
		for (const child of children) await collectFilesFromEntry(child, out);
	}
}

// ---------- building the map ----------

const NO_HEIGHT = -32768; // "no data" in the Int16Array height grids

// The map covers the bounding box of every uploaded chunk, gaps included.
// Two limits: total blocks (what memory actually scales with - about 230MB
// at the cap) and blocks per axis (browser canvas size limits).
export const MAX_GRID_BLOCKS = 60_000_000;
export const MAX_GRID_DIMENSION = 16384;

const TOO_FAR_APART_MESSAGE = (w, h) =>
	`These files are too far apart to render together (they'd span ${w}×${h} blocks) - ` +
	`the map would have to cover the whole gap between them, not just the parts you actually have data for. ` +
	`Upload region files that are next to each other (adjacent r.X.Z.mca coordinates) instead.`;

// A quick check from the filenames alone, before any parsing work.
export function checkFileSpan(files) {
	const regionCoords = files.map((f) => parseRegionFilename(f.name)).filter(Boolean);
	if (regionCoords.length <= 1) return { ok: true };
	const rxs = regionCoords.map((c) => c.rx);
	const rzs = regionCoords.map((c) => c.rz);
	const spanBlocksX = (Math.max(...rxs) - Math.min(...rxs) + 1) * 512;
	const spanBlocksZ = (Math.max(...rzs) - Math.min(...rzs) + 1) * 512;
	if (spanBlocksX > MAX_GRID_DIMENSION || spanBlocksZ > MAX_GRID_DIMENSION || spanBlocksX * spanBlocksZ > MAX_GRID_BLOCKS) {
		return { ok: false, message: TOO_FAR_APART_MESSAGE(spanBlocksX, spanBlocksZ) };
	}
	return { ok: true };
}

// Parses every file and paints the combined map, without touching the DOM.
// Returns { ok: false, message } (no data, too far apart), { ok: false,
// stale: true } (isStale() turned true), or:
//   { ok: true, pixels (RGBA, gridW x gridH), gridW, gridH, minCx, minCz,
//     heightGrid, biomeGrid, biomeNames, biomesSeen, totalChunks, fileErrors }
// One bad file doesn't discard the rest; its error is listed in fileErrors.
export async function computeTerrain(files, { onStatus, isStale } = {}) {
	const spanCheck = checkFileSpan(files);
	if (!spanCheck.ok) return { ok: false, message: spanCheck.message };

	onStatus?.(`Parsing ${files.length} region file${files.length === 1 ? "" : "s"}…`);

	const chunkSurfaces = new Map(); // "cx,cz" -> extractChunkSurface() result
	let minCx = Infinity, maxCx = -Infinity, minCz = Infinity, maxCz = -Infinity;
	let totalChunks = 0;
	const biomesSeen = new Set();
	const fileErrors = [];

	for (const file of files) {
		if (isStale?.()) return { ok: false, stale: true };
		onStatus?.(`Parsing ${file.name}…`);
		try {
			await parseRegionFile(file, (cx, cz, surface) => {
				chunkSurfaces.set(`${cx},${cz}`, surface);
				for (const b of surface.biomes) if (b) biomesSeen.add(b);
				minCx = Math.min(minCx, cx);
				maxCx = Math.max(maxCx, cx);
				minCz = Math.min(minCz, cz);
				maxCz = Math.max(maxCz, cz);
				totalChunks++;
			});
		} catch (err) {
			fileErrors.push(`${file.name}: ${err.message}`);
		}
	}

	if (isStale?.()) return { ok: false, stale: true };

	if (totalChunks === 0) {
		return {
			ok: false,
			message: fileErrors.length ? `Error: ${fileErrors.join("; ")}` : "No fully-generated chunks found in the uploaded file(s).",
		};
	}

	const gridW = (maxCx - minCx + 1) * 16;
	const gridH = (maxCz - minCz + 1) * 16;
	if (gridW > MAX_GRID_DIMENSION || gridH > MAX_GRID_DIMENSION || gridW * gridH > MAX_GRID_BLOCKS) {
		return { ok: false, message: TOO_FAR_APART_MESSAGE(gridW, gridH) };
	}

	// Flat per-block grids over the whole area, so shading can compare a block
	// with its neighbor across chunk and file boundaries. Biome names are
	// interned to small integers (2 bytes per block instead of a string
	// reference).
	const heightGrid = new Int16Array(gridW * gridH).fill(NO_HEIGHT);
	const shadeHeightGrid = new Int16Array(gridW * gridH).fill(NO_HEIGHT);
	const biomeGrid = new Uint16Array(gridW * gridH); // 0 = no biome
	const biomeNames = [null];
	const biomeIds = new Map();
	const internBiome = (name) => {
		let id = biomeIds.get(name);
		if (id === undefined) {
			id = biomeNames.length;
			biomeNames.push(name);
			biomeIds.set(name, id);
		}
		return id;
	};
	const waterGrid = new Uint8Array(gridW * gridH);
	const treeGrid = new Uint8Array(gridW * gridH);

	for (const [key, surface] of chunkSurfaces) {
		const [cx, cz] = key.split(",").map(Number);
		const baseX = (cx - minCx) * 16;
		const baseZ = (cz - minCz) * 16;
		for (let lz = 0; lz < 16; lz++) {
			const rowOffset = (baseZ + lz) * gridW + baseX;
			const srcOffset = lz * 16;
			for (let lx = 0; lx < 16; lx++) {
				const h = surface.heights[srcOffset + lx];
				if (h == null) continue;
				heightGrid[rowOffset + lx] = h;
				const sh = surface.shadeHeights[srcOffset + lx];
				shadeHeightGrid[rowOffset + lx] = sh == null ? h : sh;
				const b = surface.biomes[srcOffset + lx];
				if (b) biomeGrid[rowOffset + lx] = internBiome(b);
				waterGrid[rowOffset + lx] = surface.isWater[srcOffset + lx] ? 1 : 0;
				treeGrid[rowOffset + lx] = surface.isTree[srcOffset + lx] ? 1 : 0;
			}
		}
	}

	// One pixel per block: biome color, darkened under tree canopy, with
	// vanilla map-item relief (each block compared to its south neighbor:
	// higher -> lighter, lower -> darker) - crisp per-block relief rather
	// than a smoothed hillshade.
	const pixels = new Uint8ClampedArray(gridW * gridH * 4);
	for (let gz = 0; gz < gridH; gz++) {
		for (let gx = 0; gx < gridW; gx++) {
			const idx = gz * gridW + gx;
			if (heightGrid[idx] === NO_HEIGHT) continue; // stays transparent
			const dst = idx * 4;
			const biome = biomeNames[biomeGrid[idx]];
			const useBankFallback = biome && WATER_BIOME_NAMES.has(biome) && !waterGrid[idx];
			let [r, g, b] = useBankFallback ? rgbForBiome(BANK_FALLBACK_BIOME) : biome ? rgbForBiome(biome) : [128, 128, 128];

			if (treeGrid[idx]) {
				r *= 0.62;
				g *= 0.7;
				b *= 0.62;
			}

			const sh = shadeHeightGrid[idx];
			const southH = gz < gridH - 1 ? shadeHeightGrid[idx + gridW] : sh;
			if (sh !== NO_HEIGHT && southH !== NO_HEIGHT) {
				if (sh > southH) {
					r *= 1.18;
					g *= 1.18;
					b *= 1.18;
				} else if (sh < southH) {
					r *= 0.74;
					g *= 0.74;
					b *= 0.74;
				}
			}

			pixels[dst] = r;
			pixels[dst + 1] = g;
			pixels[dst + 2] = b;
			pixels[dst + 3] = 255;
		}
	}

	return {
		ok: true,
		pixels,
		gridW,
		gridH,
		minCx,
		minCz,
		heightGrid,
		biomeGrid,
		biomeNames,
		biomesSeen,
		totalChunks,
		fileErrors,
	};
}

// biomeAt(worldX, worldZ) -> { biome, height } | null, over computeTerrain's grids.
export function makeBiomeLookup({ gridW, gridH, minCx, minCz, heightGrid, biomeGrid, biomeNames }) {
	return (worldX, worldZ) => {
		const gx = worldX - minCx * 16;
		const gz = worldZ - minCz * 16;
		if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridH) return null;
		const idx = gz * gridW + gx;
		const h = heightGrid[idx];
		if (h === NO_HEIGHT) return null;
		return { biome: biomeNames[biomeGrid[idx]], height: h };
	};
}

// Runs computeTerrain in a Web Worker so a large upload doesn't freeze the
// page, falling back to the main thread where workers aren't available.
// isStale is polled here (the worker can't call back into the page); a
// stale run's worker is terminated.
function computeTerrainOffThread(files, { onStatus, isStale }) {
	const inline = () => computeTerrain(files, { onStatus, isStale });
	if (typeof Worker === "undefined") return inline();
	let worker;
	try {
		worker = new Worker(new URL("./terrain-worker.js", import.meta.url), { type: "module" });
	} catch {
		return inline();
	}
	return new Promise((resolve) => {
		const staleTimer = setInterval(() => {
			if (isStale?.()) finish({ ok: false, stale: true });
		}, 100);
		function finish(result) {
			clearInterval(staleTimer);
			worker.terminate();
			resolve(result);
		}
		worker.onmessage = ({ data }) => {
			if (data.type === "status") {
				if (!isStale?.()) onStatus?.(data.text);
			} else if (data.type === "result") {
				finish(isStale?.() ? { ok: false, stale: true } : data.result);
			}
		};
		// The worker script itself failed to load or run - do the work here.
		worker.onerror = (event) => {
			event.preventDefault();
			clearInterval(staleTimer);
			worker.terminate();
			resolve(inline());
		};
		worker.postMessage({ files });
	});
}

// The full pipeline for a page: parse off the main thread, then paint into a
// canvas. Resolves to the computeTerrain() failure shapes, or:
//   { ok: true, canvas, gridW, gridH, minCx, minCz, biomesSeen, totalChunks,
//     fileErrors, biomeAt(worldX, worldZ) }
// onStatus(text) receives progress messages; isStale() can abandon the run.
export async function buildTerrainImage(files, { onStatus, isStale } = {}) {
	const data = await computeTerrainOffThread(files, { onStatus, isStale });
	if (!data.ok) return data;
	const canvas = document.createElement("canvas");
	canvas.width = data.gridW;
	canvas.height = data.gridH;
	canvas.getContext("2d").putImageData(new ImageData(data.pixels, data.gridW, data.gridH), 0, 0);
	return {
		ok: true,
		canvas,
		gridW: data.gridW,
		gridH: data.gridH,
		minCx: data.minCx,
		minCz: data.minCz,
		biomesSeen: data.biomesSeen,
		totalChunks: data.totalChunks,
		fileErrors: data.fileErrors,
		biomeAt: makeBiomeLookup(data),
	};
}
