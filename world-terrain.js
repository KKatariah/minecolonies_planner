// Shared region-file parsing + biome-map rendering, used by both
// world-viewer.js (the standalone map page) and app.js (the "upload a world
// as a background" feature on the planner grid). Kept in one place so the
// two features can't drift apart on the parsing bugs that were already found
// and fixed here - see FEASIBILITY_NOTES.md for the full writeup.
//
// Nothing is uploaded anywhere; parsing happens entirely in the browser via
// nbt.js plus the native DecompressionStream API for the region file's
// per-chunk zlib payloads.

// Wrapped in an IIFE so none of the internal helper names below leak into
// the global scope - this is a classic <script>, not a module, so a plain
// top-level `function foo(){}` becomes `window.foo` implicitly, which would
// collide with any consumer script that declares its own local `foo`
// (confirmed: world-viewer.js destructuring `const { filterMcaFiles } =
// window.WorldTerrain` threw "Identifier already declared" against this
// file's own top-level `function filterMcaFiles` before this wrapper was
// added). Only the explicit window.WorldTerrain assignment at the bottom is
// meant to be visible to other scripts.
(function () {

// ---------- biome colors ----------
// Approximate map-item-style colors per vanilla biome. Anything not listed
// (modded biomes, or vanilla ones not worth enumerating for colony siting —
// Nether/End biomes) falls back to a deterministic hash color so it's still
// visually distinct rather than defaulting to a single "unknown" gray.
const BIOME_COLORS = {
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

function hashColor(name) {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	const hue = Math.abs(hash) % 360;
	return `hsl(${hue}, 45%, 45%)`;
}

// A name with no exact BIOME_COLORS entry is almost certainly a modded
// biome (BIOME_COLORS deliberately enumerates the full vanilla list above) -
// rather than falling straight to an arbitrary hash color for those, check
// for plain-English terrain words first. Modpacks that add biomes
// (Terralith, Biomes O' Plenty, Oh The Biomes You'll Go, etc.) overwhelmingly
// name them by combining ordinary descriptive words like this
// ("volcanic_peaks", "redwood_forest", "coral_reef"), so this catches a
// large share of modded biomes with a color that actually matches what the
// biome IS, not just a color that's merely consistent/distinct.
//
// Checked in this order (most to least specific) since a name can contain
// more than one keyword - e.g. "snowy_forest" should read as snow, not
// forest, so snow is checked first. Each group only lists words that aren't
// already covered as a substring of another word in the same group (e.g.
// "snow" alone also matches "snowy" - no need to list both).
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

function colorForBiome(name) {
	return BIOME_COLORS[name] || keywordColorForBiome(name) || hashColor(name);
}

// Biomes are only known at 4x4-block resolution, but rivers/oceans are
// mostly water WITHIN a biome cell, not entirely - painting the whole cell
// blue produced a blocky, staircase-edged river that didn't match the
// actual winding shape of the water blocks (confirmed by cropping a
// rendered sample and comparing the edge step size to the 4-block cell
// size). Falling back to a land tone for non-water blocks inside a
// water-biome cell fixes the shape using real per-block data, at the cost
// of a slightly generic fallback color for the handful of dry bank blocks
// right at a river's edge.
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

function formatBiomeName(id) {
	const name = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
	return name
		.split("_")
		.filter(Boolean)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}

// Biome names come straight out of an uploaded file's NBT palette - fully
// attacker-controlled. Confirmed exploitable with a hand-built region file
// whose biome string was `minecraft:plains"><img src=x
// onerror="window.xssFired=true">`: it ran (verified via a headless
// browser) everywhere formatBiomeName()'s output got interpolated into
// innerHTML. Escape before ever building HTML strings from it.
function escapeHtml(str) {
	return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- region/chunk parsing ----------

// A real fully-generated chunk's decompressed NBT (all sections, palettes,
// heightmaps, entities) tops out in the tens-to-low-hundreds of KB - 16MB is
// generous headroom while still bounding the blast radius of a compressed
// payload engineered to decompress far past its on-disk size (a "zip bomb").
// Read progressively and bail out as soon as the cap is crossed rather than
// buffering the whole stream first (Response.arrayBuffer() has no size
// limit of its own - it would happily keep growing until the tab runs out
// of memory).
const MAX_INFLATED_CHUNK_BYTES = 16 * 1024 * 1024;

async function readCapped(stream, maxBytes) {
	const reader = stream.getReader();
	const parts = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error(`Decompressed chunk data exceeds ${maxBytes} bytes - refusing to continue (likely a corrupt or malicious file).`);
		}
		parts.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
}

async function inflate(bytes) {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
	return readCapped(stream, MAX_INFLATED_CHUNK_BYTES);
}

// `<<` operates on 32-bit SIGNED integers in JS - once bits reaches 31,
// `1 << bits` goes negative and is < n forever, so an n big enough (over
// ~1.07 billion) span an infinite loop instead of a large-but-finite one.
// Nothing legitimate ever needs anywhere near that (a real palette tops out
// in the hundreds of entries), so treat crossing this as the corrupt/hostile
// data it can only be and throw instead of hanging the tab.
function bitsNeeded(n) {
	let bits = 0;
	while (1 << bits < n) {
		bits++;
		if (bits > 30) throw new Error(`Palette too large to decode (${n} entries).`);
	}
	return Math.max(bits, 0);
}

// Every long-array container in chunk NBT - heightmaps, AND block_states/
// biomes palette data too - pads each long to a whole number of values
// rather than splitting one across a long boundary. Confirmed for
// heightmaps against real chunk data (a 256-value, 9-bit heightmap produced
// 37 longs, matching only this scheme). block_states/biomes were initially
// implemented against a different, tightly-packed "no waste" scheme on the
// assumption that a later format version changed to it - that assumption
// was wrong. Confirmed by cross-testing both schemes against real
// ocean-chunk data (DataVersion 3465 / 1.20.1): the no-waste decode
// produced out-of-range palette indices for up to ~40% of blocks in a
// section (silently falling back to palette[0], which is what produced
// water cells rendering as stray patches of land color), while this padded
// scheme decodes 0 out-of-range across every section tested.
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
// already BigInts; a plain Number or decimal string (the default LongArray
// form, e.g. from a caller that didn't opt in) is converted.
function toBigInt(v) {
	return typeof v === "bigint" ? v : BigInt(v);
}

const WORLD_MIN_Y = -64;
const WORLD_HEIGHT = 384; // -64..320, standard 1.18+ overworld

// Biome lookup for one 4x4 cell, sampled at its own surface height (cells
// can genuinely differ in height from their neighbors, e.g. either side of
// a cliff edge, so each cell needs its own section lookup rather than
// reusing one chunk-wide reference height).
function biomeForCell(chunkNbt, sectionCache, cellX, cellZ, sampleHeight) {
	const sectionY = Math.floor(sampleHeight / 16);
	let section = sectionCache.get(sectionY);
	if (section === undefined) {
		section = (chunkNbt.sections || []).find((s) => s.Y === sectionY) || null;
		sectionCache.set(sectionY, section);
	}
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

// Full per-block resolution lookup of the actual block name at one column -
// unlike biomes (genuinely stored at 4x4 granularity), block placement is
// stored per-block, so this is what tells water/land apart at the same
// resolution the game itself uses. Same section-cache pattern as
// biomeForCell, but a separate cache since block_states sections need
// looking up independently of biome sections.
function blockNameAt(chunkNbt, sectionCache, x, y, z) {
	const sectionY = Math.floor(y / 16);
	let section = sectionCache.get(sectionY);
	if (section === undefined) {
		section = (chunkNbt.sections || []).find((s) => s.Y === sectionY) || null;
		sectionCache.set(sectionY, section);
	}
	if (!section || !section.block_states) return null;
	const palette = section.block_states.palette || [];
	if (palette.length === 0) return null;
	if (palette.length === 1) return palette[0].Name ?? null;

	const localX = ((x % 16) + 16) % 16;
	const localY = (((y - sectionY * 16) % 16) + 16) % 16;
	const localZ = ((z % 16) + 16) % 16;
	const data = section.block_states.data;
	if (!data) return palette[0].Name ?? null;
	// Block-state containers use a minimum of 4 bits/entry (unlike biomes'
	// minimum of 1) - a fixed rule of the format, not derived from palette size.
	const bitsPerEntry = Math.max(bitsNeeded(palette.length), 4);
	const index = (localY * 16 + localZ) * 16 + localX;
	const paletteIndex = unpackPadded(data, bitsPerEntry, index);
	return palette[paletteIndex]?.Name ?? palette[0]?.Name ?? null;
}

const WATER_LIKE_BLOCK_NAMES = new Set([
	"minecraft:water",
	"minecraft:bubble_column",
	"minecraft:seagrass",
	"minecraft:tall_seagrass",
	"minecraft:kelp",
	"minecraft:kelp_plant",
]);

// Full per-block resolution for one chunk: all 256 surface heights (one per
// column), and biome sampled once per 4x4 cell (biomes don't vary at finer
// granularity than that in the actual data - no benefit to sampling every
// block) then reused across that cell's 4x4 block area.
function extractChunkSurface(chunkNbt) {
	const worldSurface = chunkNbt.Heightmaps?.WORLD_SURFACE;
	if (!worldSurface || !worldSurface.length) return null;
	const bits = bitsNeeded(WORLD_HEIGHT + 1);

	const heights = new Array(256);
	for (let i = 0; i < 256; i++) {
		const packed = unpackPadded(worldSurface, bits, i);
		heights[i] = packed == null ? null : packed + WORLD_MIN_Y;
	}

	// A SEPARATE height sample for relief shading specifically - real ground
	// height, excluding BOTH tree canopy AND standing water, neither of
	// which any single vanilla heightmap type gives you alone:
	//  - WORLD_SURFACE/MOTION_BLOCKING count leaves as ground, so every tree
	//    canopy shows up as a small false "hill" (confirmed: dense, squiggly
	//    dark-line artifacts over forested terrain).
	//  - MOTION_BLOCKING_NO_LEAVES ignores leaves but still counts water as
	//    ground, so it reports the flat water SURFACE for any ocean column
	//    (always sea level) rather than the real, varying sea floor beneath
	//    - confirmed empirically: large "completely flat" patches reported
	//      over open ocean turned out to be MOTION_BLOCKING_NO_LEAVES
	//      uniformly reading sea level (y=63) chunk-wide, while OCEAN_FLOOR
	//      showed genuine variance of 10-20+ blocks in those exact columns.
	//  - OCEAN_FLOOR ignores fluids but DOES still count leaves as ground
	//    (confirmed: higher than MOTION_BLOCKING_NO_LEAVES by up to 13
	//    blocks across most columns of a real forested chunk) - so it has
	//    the opposite blind spot.
	// Real ground (ignoring both) must be at or below whichever of these
	// two a column reports, so the minimum of the two is the closest thing
	// to "true terrain height" any combination of stock heightmaps can give
	// without scanning actual block data column-by-column.
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
			const sampleX = cellX * 4 + 2;
			const sampleZ = cellZ * 4 + 2;
			const h = heights[sampleZ * 16 + sampleX];
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

	// What the top surface block of each column actually is - real per-block
	// resolution, unlike the biome grid above (which only knows what's
	// happening at 4x4 granularity, so it can't tell "under a tree" from "in
	// a clearing" within the same cell). WORLD_SURFACE counts anything
	// non-air as ground, including water AND leaves, so for a tree column the
	// recorded height lands right on top of its canopy, one above the
	// leaf/log block itself - hence h - 1 below.
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
			// Underwater plants/features sit right at the water's surface
			// column too (kelp and seagrass grow up to just under the top,
			// bubble columns form in open water) - counting only the literal
			// "minecraft:water" name left these columns falling through to
			// the land-fallback color, scattering stray green flecks through
			// kelp forests even after fixing the main bit-packing bug above.
			isWater[i] = WATER_LIKE_BLOCK_NAMES.has(name);
			isTree[i] = name.endsWith("_leaves") || name.endsWith("_log") || name.endsWith("_wood") || name === "minecraft:mushroom_stem";
		}
	}

	return { heights, shadeHeights, biomes, isWater, isTree };
}

function parseRegionFilename(name) {
	const m = name.match(/r\.(-?\d+)\.(-?\d+)\.mca$/);
	if (!m) return null;
	return { rx: parseInt(m[1], 10), rz: parseInt(m[2], 10) };
}

const REGION_HEADER_SIZE = 8192; // 1024-entry location table + 1024-entry timestamp table, 4 bytes each

async function parseRegionFile(file, onChunk) {
	const coords = parseRegionFilename(file.name);
	if (!coords) throw new Error(`"${file.name}" doesn't look like a region file (expected r.X.Z.mca)`);
	const buf = await file.arrayBuffer();
	// A file shorter than the header itself (e.g. empty/0 bytes) previously
	// crashed with a raw "Offset is outside the bounds of the DataView"
	// error - the off3===0 && sectorCount===0 skip check below assumes
	// bytes[entryOffset] reads a real number, but a too-short buffer makes
	// those reads return undefined, propagating as NaN through arithmetic
	// that a strict === 0 check doesn't catch, all the way to a DataView
	// read that finally throws. Confirmed empirically with a literal 0-byte
	// file. Reject up front instead.
	//
	// A literal 0-byte file specifically is normal, not corruption: the
	// game pre-creates an empty region file stub for areas its chunk-
	// loading logic merely touched (e.g. flying/teleporting across a large
	// span at once), even when nothing in that region was ever actually
	// generated. A world folder covering any real amount of exploration
	// routinely has dozens of these - surfacing each one as a "Skipped:
	// ... too small ..." error drowned out anything genuinely wrong in a
	// wall of expected noise. Treat it as simply empty (zero chunks, same
	// as if the file were never uploaded) instead of an error. Anything
	// else undersized (a handful of bytes, but not exactly zero) is more
	// likely real truncation/corruption, so that path still reports.
	if (buf.byteLength === 0) return;
	if (buf.byteLength < REGION_HEADER_SIZE) {
		throw new Error(`"${file.name}" is too small to be a region file (${buf.byteLength} bytes, expected at least ${REGION_HEADER_SIZE})`);
	}
	const view = new DataView(buf);
	const bytes = new Uint8Array(buf);

	for (let cz = 0; cz < 32; cz++) {
		for (let cx = 0; cx < 32; cx++) {
			const headerIndex = cx + cz * 32;
			const entryOffset = headerIndex * 4;
			const off3 = bytes[entryOffset] * 65536 + bytes[entryOffset + 1] * 256 + bytes[entryOffset + 2];
			const sectorCount = bytes[entryOffset + 3];
			if (off3 === 0 && sectorCount === 0) continue; // chunk not generated

			const byteOffset = off3 * 4096;
			if (byteOffset + 5 > buf.byteLength) continue; // corrupt/truncated entry
			const length = view.getUint32(byteOffset);
			const compressionType = bytes[byteOffset + 4];
			const payload = bytes.subarray(byteOffset + 5, byteOffset + 4 + length);

			let inflated;
			try {
				if (compressionType === 2) inflated = await inflate(payload);
				else if (compressionType === 1) {
					const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("gzip"));
					inflated = await readCapped(stream, MAX_INFLATED_CHUNK_BYTES);
				} else if (compressionType === 3) inflated = payload;
				else continue; // unsupported (e.g. external/LZ4 chunks) - skip
			} catch {
				continue; // corrupt chunk - skip rather than aborting the whole file
			}

			let chunkNbt;
			try {
				chunkNbt = window.NBT.parseNbtBuffer(inflated.buffer.slice(inflated.byteOffset, inflated.byteOffset + inflated.byteLength), { bigIntLongArrays: true }).value;
			} catch {
				continue;
			}

			if (chunkNbt.Status && chunkNbt.Status !== "minecraft:full") continue; // not fully generated yet

			const worldChunkX = coords.rx * 32 + cx;
			const worldChunkZ = coords.rz * 32 + cz;
			let surface;
			try {
				surface = extractChunkSurface(chunkNbt);
			} catch {
				continue; // corrupt/hostile chunk data (e.g. an oversized palette) - skip rather than aborting the whole file
			}
			if (surface) onChunk(worldChunkX, worldChunkZ, surface);
		}
	}
}

// ---------- file/folder selection helpers ----------

// A folder (whether picked via "Choose folder" or dropped) can contain
// anything - the rest of a world save (level.dat, playerdata/, datapacks/,
// etc), not just region/*.mca - so always filter down to .mca files by
// name rather than assuming every File handed in is already a region file.
//
// A world save actually has THREE identically-named .mca trees at the top
// level - region/ (block data, what this wants), poi/ (points of interest -
// villager workstations etc, unrelated schema), and entities/ (unrelated
// schema too). Parsing found poi/entities chunks harmlessly return null
// (their NBT has no Heightmaps at all), but it's still 2-3x wasted
// decompression work for data that can never contribute anything. Prefer
// files whose relative path says "region" when that information is
// available (folder picker/drop), falling back to the plain extension
// filter for loose files that were selected directly (no path to go on).
function filterMcaFiles(files) {
	const mca = files.filter((f) => f.name.toLowerCase().endsWith(".mca"));
	const relPath = (f) => f.webkitRelativePath || f.__mcaRelativePath || "";
	const withPath = mca.filter((f) => relPath(f));
	if (withPath.length === 0) return mca; // loose files, no path info to prefer by
	const inRegionFolder = withPath.filter((f) => relPath(f).toLowerCase().split("/").includes("region"));
	return inRegionFolder.length > 0 ? inRegionFolder : mca;
}

// Reads every file out of a dropped FileSystemDirectoryEntry, recursing
// into subfolders (so dropping the whole world save folder, not just
// region/, still finds the .mca files). readEntries() doesn't necessarily
// return everything in one call for a large directory - the spec requires
// calling it repeatedly until it returns an empty array.
function readAllDirectoryEntries(reader) {
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

// File.webkitRelativePath is only reliably populated by <input
// webkitdirectory> - files obtained via the drag-and-drop FileSystemEntry
// API (what a dropped folder uses) don't get it set by the browser, so
// filterMcaFiles()'s path-based region/-vs-poi/-vs-entities/ preference
// would silently fall back to "no path info" for every dropped folder.
// FileSystemEntry.fullPath IS reliable for both, so stash it under our own
// property (webkitRelativePath is normally getter-only in browsers that DO
// set it, so overwriting it directly risks a silent no-op or throw in
// strict mode - a separate property sidesteps that entirely).
async function collectFilesFromEntry(entry, out) {
	if (entry.isFile) {
		const file = await entryToFile(entry);
		file.__mcaRelativePath = entry.fullPath;
		out.push(file);
	} else if (entry.isDirectory) {
		const children = await readAllDirectoryEntries(entry.createReader());
		for (const child of children) await collectFilesFromEntry(child, out);
	}
}

// ---------- rendering ----------

const NO_HEIGHT = -32768; // sentinel for "no data" in the Int16Array grid (real heights never go this low)
// A real explored-but-sparse world save can legitimately span a large
// bounding box (players explore outward from spawn, region files end up
// scattered) without the actual DATA being anywhere near that dense - a
// single per-axis cap conflates "far apart" with "too much memory",
// rejecting perfectly renderable elongated/sparse worlds. Two separate caps
// instead: a total-block-count budget (what actually drives memory use) and
// a generous per-axis cap (just to stay under browsers' real canvas
// dimension ceilings, not a memory proxy).
const MAX_GRID_BLOCKS = 60_000_000; // total blocks in the bounding box - ~230MB across all grids + canvas at this size, comfortable in any modern browser tab
const MAX_GRID_DIMENSION = 16384; // blocks per axis - well under Chrome's ~32767 and Safari's ~16384 canvas dimension limits

const TOO_FAR_APART_MESSAGE = (w, h) =>
	`These files are too far apart to render together (they'd span ${w}×${h} blocks) - ` +
	`the map would have to cover the whole gap between them, not just the parts you actually have data for. ` +
	`Upload region files that are next to each other (adjacent r.X.Z.mca coordinates) instead.`;

// Cheap upfront check using just the filenames (region coordinates are right
// there in "r.X.Z.mca") before spending any time decompressing and parsing
// chunks that would only end up discarded anyway - the real per-block grid-
// size check in buildTerrainImage() still applies too (this one can only
// catch files whose names parse; a bad filename just falls through to
// buildTerrainImage()'s normal per-file error handling).
function checkFileSpan(files) {
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

// hashColor() returns an hsl() string for anything outside the curated
// BIOME_COLORS table - resolve it to RGB once per distinct biome (via an
// offscreen 1x1 canvas, the simplest reliable way to get the browser's own
// hsl->rgb conversion) rather than reimplementing hsl conversion by hand.
const biomeRgbCache = new Map();
let rgbProbeCtx = null;
function rgbForBiome(name) {
	let rgb = biomeRgbCache.get(name);
	if (rgb) return rgb;
	if (!rgbProbeCtx) rgbProbeCtx = document.createElement("canvas").getContext("2d");
	rgbProbeCtx.fillStyle = colorForBiome(name);
	rgbProbeCtx.fillRect(0, 0, 1, 1);
	rgb = [...rgbProbeCtx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
	biomeRgbCache.set(name, rgb);
	return rgb;
}

// The full pipeline: parse every file, assemble a flat per-block grid over
// their combined bounding box, and paint it into a fresh canvas (biome
// color, hillshade, contour lines, tree/water detail - see the inline
// comments below for why each exists). Returns either
// { ok: true, canvas, gridW, gridH, minCx, minCz, biomesSeen, totalChunks,
//   fileErrors, biomeAt(worldX, worldZ) }
// or { ok: false, message } for "no data" / "too far apart" cases.
// biomeAt() is handed back so a caller (e.g. app.js's tooltip) can look up
// what's under a given world block coordinate without re-deriving the grid
// indexing math itself.
//
// onStatus(text) is called with human-readable progress messages as parsing
// proceeds (e.g. "Parsing r.0.0.mca…") - purely cosmetic, safe to omit.
async function buildTerrainImage(files, { onStatus, isStale } = {}) {
	const spanCheck = checkFileSpan(files);
	if (!spanCheck.ok) return { ok: false, message: spanCheck.message };

	onStatus?.(`Parsing ${files.length} region file${files.length === 1 ? "" : "s"}…`);

	const chunkSurfaces = new Map(); // "cx,cz" -> { heights[256], biomes[256], isWater[256], isTree[256] }
	let minCx = Infinity, maxCx = -Infinity, minCz = Infinity, maxCz = -Infinity;
	let totalChunks = 0;
	const biomesSeen = new Set();
	const fileErrors = []; // one bad file (e.g. wrong size/name) shouldn't discard results from the rest of the batch

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

	// Assemble a flat per-block grid across the whole loaded area so contour
	// lines can compare a block against its neighbor even when that
	// neighbor is in a different chunk (or a different uploaded file). This
	// grid spans the full bounding box of every uploaded chunk, INCLUDING
	// the gap between them - fine for one build site (the normal case), but
	// a real explored-but-sparse world save can span a much larger bounding
	// box while only sparsely filling it. Two things keep that affordable:
	// capping on total block COUNT (below) rather than a single per-axis
	// distance, so a large-but-not-enormous bounding box like a widely-
	// explored world still fits; and interning biome names to small
	// integers just below (a plain Array of string references runs 8+
	// bytes/block plus per-string overhead at this scale - a typed array is
	// 2 bytes/block).
	const gridW = (maxCx - minCx + 1) * 16;
	const gridH = (maxCz - minCz + 1) * 16;
	if (gridW > MAX_GRID_DIMENSION || gridH > MAX_GRID_DIMENSION || gridW * gridH > MAX_GRID_BLOCKS) {
		return { ok: false, message: TOO_FAR_APART_MESSAGE(gridW, gridH) };
	}
	const heightGrid = new Int16Array(gridW * gridH).fill(NO_HEIGHT);
	// Separate from heightGrid specifically for hillshade/contour input (see
	// the MOTION_BLOCKING_NO_LEAVES comment in extractChunkSurface) - kept
	// as its own array rather than overwriting heightGrid because
	// heightGrid's actual surface height (tooltip Y, "is there data" gate)
	// is still the right thing to show/gate on elsewhere.
	const shadeHeightGrid = new Int16Array(gridW * gridH).fill(NO_HEIGHT);
	const biomeGrid = new Uint16Array(gridW * gridH); // 0 = no biome; real biome names interned starting at 1
	const biomeNames = [null]; // index 0 reserved for "no biome"
	const biomeIds = new Map();
	function internBiome(name) {
		let id = biomeIds.get(name);
		if (id === undefined) {
			id = biomeNames.length;
			biomeNames.push(name);
			biomeIds.set(name, id);
		}
		return id;
	}
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

	const canvas = document.createElement("canvas");
	canvas.width = gridW;
	canvas.height = gridH;
	const ctx = canvas.getContext("2d");
	const imageData = ctx.createImageData(gridW, gridH);
	const pixels = imageData.data;

	// Single pass: biome color, per-block relief shading (see below), tree
	// canopy darkening, and water/bank-fallback color - matching the relief
	// look of the reference (mcseedmap.net, itself matching vanilla
	// Minecraft's own map item shading) rather than a flat per-chunk color.
	for (let gz = 0; gz < gridH; gz++) {
		for (let gx = 0; gx < gridW; gx++) {
			const idx = gz * gridW + gx;
			const h = heightGrid[idx];
			const dstBase = idx * 4;
			if (h === NO_HEIGHT) {
				pixels[dstBase + 3] = 0; // transparent - no data for this block
				continue;
			}
			const biome = biomeNames[biomeGrid[idx]];
			const useBankFallback = biome && WATER_BIOME_NAMES.has(biome) && !waterGrid[idx];
			let [r, g, b] = useBankFallback
				? rgbForBiome(BANK_FALLBACK_BIOME)
				: biome
					? rgbForBiome(biome)
					: [128, 128, 128];

			// Biomes only carry 4x4-block resolution, so on their own a forest
			// biome reads as one flat color with no way to tell "under a
			// tree" from "in a clearing" - darkening canopy blocks (real
			// per-block data, from the same surface-block lookup used for
			// water) makes individual tree clusters show up as distinct
			// darker blobs against open ground, the way chunkbase/mcseedmap
			// render them, instead of a uniform biome-colored wash.
			if (treeGrid[idx]) {
				r *= 0.62;
				g *= 0.7;
				b *= 0.62;
			}

			// Relief shading - the same technique vanilla Minecraft's own map
			// item uses, and what the mcseedmap.net reference actually does:
			// NOT a smoothed hillshade gradient or discrete contour lines,
			// just a per-block comparison against ONE neighbor (south, +z),
			// picking one of three flat tones. Downhill-to-the-south reads
			// dark, uphill-to-the-south reads light, flat stays as-is. Applied
			// at full per-block resolution with no averaging, this is what
			// produces that crisp "one side of every bump is light, the other
			// is dark" pixelated relief look instead of smooth shading or a
			// topo map's isolines. Reads shadeHeightGrid (ground height, no
			// tree canopy - see the MOTION_BLOCKING_NO_LEAVES comment in
			// extractChunkSurface), not heightGrid, so canopy bumps don't
			// inject fake relief.
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

			pixels[dstBase] = r;
			pixels[dstBase + 1] = g;
			pixels[dstBase + 2] = b;
			pixels[dstBase + 3] = 255;
		}
	}
	ctx.putImageData(imageData, 0, 0);

	function biomeAt(worldX, worldZ) {
		const gx = worldX - minCx * 16;
		const gz = worldZ - minCz * 16;
		if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridH) return null;
		const idx = gz * gridW + gx;
		const h = heightGrid[idx];
		if (h === NO_HEIGHT) return null;
		return { biome: biomeNames[biomeGrid[idx]], height: h };
	}

	return { ok: true, canvas, gridW, gridH, minCx, minCz, biomesSeen, totalChunks, fileErrors, biomeAt };
}

window.WorldTerrain = {
	BIOME_COLORS,
	colorForBiome,
	hashColor,
	formatBiomeName,
	escapeHtml,
	parseRegionFilename,
	parseRegionFile,
	filterMcaFiles,
	readAllDirectoryEntries,
	collectFilesFromEntry,
	checkFileSpan,
	buildTerrainImage,
	MAX_GRID_BLOCKS,
	MAX_GRID_DIMENSION,
};

})();
