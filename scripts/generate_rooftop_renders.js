// Rooftop render data generator — reads real MineColonies .blueprint files
// and produces a per-block top-down grid (block icon, shape, connections,
// relief-shading data) for each building listed in TARGETS below. The
// browser-side renderer (lib/rooftop-render.js) turns that grid into an actual
// canvas image; this script only produces the data.
//
// It also records where each building's hut block sits in its blueprint
// (the `huts` field on each shape in styles/*.json: { size_x, size_z,
// blocks: [{ x, z }] }, in the blueprint's own unrotated frame), which the
// Plan Check measures home-to-work distances from.
//
// Run with: node scripts/generate_rooftop_renders.js
// Requires a local checkout of the MineColonies mod source (for its
// .blueprint files, which aren't part of this repo) — point MOD_SRC at it
// via the MINECOLONIES_MOD_SRC env var, or let it default to a sibling
// "minecolonies" checkout next to this repo.
//
// Every rule below (fence/wall connections, door labeling, stair/shingle
// facing, trapdoor/ladder/button edge-hugging, tile-entity retexturing,
// transparent-full-block underlays) was checked against real blueprint data.
// It parses blueprints with the same hardened NBT reader the site uses
// (lib/nbt.js).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const NBT = require("../lib/nbt.js");
const { getSubcategory } = require("../planner/catalog.js");

const REPO_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "rooftop-data");

const MOD_SRC =
	process.env.MINECOLONIES_MOD_SRC ||
	path.join(REPO_ROOT, "..", "minecolonies");
const MOD_BLUEPRINTS = path.join(MOD_SRC, "src/main/resources/blueprints/minecolonies");

if (!fs.existsSync(MOD_BLUEPRINTS)) {
	console.error(
		`Can't find MineColonies mod blueprints at ${MOD_BLUEPRINTS}\n` +
			`Set MINECOLONIES_MOD_SRC to a local checkout of the mod source ` +
			`(the .blueprint files aren't part of this repo), e.g.:\n` +
			`  MINECOLONIES_MOD_SRC=~/path/to/minecolonies node scripts/generate_rooftop_renders.js`,
	);
	process.exit(1);
}

const materialIconsPath = path.join(REPO_ROOT, "images/material-icons.json");
const materialIcons = JSON.parse(fs.readFileSync(materialIconsPath, "utf8"));
const DIRT_ICON = materialIcons["minecraft:dirt"];
// Not a real block ID - just the extracted vanilla side texture, used
// specifically as the composter's own underlay fill (see isTransparentFullBlock)
// instead of whatever real block happens to be underneath it.
const COMPOSTER_SIDE_ICON = "images/materials/minecraft_block_composter_side.png";

const PLACEHOLDERS = new Set([
	"minecraft:air",
	"structurize:blocksolidsubstitution",
	"structurize:blocksubstitution",
	"structurize:blocktagsubstitution",
	"structurize:blockfluidsubstitution",
]);

// Banners have no static texture anywhere in the game's files (entity-
// rendered) and are thin/wall-mounted rather than a real occupying object —
// simplest is to just not "see" them at all, same as air, rather than trying
// to represent them.
function isIgnored(name) {
	return PLACEHOLDERS.has(name) || name.endsWith("_banner");
}

// Domum Ornamentum "shingle" shapes are procedural multi-texture volumes —
// their block-state Name alone doesn't tell you the roof color, that's
// stored per-instance in the tile entity's textureData, keyed by which
// *default* vanilla texture each model's texture variable was authored
// against. Confirmed by inspecting the shape's own model JSON (e.g.
// assets/domum_ornamentum/models/block/shingle/straight_spec.json): the
// "shingle" family declares {"1": "block/clay", "plank": "block/oak_planks"}
// and texture variable "1" covers 12/13 of the model's up-facing quads (the
// visible roof surface), so "minecraft:block/clay" is the textureData key
// holding the actual applied shingle color. shingle_slab's model instead
// defaults its up-facing variable to "block/oak_planks" (28/28 up quads).
const SHINGLE_TEXTURE_KEY = {
	"domum_ornamentum:shingle": "minecraft:block/clay",
	"domum_ornamentum:shingle_flat": "minecraft:block/clay",
	"domum_ornamentum:shingle_flat_lower": "minecraft:block/clay",
	"domum_ornamentum:shingle_slab": "minecraft:block/oak_planks",
};

function loadBlueprint(f) {
	const raw = fs.readFileSync(f);
	const buf = zlib.gunzipSync(raw);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	return NBT.parseNbtBuffer(ab).value;
}

// Each packed Int32 holds two voxels' palette indices: HIGH 16 bits is the
// first voxel, LOW 16 bits is the second (confirmed empirically — cross
// referenced against tile-entity x/y/z ground truth in the same blueprint,
// 66/66 exact matches; the reverse ordering and every other axis-nesting
// hypothesis all scored near zero).
function unpackIndices(v) {
	const total = v.size_x * v.size_y * v.size_z;
	const idx = new Uint16Array(total);
	let i = 0;
	for (const b of v.blocks) {
		idx[i++] = (b >>> 16) & 0xffff;
		if (i < total) idx[i++] = b & 0xffff;
	}
	return idx;
}

// Partial blocks drawn with a silhouette in top-down renders. Every one of
// them leaves part of the column visible underneath, so the list doubles as
// the "needs an underlay" set below. (Related to, but not the same as, the
// cost panel's list in planner/materials.js: stairs and slabs fill their
// whole cell from above, so they aren't here.)
const SHAPE_SUFFIXES = [
	["_fence_gate", "fence"],
	["_fence", "fence"],
	["_wall", "wall"],
	["_pressure_plate", "plate"],
	["_button", "button"],
];

// Exact-name shapes (not a suffix family) that also don't fill the block.
// Bare flowers (not potted - see SHAPE_PREFIXES below) were missing here
// entirely, same cross-sprite-on-transparent-margin texture as grass/fern but
// with no shape assigned, so getShape() returned null, the underlay-search
// loop never ran, and the renderer drew the flower's icon with nothing behind
// it - its own transparent margins revealed empty canvas instead of the
// ground block. Confirmed against real blueprint data: dandelion, poppy,
// azure_bluet, blue_orchid, lily_of_the_valley, oxeye_daisy, and pink_tulip
// all appeared with shape: null. Every single- and double-tall flower plus
// the empty flower_pot prop (same not-a-full-block issue) is listed here now.
const SHAPE_EXACT = {
	lantern: "lantern",
	soul_lantern: "lantern",
	blockbarreldeco_standing: "barrel",
	blockbarreldeco_onside: "barrel",
	grass: "plant",
	fern: "plant",
	tall_grass: "plant",
	large_fern: "plant",
	dead_bush: "plant",
	flower_pot: "plant",
	dandelion: "plant",
	poppy: "plant",
	blue_orchid: "plant",
	allium: "plant",
	azure_bluet: "plant",
	red_tulip: "plant",
	orange_tulip: "plant",
	white_tulip: "plant",
	pink_tulip: "plant",
	oxeye_daisy: "plant",
	cornflower: "plant",
	lily_of_the_valley: "plant",
	wither_rose: "plant",
	torchflower: "plant",
	sunflower: "plant",
	lilac: "plant",
	rose_bush: "plant",
	peony: "plant",
	pitcher_plant: "plant",
	// Only a "_side" texture exists for this in our icon set (no top-down
	// face), so drawn full-square it just reads as a flat grey tile with no
	// indication it's a distinct mounted object. Reusing the "lantern" inset
	// treatment (small centered square + underlay showing through around it)
	// at least makes it read as "a thing sitting on the floor" rather than
	// a weird solid patch, same problem/fix as the flowers above.
	grindstone: "lantern",
};

// Every stair blockstate carries a "facing" property (confirmed against the
// raw palette data). Standard Minecraft world axes: +x = east, +z = south —
// blueprints preserve that orientation as-captured, and our grid iterates z
// as rows (top-to-bottom = north-to-south) and x as columns (left-to-right =
// west-to-east), so facing maps directly onto which half of the cell to
// darken, no rotation needed.
// Darken the LOW side of the stair, not the side named by "facing" — a
// stair's "facing" is the direction of its riser/tall face (where you'd
// stand to walk up into it), so the low/open step is on the opposite side.
const FACING_TO_DARKEN_SIDE = {
	north: "bottom",
	south: "top",
	east: "left",
	west: "right",
};

// Domum Ornamentum's shingle family (roof surfaces) uses the exact same
// stair-style blockstate shape — confirmed against the raw palette data,
// e.g. {"half":"bottom","shape":"straight","facing":"south"} — so the same
// darkening logic applies directly.
function hasStairLikeFacing(name) {
	return name.endsWith("_stairs") || name in SHINGLE_TEXTURE_KEY;
}

function getFacingDarkenSide(paletteEntry) {
	if (!hasStairLikeFacing(paletteEntry.Name)) return null;
	const facing = paletteEntry.Properties?.facing;
	return FACING_TO_DARKEN_SIDE[facing] || null;
}

// A closed trapdoor lies flat (top or bottom half of the block) so its
// existing full-square render is already correct. An OPEN trapdoor rotates
// upright and becomes a thin vertical panel flush against whichever
// neighboring block it's hinged/attached to - viewed from directly above
// that's a sliver along one edge of the cell (the edge TOUCHING that
// support), not a flat square, and it should reveal whatever's on the floor
// around it. The first version pointed "facing" straight at its same-named
// edge (north -> top) on the assumption "facing" names the face the panel
// ends up covering; confirmed visually wrong - the panel rendered floating
// on the edge AWAY from its support instead of flush against it. "facing"
// actually names the direction the player was standing when they placed it
// (away from the support), the opposite of the edge the panel should hug -
// same inversion FACING_TO_DARKEN_SIDE above already needs for a stair's low
// step, just for a different reason.
// Shared with wall-mounted buttons below - confirmed against real blueprint
// data (cook5/blacksmith5/residence5: every wall button's neighbor on the
// OPPOSITE side of its "facing" was a solid block, its mounting log/wall)
// that a button's "facing" carries the exact same "away from support"
// meaning, not a coincidence - both are "which way were you facing when you
// placed this against a wall" style properties.
const SUPPORT_FACING_TO_EDGE = {
	north: "bottom",
	south: "top",
	east: "left",
	west: "right",
};

// Domum Ornamentum's "panel" block (four cosmetic "type" variants - full,
// waffle, vertically_striped, horizontal_bars - confirmed against real
// blueprint data, all four appear) is a reskinned trapdoor under the hood:
// identical half/facing/open/waterlogged property set, and the same "facing
// points away from the support" convention verified directly (a facing=west
// open panel's solid neighbor was consistently to the east). Same bug,
// same fix, same edge mapping - it just isn't spelled "_trapdoor".
function isTrapdoorLike(name) {
	return name.endsWith("_trapdoor") || name === "domum_ornamentum:panel";
}

function getOpenTrapdoorEdge(paletteEntry) {
	// A ladder has no open/closed state at all - it's always a thin panel
	// mounted flush against whatever it's climbing, permanently "open" in
	// the trapdoor sense. Confirmed the same "facing points away from the
	// support" convention applies (facing=east had a solid west neighbor,
	// facing=south had a solid north neighbor, both in real blueprint
	// data), so it reuses this exact edge-hugging path unconditionally,
	// no open-property gate needed.
	if (paletteEntry.Name === "minecraft:ladder") {
		return SUPPORT_FACING_TO_EDGE[paletteEntry.Properties?.facing] || null;
	}
	if (!isTrapdoorLike(paletteEntry.Name)) return null;
	const props = paletteEntry.Properties || {};
	if (props.open !== "true") return null;
	return SUPPORT_FACING_TO_EDGE[props.facing] || null;
}

// A floor or ceiling button really does sit centered on/under its block -
// the existing small inset square is correct there. Only a WALL button is
// mounted sideways, protruding from a neighboring block's face rather than
// resting on the block below it at all - rendered as the same centered
// square, it reads as floating in the middle of its cell for no reason
// instead of sitting flush against the wall it's actually attached to.
function getWallButtonEdge(paletteEntry) {
	if (!paletteEntry.Name.endsWith("_button")) return null;
	const props = paletteEntry.Properties || {};
	if (props.face !== "wall") return null;
	return SUPPORT_FACING_TO_EDGE[props.facing] || null;
}

// Fences don't have a single "facing" — they carry four independent
// connection booleans (does this segment visually connect toward each
// neighbor). Default the icon to vertical (connects north/south, or an
// isolated post) and only rotate to horizontal when it connects east/west
// but NOT north/south, matching how the piece actually reads in-world.
// Returns which of the 4 neighbors this fence segment actually connects to.
// Drawing a rail toward each true direction (see buildPostPath in
// lib/rooftop-render.js) handles straight/corner/T/cross/stub/isolated-post
// shapes all from the same data, with no need to special-case each pattern —
// a corner is just "2 adjacent directions," a plus is "all 4," etc.
//
// Fence GATES are a different blockstate shape entirely - they carry
// "facing"/"open"/"in_wall"/"powered", no north/south/east/west booleans at
// all, so reading those the same way as a plain fence silently returns
// all-false (a gate that never draws a rail, even though it's sitting in the
// middle of an otherwise-connected fence line - confirmed against real
// blueprint data, every fence_gate palette entry has zero of the boolean
// properties). A gate's rails run perpendicular to its facing (the fence
// line it's set into runs sideways to the direction you walk through it).
function getFenceConnections(paletteEntry) {
	const props = paletteEntry.Properties || {};
	if (paletteEntry.Name.endsWith("_fence_gate")) {
		// facing north/south -> you walk through it north-south -> the fence
		// line it's set into runs east-west, so it connects east+west (and
		// vice versa).
		if (props.facing === "north" || props.facing === "south") {
			return { north: false, south: false, east: true, west: true };
		}
		return { north: true, south: true, east: false, west: false };
	}
	return {
		north: props.north === "true",
		south: props.south === "true",
		east: props.east === "true",
		west: props.west === "true",
	};
}

// Walls carry the same idea as fences - four independent per-direction
// connections instead of one "facing" - but a different value shape: each of
// north/south/east/west is "none"/"low"/"tall" rather than a boolean (a wall
// segment can rise higher against a taller neighbor), plus an "up" boolean
// for whether the center post nub is present (true for anything but a bare
// straight 2-opposite-connection run). The low/tall distinction is a 3D
// height detail with no top-down equivalent, so for this renderer only
// "connected at all" (anything but "none") matters - same
// straight/corner/T/cross/stub/isolated-post coverage buildFencePath already
// gets from one boolean per direction.
function getWallConnections(paletteEntry) {
	const props = paletteEntry.Properties || {};
	return {
		north: props.north !== undefined && props.north !== "none",
		south: props.south !== undefined && props.south !== "none",
		east: props.east !== undefined && props.east !== "none",
		west: props.west !== undefined && props.west !== "none",
	};
}

// Minecraft has ~29 "potted_X" variants (saplings, flowers, fungi, cacti...)
// — all small flowerpot props with the exact same "not a full block" problem
// grass/fern had, so a prefix rule catches the whole family in one line
// instead of enumerating each one.
const SHAPE_PREFIXES = [["potted_", "plant"]];

function getShape(blockName) {
	const name = blockName.includes(":") ? blockName.slice(blockName.indexOf(":") + 1) : blockName;
	if (SHAPE_EXACT[name]) return SHAPE_EXACT[name];
	for (const [suffix, shape] of SHAPE_SUFFIXES) {
		if (name.endsWith(suffix)) return shape;
	}
	for (const [prefix, shape] of SHAPE_PREFIXES) {
		if (name.startsWith(prefix)) return shape;
	}
	return null;
}

// A full cube geometrically, but its own texture is substantially
// transparent (a composter's open top, glass) - same underlying problem as
// a fence or plant (whatever's really visible in this cell is mostly what's
// BEHIND the drawn icon, not the icon itself) even though it isn't a
// special "shape" in the clip-path sense. Confirmed against altfarmer5
// (Caledonia): a glass greenhouse roof rendered as blank/near-black squares
// because no underlay was ever computed for it (shape stays null for a
// full block), hiding whatever's below entirely. Same for composter5's own
// composter blocks - the open-top texture is ~56% transparent pixels.
// Tagged with its own "transparent" shape (rather than reusing "plant" or
// leaving shape null) purely so the existing "if (shape) computeUnderlay"
// and "if (cell.shape && cell.underlayIcon) drawUnderlay" gates both pick
// it up automatically - buildShapePath has no special case for it and
// falls through to the plain full-square rect, which is correct: unlike a
// fence post, this thing really does occupy the whole cell, it just isn't
// opaque while doing it.
function isTransparentFullBlock(name) {
	return (
		name === "minecraft:glass" ||
		name === "minecraft:tinted_glass" ||
		name.endsWith("_stained_glass") ||
		name === "minecraft:composter" ||
		// Fire's flame shape only covers a fraction of the cell - most of
		// it is real (0,0,0,0) transparency, not just a lightly-tinted
		// texture - so without an underlay the floor around the flame
		// disappears into blank space the same way glass and composter did.
		name === "minecraft:fire"
	);
}

// Ravel order is y-slowest, then z, then x-fastest: index = (y*size_z + z)*size_x + x.
// Takes a loaded blueprint, optionally with its voxel indices already
// unpacked (composite blueprints are built voxel-by-voxel, never packed).
function topDownGrid(v, idx = unpackIndices(v)) {
	const { size_x: sx, size_y: sy, size_z: sz } = v;

	const teByPos = new Map();
	for (const te of v.tile_entities || []) {
		if (te.x == null || te.textureData == null) continue;
		teByPos.set(`${te.x},${te.y},${te.z}`, te);
	}

	let retexturedHits = 0;
	// Resolves the block at (x,y,z) to {name, icon}, applying the same
	// tile-entity/shingle retexturing used for the primary (topmost) block —
	// the block revealed underneath a fence/lantern/etc. can just as easily
	// be a retextured Domum Ornamentum shape as the primary one is.
	function resolveAt(x, y, z, name) {
		let resolvedName = name;
		const te = teByPos.get(`${x},${y},${z}`);
		if (te) {
			const shingleKey = SHINGLE_TEXTURE_KEY[name];
			const preferredTexture = shingleKey
				? te.textureData[shingleKey]
				: Object.values(te.textureData)[0];
			if (preferredTexture && materialIcons[preferredTexture]) {
				resolvedName = preferredTexture;
				retexturedHits++;
			}
		}
		return { name, icon: materialIcons[resolvedName] || null };
	}

	// Small decorations are routinely perched directly on top of a fence OR
	// wall post in these builds - a survey of every fence/wall block across
	// the whole style found lanterns (97), torches (168+47 wall), chains
	// (14), and iron bars (15) sitting on a fence, and a separate survey
	// across all 19 blueprints used for the Rooftop Renders artifact found
	// 47 more sitting on a plain WALL specifically (more common than the
	// fence case), alongside much more common structural stacking
	// (stairs/slabs/logs/planks forming a floor/roof the post merely
	// supports as a stilt - 500-1000+ instances each). The two cases need
	// opposite treatment: a floor/roof genuinely should hide the post from
	// directly overhead (nothing to connect - it's covered), but a
	// torch/lantern/chain/bars is thin, ornamental, and was clearly never
	// meant to erase the post it's decorating. Without this distinction, the
	// topmost block - being the ONLY block this grid keeps per column -
	// silently becomes the cell's entire identity, discarding the fence's or
	// wall's name/shape/connections outright (confirmed against tavern3: a
	// real fence corner at y=9 vanished because a lantern sat on it at
	// y=10). Composite the ornamental cases instead: the fence/wall becomes
	// the cell's primary shape, and the decoration renders as an overlay on
	// top of it, same as it would standing alone.
	// "plant" belongs here too - confirmed against barracks5 (Caledonia): a
	// bare flower_pot sitting on a stone_brick_wall post. Without this, the
	// pot (not recognized as a topper) became the cell's WHOLE identity and
	// the wall underneath it was demoted to underlay - drawn as a flat,
	// unclipped full-square background instead of its own connected
	// post+arms shape, discarding the wall's silhouette entirely right where
	// it happened to have a pot on it (same class of bug the lantern/torch
	// case above was written to prevent, just missed for plants at the
	// time).
	const TOPPER_SHAPES = new Set(["lantern", "plate", "button", "plant"]);
	const TOPPER_NAMES = new Set([
		"minecraft:torch",
		"minecraft:wall_torch",
		"minecraft:soul_torch",
		"minecraft:soul_wall_torch",
		"minecraft:chain",
		"minecraft:iron_bars",
	]);
	function isTopperOnPost(name, shape) {
		return TOPPER_SHAPES.has(shape) || TOPPER_NAMES.has(name);
	}

	// Exterior-vs-interior door classification: a 6-connected flood fill
	// through open air, seeded from a synthetic "sky" layer one block above
	// the tallest point plus a 1-cell shell around the whole footprint, so
	// every square of open air actually connected to the outside world ends
	// up in `exterior`. A door (any name ending in "_door") is never itself
	// passable here, same as every other real block - it's exactly the
	// barrier we want the fill to stop at, so interior rooms don't leak
	// into the "reached from outside" set through their own doorways. Once
	// the fill is done, a door is an exterior/entrance door if the open-air
	// cell on (at least) one of its two threshold sides was reached; if
	// neither side was reached, both sides are enclosed rooms and it's an
	// interior door. Whole-block granularity, not per-block collision
	// shapes - a fence or wall blocks the fill exactly like a solid block
	// does, which is a reasonable stand-in for "does a person passing
	// through here read this as inside or outside," not a perfect physics
	// simulation.
	function isPassable(x, y, z) {
		if (y < 0) return false;
		if (y >= sy) return true;
		if (x < 0 || x >= sx || z < 0 || z >= sz) return true;
		const i = (y * sz + z) * sx + x;
		return isIgnored(v.palette[idx[i]].Name);
	}
	const exterior = new Set();
	{
		const key = (x, y, z) => `${x},${y},${z}`;
		const queue = [];
		for (let x = -1; x <= sx; x++) {
			for (let z = -1; z <= sz; z++) {
				const k = key(x, sy, z);
				exterior.add(k);
				queue.push([x, sy, z]);
			}
		}
		const DIRS = [
			[1, 0, 0],
			[-1, 0, 0],
			[0, 1, 0],
			[0, -1, 0],
			[0, 0, 1],
			[0, 0, -1],
		];
		while (queue.length) {
			const [cx, cy, cz] = queue.pop();
			for (const [dx, dy, dz] of DIRS) {
				const nx = cx + dx, ny = cy + dy, nz = cz + dz;
				if (ny < -1 || ny > sy) continue;
				if (nx < -1 || nx > sx || nz < -1 || nz > sz) continue;
				const nk = key(nx, ny, nz);
				if (exterior.has(nk)) continue;
				if (!isPassable(nx, ny, nz)) continue;
				exterior.add(nk);
				queue.push([nx, ny, nz]);
			}
		}
	}

	const grid = [];
	for (let z = 0; z < sz; z++) {
		const row = [];
		for (let x = 0; x < sx; x++) {
			let cell = null;
			for (let y = sy - 1; y >= 0; y--) {
				const i = (y * sz + z) * sx + x;
				const name = v.palette[idx[i]].Name;
				if (isIgnored(name)) continue;

				const resolved = resolveAt(x, y, z, name);
				let shape = getShape(name) || (isTransparentFullBlock(name) ? "transparent" : null);
				let facingDarken = getFacingDarkenSide(v.palette[idx[i]]);
				let fenceConnections = shape === "fence" ? getFenceConnections(v.palette[idx[i]]) : null;
				let wallConnections = shape === "wall" ? getWallConnections(v.palette[idx[i]]) : null;
				let cellName = name;
				let cellIcon = resolved.icon;
				let topper = null;
				let effectiveY = y;

				const doorEdge = getOpenTrapdoorEdge(v.palette[idx[i]]);
				if (doorEdge) shape = "trapdoor_open";
				const buttonEdge = getWallButtonEdge(v.palette[idx[i]]);

				if (isTopperOnPost(name, shape) && y > 0) {
					const belowI = ((y - 1) * sz + z) * sx + x;
					const belowName = v.palette[idx[belowI]].Name;
					const belowShape = isIgnored(belowName) ? null : getShape(belowName);
					if (belowShape === "fence" || belowShape === "wall") {
						const belowResolved = resolveAt(x, y - 1, z, belowName);
						topper = { icon: cellIcon };
						cellName = belowName;
						cellIcon = belowResolved.icon;
						shape = belowShape;
						fenceConnections = belowShape === "fence" ? getFenceConnections(v.palette[idx[belowI]]) : null;
						wallConnections = belowShape === "wall" ? getWallConnections(v.palette[idx[belowI]]) : null;
						facingDarken = null;
						effectiveY = y - 1;
					}
				}

				// The column's real world height (the topmost resolved block's
				// Y) - kept separately from any "which half of the icon do I
				// darken" facing logic, purely so the renderer can compare
				// neighboring columns and shade one side of a step/ledge
				// light and the other dark, the same per-block relief
				// technique used for World Viewer's terrain (see
				// lib/world-terrain.js) rather than anything World Viewer-specific.
				cell = { name: cellName, icon: cellIcon, shape, facingDarken, fenceConnections, wallConnections, topper, y: effectiveY };
				if (shape === "fence") cell.fenceY = effectiveY;
				if (shape === "wall") cell.wallY = effectiveY;
				if (shape === "trapdoor_open") cell.doorEdge = doorEdge;
				if (shape === "button" && buttonEdge) cell.buttonEdge = buttonEdge;

				if (shape) {
					for (let uy = effectiveY - 1; uy >= 0; uy--) {
						const ui = (uy * sz + z) * sx + x;
						const underName = v.palette[idx[ui]].Name;
						if (isIgnored(underName)) continue;
						// Some decorative props (the barrel deco block, at
						// least) occupy two stacked voxels of the same
						// block — without this, the "underlay" search hits
						// the prop's own second voxel and treats it as
						// ground. Only skip a duplicate of the SAME block,
						// though: skipping every shaped block here (the
						// previous approach) meant a barrel sitting under a
						// (thin, unresolved) wall banner got skipped right
						// past too, hiding a real object that should still
						// show through the banner's empty column.
						// A "plant" is a narrower case worth skipping anyway:
						// confirmed against cook5 (Caledonia) - a wall-mounted
						// button (face=wall, floating in air with nothing
						// really below it in its own column) landed on a
						// lily_of_the_valley two blocks down as its "ground"
						// purely because it was the nearest non-air thing,
						// even though the flower has nothing to do with the
						// button - it's own thin ground-cover sitting on the
						// REAL ground one further block down. A flower is
						// never legitimate ground for anything else to be
						// standing on, so keep searching past it instead of
						// drawing it as a full-cell backdrop (which mostly
						// shows as blank space anyway, given how much of a
						// flower sprite is transparent margin).
						if (underName === cellName) continue;
						if (getShape(underName) === "plant") continue;
						// Same reasoning, different shape of problem:
						// confirmed against graveyard5 (Caledonia) - a ladder
						// several blocks below a high panel/hatch got picked
						// as that panel's underlay and rendered as a full,
						// UNCLIPPED square, but a ladder's own texture has
						// real gaps between the rungs (same as a flower's
						// transparent margins), so most of that square came
						// out blank instead of reading as "there's a ladder
						// down there." An open trapdoor/panel has the same
						// issue for the same reason. Keep searching past any
						// of these for the same real, opaque ground a plant
						// search would land on.
						if (getOpenTrapdoorEdge(v.palette[idx[ui]])) continue;
						cell.underlayIcon = resolveAt(x, uy, z, underName).icon;
						// Kept separately from cell.y for the renderer's relief
						// shading: a fence/plant/wall/etc. is thin enough that
						// the underlay is what's actually visible across most
						// of the cell, so the height cue should track THIS
						// (the real ground the neighbor comparison should
						// read against), not the decoration's own often-taller
						// position. Left unset on the dirt-fallback path below
						// (a floating decoration with nothing real underneath
						// has no meaningful ground height to compare against).
						cell.underlayY = uy;
						break;
					}
					// Nothing real found below (floating decoration, or it's
					// sitting right on the ground with nothing but air/void
					// beneath) — fall back to plain dirt rather than leaving
					// it transparent.
					if (!cell.underlayIcon) cell.underlayIcon = DIRT_ICON;
					// A composter's open top is a bin, not a window - what
					// should show through its transparent rim is its own
					// wooden interior, not whatever real block happens to
					// sit underneath it in-world (a floor tile that has
					// nothing to do with the composter itself). Overrides
					// the real-ground result above; underlayY is
					// deliberately left as-is so relief shading still
					// compares against genuine terrain height, only the
					// drawn fill texture changes.
					if (cellName === "minecraft:composter") cell.underlayIcon = COMPOSTER_SIDE_ICON;
				}
				break;
			}

			// Doors almost never win the "topmost block in this column"
			// contest - a real door sits in a doorway with a lintel/awning
			// (slab, log, roof overhang) built above it, so straight down
			// from the sky you see that overhang, not the door itself
			// (confirmed against residence5: multiple doors covered by a
			// spruce_slab a block or two above). Fixing the render to show
			// the door "correctly" isn't possible - it's genuinely hidden
			// from directly overhead - so instead of drawing it, LABEL the
			// column: a separate full-height scan (independent of the
			// primary-block search above, since the door is likely buried
			// under whatever that search already picked) checks for a door
			// anywhere in this (x,z) stack and flags the cell so the
			// renderer can badge it, regardless of what's actually drawn
			// on top. Only the lower half is checked - upper+lower always
			// come as a pair, so this alone is enough to place one label
			// per doorway, not two.
			if (cell) {
				for (let y = 0; y < sy; y++) {
					const i = (y * sz + z) * sx + x;
					const name = v.palette[idx[i]].Name;
					const p = v.palette[idx[i]];
					if (name.endsWith("_door") && p.Properties?.half === "lower") {
						cell.hasDoor = true;
						// A door's actual closed panel runs perpendicular to
						// its own "facing" (confirmed against residence5: a
						// facing=north/south door always had solid neighbors
						// on its east/west sides - the panel plane spans
						// east-west there - and a facing=east/west door
						// always had its passable/open side on the east-west
						// axis, meaning the panel spans north-south; a
						// two-leaf double door has each leaf reporting a
						// DIFFERENT facing for the same shared wall, so
						// facing alone doesn't reliably say which single
						// edge the panel hugs, only which of the two axes
						// it runs along).
						const facing = p.Properties?.facing;
						cell.doorOrientation = facing === "north" || facing === "south" ? "horizontal" : "vertical";
						// Which two neighbor columns are the actual walk-
						// through threshold depends on that same axis - a
						// horizontal (east-west-spanning) panel is walked
						// through from the north/south side, and vice versa.
						// Checked at both the lower and upper half's Y (a
						// window or other opening at just one of the two
						// levels shouldn't on its own decide the classification).
						const sideCells =
							cell.doorOrientation === "horizontal"
								? [
										[x, y, z - 1],
										[x, y + 1, z - 1],
										[x, y, z + 1],
										[x, y + 1, z + 1],
									]
								: [
										[x - 1, y, z],
										[x - 1, y + 1, z],
										[x + 1, y, z],
										[x + 1, y + 1, z],
									];
						cell.doorIsExterior = sideCells.some(([sx2, sy2, sz2]) => exterior.has(`${sx2},${sy2},${sz2}`));
						break;
					}
				}
			}
			row.push(cell);
		}
		grid.push(row);
	}

	// The blockstate's north/south/east/west booleans require an EXACT same-Y
	// match to be true (that's how Minecraft itself computes them) - which
	// breaks down for a fence line that steps up/down with the terrain (a
	// single-block terrace/stair), confirmed against tavern3 column (11,12)
	// (fence at y=10) next to column (11,13) (fence at y=9, one lower): both
	// are obviously the same fence line stepping down, but the boolean is
	// strictly false since nothing exists at y=10 in the neighbor column.
	// Looking straight down, a viewer doesn't see that one-block gap as a
	// break in the fence - it still reads as one continuous line. So this is
	// deliberately NOT the same idea as the earlier reverted attempt (which
	// asked "is the neighbor a solid block", true almost everywhere): here
	// the check is specifically "does the neighbor COLUMN contain a fence
	// post anywhere within a small height window", which stays false for
	// every ordinary floor/wall/ground column (they contain zero fence
	// blocks at any height) and only fires for genuine fence-to-fence
	// adjacency, same-Y or slightly stepped. Purely additive: the
	// blockstate-declared connections are trusted as-is and kept; this only
	// fills in directions the boolean left false.
	const FENCE_Y_TOLERANCE = 2;
	function columnHasFenceNear(nx, nz, targetY) {
		if (nx < 0 || nx >= sx || nz < 0 || nz >= sz) return false;
		const yLo = Math.max(0, targetY - FENCE_Y_TOLERANCE);
		const yHi = Math.min(sy - 1, targetY + FENCE_Y_TOLERANCE);
		for (let y = yLo; y <= yHi; y++) {
			const ni = (y * sz + nz) * sx + nx;
			const nName = v.palette[idx[ni]].Name;
			if (nName.endsWith("_fence") || nName.endsWith("_fence_gate")) return true;
		}
		return false;
	}
	const NEIGHBOR_OFFSET = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
	for (let z = 0; z < sz; z++) {
		for (let x = 0; x < sx; x++) {
			const cell = grid[z][x];
			if (!cell || cell.shape !== "fence") continue;
			const isGate = cell.name.endsWith("_fence_gate");
			for (const [dir, [dx, dz]] of Object.entries(NEIGHBOR_OFFSET)) {
				if (cell.fenceConnections[dir]) continue; // already true, nothing to add
				if (isGate) continue; // a gate's 2 rail directions are fixed by facing, not adjacency
				cell.fenceConnections[dir] = columnHasFenceNear(x + dx, z + dz, cell.fenceY);
			}
		}
	}

	// Same terrace-step problem, same fix, for walls - a wall line stepping
	// down a single block reads as continuous from directly above just like
	// a fence does, but the blockstate boolean (well, "none"/"low"/"tall")
	// is exact-Y only and goes false across the step.
	const WALL_Y_TOLERANCE = 2;
	function columnHasWallNear(nx, nz, targetY) {
		if (nx < 0 || nx >= sx || nz < 0 || nz >= sz) return false;
		const yLo = Math.max(0, targetY - WALL_Y_TOLERANCE);
		const yHi = Math.min(sy - 1, targetY + WALL_Y_TOLERANCE);
		for (let y = yLo; y <= yHi; y++) {
			const ni = (y * sz + nz) * sx + nx;
			const nName = v.palette[idx[ni]].Name;
			if (nName.endsWith("_wall")) return true;
		}
		return false;
	}
	for (let z = 0; z < sz; z++) {
		for (let x = 0; x < sx; x++) {
			const cell = grid[z][x];
			if (!cell || cell.shape !== "wall") continue;
			for (const [dir, [dx, dz]] of Object.entries(NEIGHBOR_OFFSET)) {
				if (cell.wallConnections[dir]) continue;
				cell.wallConnections[dir] = columnHasWallNear(x + dx, z + dz, cell.wallY);
			}
		}
	}

	console.log(`  (resolved ${retexturedHits} cells via tile-entity textureData)`);
	return { size_x: sx, size_z: sz, grid };
}

// ---------- shape -> blueprint file discovery ----------
// Covers the WHOLE catalog (every shape in styles/*.json), not a hand-picked
// list - a shape's id/label doesn't always literally match its blueprint's
// filename (folder structure carries some of the naming, plus a handful of
// genuine one-off renames/abbreviations in the mod source itself), so this
// resolves each shape to a real .blueprint file by the same
// category/subcategory logic the planner's shape tray uses
// (planner/catalog.js), scoped to the matching mod
// folder so same-named files in different families (e.g. every rail
// type's own "turn.blueprint") resolve to the right one instead of
// whichever the search happens to hit first.
//
// Verified against the real mod source before being wired in here: 236 of
// 238 catalog shapes resolve via the folder-scoped rule below (0 wrong
// matches found on manual review of every disambiguated case - shared
// basenames like turn/station/end all resolved to their own family's
// folder correctly), 2 explicit one-off renames account for the rest of
// the near-total coverage, and the last 2 (monorail_short_a/b) have no
// corresponding blueprint file in the mod source at all - not a matching
// failure, confirmed by direct directory listing.
function norm(s) {
	return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CATEGORY_TO_FOLDER = { farming: "agriculture", decoration: "decorations" };

// Genuine one-off exceptions that don't follow the regular "strip
// category/subcategory prefix, normalize, match basename" rule - confirmed
// by direct directory inspection, not guessed:
//  - Caledonia's "Alt Farmer" blueprint is misspelled "alfarmer" in the mod
//    source itself (missing a T), unlike every other regularly-named file.
//  - Medieval Spruce's "University Full" has no leveled university6+ file -
//    it's a distinct, non-leveled structure the mod calls
//    "universitylibrary", separate from the regular "University" (levels
//    1-5) shape. That blueprint is only a plot marker: structurize
//    substitution blocks plus a library hut and a university hut, each of
//    which then builds its own building in game. Rendered as-is it's two
//    hut blocks in an empty 36x41 square, so it's marked `composite` and
//    rendered with each hut's own building filled in (see
//    compositeHutBlueprint).
//  - Caledonia's "Monorail Plug B" and "Birail Plug B" blueprints are both
//    misspelled "plub_b" in the mod source (same kind of typo as
//    "alfarmer") - without these the fallback search matched the ROADS
//    folder's plug_b instead, a different piece entirely.
//  - Caledonia's "Roads Station Medium" blueprint abbreviates to
//    "station_med", unlike every other roads/station file which spells out
//    its size word in full.
// {folder, key}, not a literal final path - still resolved through the same
// highest-level-file lookup as every other candidate below (station_med
// itself is level-numbered - station_med1/2/3.blueprint - so treating this
// as a complete "station_med.blueprint" path would 404 the same way the
// first version of this table did, caught by actually running the
// generator rather than assuming the override was correct unverified).
const OVERRIDES = {
	"styles/caledonia.json::horticulture_altfarmer": { folder: "agriculture/horticulture", key: "alfarmer" },
	"styles/medievalspruce.json::education_universityfull": { folder: "education", key: "universitylibrary", composite: true },
	"styles/caledonia.json::roads_station_medium": { folder: "infrastructure/roads", key: "station_med" },
	"styles/caledonia.json::monorail_plug_b": { folder: "infrastructure/monorail", key: "plubb" },
	"styles/caledonia.json::birail_plug_b": { folder: "infrastructure/birail", key: "plubb" },
};

// Subcategories come from the planner itself (planner/catalog.js), so the
// generator and the shape tray can't disagree.
const getShapeSubcategory = getSubcategory;

function walkBlueprints(dir, out) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walkBlueprints(full, out);
		else if (entry.name.endsWith(".blueprint")) out.push(full);
	}
}

// index.get(folderRelPath).get(normalizedBasenameWithoutLevel) -> [{level, rel}]
// rel is folder-relative-to-styleRoot path with the level digits and
// ".blueprint" extension both stripped, e.g. "fundamentals/residence".
function indexBlueprintsByFolder(styleRoot) {
	const files = [];
	walkBlueprints(styleRoot, files);
	const index = new Map();
	for (const full of files) {
		const rel = path.relative(styleRoot, full).replace(/\\/g, "/");
		const folder = path.dirname(rel);
		const base = path.basename(full, ".blueprint");
		const withoutLevel = base.match(/^(.*?)(\d+)?$/)[1];
		const level = base.length > withoutLevel.length ? parseInt(base.slice(withoutLevel.length), 10) : 0;
		if (!index.has(folder)) index.set(folder, new Map());
		const byBase = index.get(folder);
		const key = norm(withoutLevel);
		if (!byBase.has(key)) byBase.set(key, []);
		byBase.get(key).push({ level, rel: rel.replace(/\.blueprint$/, "") });
	}
	return index;
}

function highestLevelMatch(byBase, key) {
	const list = byBase && byBase.get(key);
	if (!list || list.length === 0) return null;
	const maxLevel = Math.max(...list.map((e) => e.level));
	return list.find((e) => e.level === maxLevel);
}

// Resolves one shape to a blueprint's folder-relative path (no extension),
// or null if nothing matched anywhere in its category.
function resolveShapeBlueprint(shape, styleFile, index) {
	const overrideKey = `${styleFile}::${shape.id}`;
	const override = OVERRIDES[overrideKey];
	if (override) {
		const hit = highestLevelMatch(index.get(override.folder), norm(override.key));
		return hit ? hit.rel : null;
	}

	const category = shape.category || "farming";
	const subcategory = getShapeSubcategory(shape);
	const topFolder = CATEGORY_TO_FOLDER[category] || category;
	const folder = subcategory ? `${topFolder}/${subcategory}` : topFolder;

	const idAfterCategory = shape.id.startsWith(`${category}_`) ? shape.id.slice(category.length + 1) : shape.id;
	const idAfterSubcatStart = subcategory && shape.id.startsWith(`${subcategory}_`) ? shape.id.slice(subcategory.length + 1) : null;
	// Handles abbreviated-prefix ids like "infra_plaza_large" (subcategory
	// "plaza" doesn't start the id, but appears later in it) - strip
	// everything up through the LAST occurrence of the subcategory name.
	const subcatIdx = subcategory ? shape.id.lastIndexOf(`${subcategory}_`) : -1;
	const idAfterSubcatAnywhere = subcatIdx >= 0 ? shape.id.slice(subcatIdx + subcategory.length + 1) : null;

	const candidates = [idAfterSubcatStart, idAfterSubcatAnywhere, idAfterCategory, shape.label, shape.id]
		.filter(Boolean)
		.map(norm);

	for (const candidate of candidates) {
		const hit = highestLevelMatch(index.get(folder), candidate);
		if (hit) return hit.rel;
	}
	// Fallback: the subcategory guess above can be wrong for a handful of
	// shapes even after the two rounds of prefix-stripping - search every
	// folder under the same top-level category instead of giving up.
	for (const [candFolder, byBase] of index) {
		if (!candFolder.startsWith(topFolder)) continue;
		for (const candidate of candidates) {
			const hit = highestLevelMatch(byBase, candidate);
			if (hit) return hit.rel;
		}
	}
	return null;
}

// Quarter turn clockwise seen from above (x east, z south): north -> east.
const CW_FACING = { north: "east", east: "south", south: "west", west: "north" };

function rotatePaletteEntryCW(entry) {
	const props = entry.Properties;
	if (!props) return entry;
	const rotated = { ...props };
	if (CW_FACING[props.facing]) rotated.facing = CW_FACING[props.facing];
	if (props.axis === "x") rotated.axis = "z";
	else if (props.axis === "z") rotated.axis = "x";
	// Per-direction connections (fences, walls, panes): each value moves to
	// the side its direction now points at.
	for (const dir of Object.keys(CW_FACING)) {
		if (dir in props) rotated[CW_FACING[dir]] = props[dir];
		else delete rotated[CW_FACING[dir]];
	}
	return { ...entry, Properties: rotated };
}

// Rotates an unpacked blueprint {size_*, palette, tile_entities, idx} a
// quarter turn clockwise: (x, z) -> (size_z - 1 - z, x).
function rotateBlueprintCW(bp) {
	const { size_x: sx, size_y: sy, size_z: sz } = bp;
	const idx = new Uint16Array(bp.idx.length);
	for (let y = 0; y < sy; y++) {
		for (let z = 0; z < sz; z++) {
			for (let x = 0; x < sx; x++) {
				const nx = sz - 1 - z;
				const nz = x;
				idx[(y * sx + nz) * sz + nx] = bp.idx[(y * sz + z) * sx + x];
			}
		}
	}
	return {
		size_x: sz,
		size_y: sy,
		size_z: sx,
		palette: bp.palette.map(rotatePaletteEntryCW),
		tile_entities: (bp.tile_entities || []).map((te) => ({ ...te, x: sz - 1 - te.z, z: te.x })),
		idx,
	};
}

function findHuts(bp) {
	const huts = [];
	const { size_x: sx, size_z: sz } = bp;
	for (let i = 0; i < bp.idx.length; i++) {
		const entry = bp.palette[bp.idx[i]];
		if (!entry.Name.startsWith("minecolonies:blockhut")) continue;
		huts.push({
			name: entry.Name,
			facing: entry.Properties?.facing,
			x: i % sx,
			z: Math.floor(i / sx) % sz,
			y: Math.floor(i / (sx * sz)),
		});
	}
	return huts;
}

// Where a building's hut block(s) sit, as [{ x, z }] in the blueprint's own
// coordinates. The blueprint's own
// primary_offset marks the hut block the colony registers the building by;
// a plot holding several buildings (a composite, or a field plot) has no
// single primary hut, so every hut block in it is listed instead.
function hutPositions(bp, primaryOffset) {
	const huts = findHuts(bp);
	const primary = primaryOffset && huts.find((h) => h.x === primaryOffset.x && h.y === primaryOffset.y && h.z === primaryOffset.z);
	const chosen = primary ? [primary] : huts;
	const seen = new Set();
	return chosen
		.map(({ x, z }) => ({ x, z }))
		.filter(({ x, z }) => !seen.has(`${x},${z}`) && seen.add(`${x},${z}`));
}

// Fills a plot-marker blueprint (substitution blocks + several hut blocks)
// with each hut's own highest-level building, rotated so its hut faces the
// way the marker's hut does and shifted so the two hut blocks coincide -
// the same placement the mod makes when it builds each hut in game.
function compositeHutBlueprint(parentPath, folderIndex, styleRoot) {
	const unpack = (v) => ({ ...v, idx: unpackIndices(v) });
	const parent = unpack(loadBlueprint(parentPath));
	const { size_x: sx, size_y: sy, size_z: sz } = parent;
	const palette = [...parent.palette];
	const paletteKeys = new Map(palette.map((p, i) => [JSON.stringify(p), i]));
	const paletteIndex = (entry) => {
		const key = JSON.stringify(entry);
		if (!paletteKeys.has(key)) {
			paletteKeys.set(key, palette.length);
			palette.push(entry);
		}
		return paletteKeys.get(key);
	};
	const idx = Uint16Array.from(parent.idx);
	const tileEntities = [...(parent.tile_entities || [])];

	for (const hut of findHuts(parent)) {
		const key = hut.name.slice("minecolonies:blockhut".length);
		const hit = highestLevelMatch(folderIndex, norm(key));
		if (!hit) throw new Error(`no blueprint for composite hut ${hut.name}`);
		let child = unpack(loadBlueprint(path.join(styleRoot, `${hit.rel}.blueprint`)));
		let childHut = findHuts(child).find((h) => h.name === hut.name);
		for (let turns = 0; childHut && childHut.facing !== hut.facing; turns++) {
			if (turns === 4) throw new Error(`can't rotate ${hit.rel} to face ${hut.facing}`);
			child = rotateBlueprintCW(child);
			childHut = findHuts(child).find((h) => h.name === hut.name);
		}
		if (!childHut) throw new Error(`${hit.rel} has no ${hut.name}`);
		const dx = hut.x - childHut.x;
		const dy = hut.y - childHut.y;
		const dz = hut.z - childHut.z;
		let clipped = 0;
		for (let y = 0; y < child.size_y; y++) {
			for (let z = 0; z < child.size_z; z++) {
				for (let x = 0; x < child.size_x; x++) {
					const entry = child.palette[child.idx[(y * child.size_z + z) * child.size_x + x]];
					if (isIgnored(entry.Name)) continue;
					const px = x + dx, py = y + dy, pz = z + dz;
					if (px < 0 || px >= sx || py < 0 || py >= sy || pz < 0 || pz >= sz) {
						clipped++;
						continue;
					}
					idx[(py * sz + pz) * sx + px] = paletteIndex(entry);
				}
			}
		}
		for (const te of child.tile_entities || []) {
			if (te.x == null) continue;
			tileEntities.push({ ...te, x: te.x + dx, y: te.y + dy, z: te.z + dz });
		}
		if (clipped) console.warn(`  composite: ${clipped} blocks of ${hit.rel} fall outside the plot and were dropped`);
		console.log(`  composite: ${hit.rel} at offset (${dx}, ${dy}, ${dz}) facing ${hut.facing}`);
	}
	return { size_x: sx, size_y: sy, size_z: sz, palette, tile_entities: tileEntities, idx };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = {};
let successCount = 0;
let skipCount = 0;
const STYLE_TARGETS = [
	{ styleFile: "styles/medievalspruce.json", modFolder: "medievalspruce" },
	{ styleFile: "styles/caledonia.json", modFolder: "caledonia" },
];

for (const { styleFile, modFolder } of STYLE_TARGETS) {
	const styleRoot = path.join(MOD_BLUEPRINTS, modFolder);
	const shapes = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, styleFile), "utf8")).shapes;
	const index = indexBlueprintsByFolder(styleRoot);
	console.log(`\n--- ${styleFile} (${shapes.length} shapes) ---`);

	for (const shape of shapes) {
		delete shape.huts;
		const relPath = resolveShapeBlueprint(shape, styleFile, index);
		if (!relPath) {
			console.warn(`SKIP ${shape.id} (${shape.label}): no matching blueprint found`);
			skipCount++;
			continue;
		}
		const blueprintPath = path.join(styleRoot, `${relPath}.blueprint`);
		if (!fs.existsSync(blueprintPath)) {
			console.warn(`SKIP ${shape.id} (${shape.label}): resolved to ${relPath}.blueprint, but it doesn't exist`);
			skipCount++;
			continue;
		}
		// modFolder-prefixed, not just the label - 51 labels are shared
		// between the two styles (every style has its own "Cook", "Farmer",
		// etc.), so the label alone would have let the second style's file
		// silently overwrite the first's on disk while the manifest still
		// pointed both style keys at whichever one wrote last. Confirmed by
		// diffing styles/medievalspruce.json and styles/caledonia.json's
		// label sets before wiring this in.
		const outLabel = `${modFolder}_${norm(shape.label) || shape.id}`;
		try {
			const override = OVERRIDES[`${styleFile}::${shape.id}`];
			let result;
			let hutBlocks;
			if (override?.composite) {
				const composite = compositeHutBlueprint(blueprintPath, index.get(override.folder), styleRoot);
				result = topDownGrid(composite, composite.idx);
				hutBlocks = hutPositions(composite);
			} else {
				const blueprint = loadBlueprint(blueprintPath);
				result = topDownGrid(blueprint);
				const primaryOffset = blueprint.optional_data?.structurize?.primary_offset;
				hutBlocks = hutPositions({ ...blueprint, idx: unpackIndices(blueprint) }, primaryOffset);
			}
			// Some catalog footprints are the blueprint turned a quarter; the
			// planner corrects for that, so keep the blueprint's own size.
			if (hutBlocks.length) shape.huts = { size_x: result.size_x, size_z: result.size_z, blocks: hutBlocks };
			fs.writeFileSync(path.join(OUT_DIR, `${outLabel}.json`), JSON.stringify(result));
			const unresolvedCount = result.grid.flat().filter((c) => c && !c.icon).length;
			const totalCount = result.grid.flat().filter((c) => c).length;
			console.log(`${shape.id}: ${result.size_x}x${result.size_z}, ${totalCount} occupied cells, ${unresolvedCount} unresolved (${relPath})`);
			manifest[`${styleFile}::${shape.id}`] = `rooftop-data/${outLabel}.json`;
			successCount++;
		} catch (err) {
			console.error(`FAILED ${shape.id} (${relPath}): ${err.message}`);
			skipCount++;
		}
	}
	const styleData = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, styleFile), "utf8"));
	styleData.shapes = shapes;
	fs.writeFileSync(path.join(REPO_ROOT, styleFile), JSON.stringify(styleData, null, "\t") + "\n");
	console.log(`${styleFile}: hut positions for ${shapes.filter((s) => s.huts).length}/${shapes.length} shapes`);
}

fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, "\t") + "\n");
console.log(`\nWrote ${successCount} buildings + manifest.json to ${OUT_DIR} (${skipCount} skipped - see warnings above)`);
