// Rooftop render — turns the per-block grid data produced by
// scripts/generate_rooftop_renders.js into an actual top-down canvas image.
// A straight port of the scratchpad renderer built over a full prior session
// of correctness work against real blueprint data (see FEASIBILITY_NOTES.md
// and TODO.md's "Birdseye/top-down building renders" entry) - every visual
// rule below (fence/wall post+rail shapes, stair/shingle facing shading,
// height-relief bevels, door labels) was verified against real buildings at
// the time, not guessed. Ported as-is rather than rewritten from scratch.
//
// Wrapped in an IIFE so none of these helper names leak into the global
// scope, same reasoning as world-terrain.js - only the explicit
// window.RooftopRender assignment at the bottom is meant to be visible to
// other scripts.
(function () {

const CELL = 24;

// Shared across every render, so each block icon is fetched and decoded
// once per page rather than once per building. A failed load is evicted
// (and resolves to null), so a later render retries it.
const imageCache = new Map(); // src -> Promise<HTMLImageElement | null>

function loadImage(src) {
	if (!imageCache.has(src)) {
		imageCache.set(
			src,
			new Promise((resolve) => {
				const img = new Image();
				img.onload = () => resolve(img);
				img.onerror = () => {
					imageCache.delete(src);
					resolve(null);
				};
				img.src = src;
			}),
		);
	}
	return imageCache.get(src);
}

// Every icon a grid draws: fetched up front in parallel, so a render waits
// for roughly one round trip instead of one per distinct block in turn.
async function preloadGridImages(grid) {
	const srcs = new Set();
	for (const row of grid) {
		for (const cell of row) {
			if (!cell) continue;
			if (cell.icon) srcs.add(cell.icon);
			if (cell.shape && cell.underlayIcon) srcs.add(cell.underlayIcon);
			if (cell.topper?.icon) srcs.add(cell.topper.icon);
		}
	}
	const list = [...srcs];
	const images = await Promise.all(list.map(loadImage));
	return new Map(list.map((src, i) => [src, images[i]]));
}

// A top-down fence post: a square post in the middle, with a rail running
// out toward the edge for every direction this specific segment actually
// connects to. One generic rule handles every real-world fence layout
// without special-casing each one: 2 opposite directions (N+S or E+W) reads
// as a straight run, 2 adjacent (e.g. N+E) as a corner/L, 3 as a T-junction,
// all 4 as a plus/cross, 1 as a dead-end stub, 0 as a lone post.
function buildFencePath(ctx, px, py, size, connections) {
	const postL = size * 0.35, postR = size * 0.65, postT = size * 0.35, postB = size * 0.65;
	const railL = size * 0.42, railR = size * 0.58;
	ctx.rect(px + postL, py + postT, postR - postL, postB - postT); // post
	if (!connections) return;
	if (connections.north) ctx.rect(px + railL, py, railR - railL, postT);
	if (connections.south) ctx.rect(px + railL, py + postB, railR - railL, size - postB);
	if (connections.west) ctx.rect(px, py + railL, postL, railR - railL);
	if (connections.east) ctx.rect(px + postR, py + railL, size - postR, railR - railL);
}

// The naive approach - fill buildFencePath's rects, then stroke that same
// path - draws a border around EVERY edge of EVERY little rectangle,
// including the edge where a rail meets the cell boundary to join a
// connected neighbor. Since that neighbor draws its own matching stroke
// right on top of the same seam, two connected posts end up with a stray
// dark cut mark exactly at their joint - a straight, fully-connected run
// reads as broken at every single joint, no matter how correct the
// connection data is (confirmed with a synthetic 3-post test: the seam
// artifact showed up between every pair of connected posts, independent of
// any real blueprint data). Only the genuinely EXPOSED edges should get a
// border: the post's own sides where no rail attaches, and each rail's two
// long edges - never a rail's far end (the cell-boundary edge), since that's
// always either a real connection seam or, if unconnected, simply not drawn
// as a rail in the first place.
function drawFenceOutline(ctx, px, py, size, connections) {
	const postL = size * 0.35, postR = size * 0.65, postT = size * 0.35, postB = size * 0.65;
	const railL = size * 0.42, railR = size * 0.58;
	const c = connections || {};
	ctx.beginPath();
	if (!c.north) { ctx.moveTo(px + postL, py + postT); ctx.lineTo(px + postR, py + postT); }
	if (!c.south) { ctx.moveTo(px + postL, py + postB); ctx.lineTo(px + postR, py + postB); }
	if (!c.west) { ctx.moveTo(px + postL, py + postT); ctx.lineTo(px + postL, py + postB); }
	if (!c.east) { ctx.moveTo(px + postR, py + postT); ctx.lineTo(px + postR, py + postB); }
	if (c.north) {
		ctx.moveTo(px + railL, py); ctx.lineTo(px + railL, py + postT);
		ctx.moveTo(px + railR, py); ctx.lineTo(px + railR, py + postT);
	}
	if (c.south) {
		ctx.moveTo(px + railL, py + postB); ctx.lineTo(px + railL, py + size);
		ctx.moveTo(px + railR, py + postB); ctx.lineTo(px + railR, py + size);
	}
	if (c.west) {
		ctx.moveTo(px, py + railL); ctx.lineTo(px + postL, py + railL);
		ctx.moveTo(px, py + railR); ctx.lineTo(px + postL, py + railR);
	}
	if (c.east) {
		ctx.moveTo(px + postR, py + railL); ctx.lineTo(px + size, py + railL);
		ctx.moveTo(px + postR, py + railR); ctx.lineTo(px + size, py + railR);
	}
	ctx.stroke();
}

// Walls get the exact same per-direction connection treatment as fences
// (buildFencePath above) - straight/corner/T/cross/stub/isolated-post all
// fall out of the same "post + a rail toward each true direction" rule, no
// pattern-matching needed - just chunkier proportions, since a wall's actual
// silhouette (a stout pillar with thick connecting arms) is visually heavier
// than a fence's thin post-and-rail.
function buildWallPath(ctx, px, py, size, connections) {
	const postL = size * 0.3, postR = size * 0.7, postT = size * 0.3, postB = size * 0.7;
	const armL = size * 0.35, armR = size * 0.65;
	ctx.rect(px + postL, py + postT, postR - postL, postB - postT); // post
	if (!connections) return;
	if (connections.north) ctx.rect(px + armL, py, armR - armL, postT);
	if (connections.south) ctx.rect(px + armL, py + postB, armR - armL, size - postB);
	if (connections.west) ctx.rect(px, py + armL, postL, armR - armL);
	if (connections.east) ctx.rect(px + postR, py + armL, size - postR, armR - armL);
}

// Mirrors drawFenceOutline above, same reason (a same-material wall on a
// same-material floor otherwise blends into an unbroken square) and same
// fix (only the genuinely exposed edges get a border, never a connection
// seam, or a fully-connected run reads as cut apart at every joint).
function drawWallOutline(ctx, px, py, size, connections) {
	const postL = size * 0.3, postR = size * 0.7, postT = size * 0.3, postB = size * 0.7;
	const armL = size * 0.35, armR = size * 0.65;
	const c = connections || {};
	ctx.beginPath();
	if (!c.north) { ctx.moveTo(px + postL, py + postT); ctx.lineTo(px + postR, py + postT); }
	if (!c.south) { ctx.moveTo(px + postL, py + postB); ctx.lineTo(px + postR, py + postB); }
	if (!c.west) { ctx.moveTo(px + postL, py + postT); ctx.lineTo(px + postL, py + postB); }
	if (!c.east) { ctx.moveTo(px + postR, py + postT); ctx.lineTo(px + postR, py + postB); }
	if (c.north) {
		ctx.moveTo(px + armL, py); ctx.lineTo(px + armL, py + postT);
		ctx.moveTo(px + armR, py); ctx.lineTo(px + armR, py + postT);
	}
	if (c.south) {
		ctx.moveTo(px + armL, py + postB); ctx.lineTo(px + armL, py + size);
		ctx.moveTo(px + armR, py + postB); ctx.lineTo(px + armR, py + size);
	}
	if (c.west) {
		ctx.moveTo(px, py + armL); ctx.lineTo(px + postL, py + armL);
		ctx.moveTo(px, py + armR); ctx.lineTo(px + postL, py + armR);
	}
	if (c.east) {
		ctx.moveTo(px + postR, py + armL); ctx.lineTo(px + size, py + armL);
		ctx.moveTo(px + postR, py + armR); ctx.lineTo(px + size, py + armR);
	}
	ctx.stroke();
}

// Mirrors the .material-shape--* clip-paths in styles.css — same idea, canvas
// clip regions instead of CSS. A fence/wall/stairs/slab/etc. is textured
// identically to its parent block, so this crops the drawn texture into a
// silhouette of the actual shape instead of a solid square.
function buildShapePath(ctx, shape, px, py, size, fenceConnections, doorEdge, wallConnections, buttonEdge) {
	ctx.beginPath();
	if (shape === "fence") {
		buildFencePath(ctx, px, py, size, fenceConnections);
	} else if (shape === "wall") {
		buildWallPath(ctx, px, py, size, wallConnections);
	} else if (shape === "plate") {
		const l = size * 0.08, r = size * 0.08, t = size * 0.72, b = size * 0.06;
		ctx.rect(px + l, py + t, size - l - r, size - t - b);
	} else if (shape === "button") {
		// A floor/ceiling button really does sit centered on/under its block,
		// same as before - a square nub. A WALL button protrudes sideways
		// from whatever it's mounted to instead, and a real button is a
		// slim thing (barely sticks out from its wall) - not the same
		// square, but a thin rectangle: narrow in the direction it
		// protrudes, a bit wider running along the wall it's pressed
		// against.
		if (buttonEdge) {
			const depth = size * 0.14;
			const w = size * 0.32;
			const inset = (size - w) / 2;
			if (buttonEdge === "top") ctx.rect(px + inset, py, w, depth);
			else if (buttonEdge === "bottom") ctx.rect(px + inset, py + size - depth, w, depth);
			else if (buttonEdge === "left") ctx.rect(px, py + inset, depth, w);
			else if (buttonEdge === "right") ctx.rect(px + size - depth, py + inset, depth, w);
		} else {
			const inset = size * 0.34;
			ctx.rect(px + inset, py + inset, size - inset * 2, size - inset * 2);
		}
	} else if (shape === "barrel" || shape === "plant" || shape === "lantern") {
		// Barrel's and lantern's item icons, and grass/fern's own block
		// texture, all already have their own transparent margins
		// (isometric sprite; a lantern item icon's chain hangs in the top
		// third with the actual lantern body lower down, not centered;
		// thin plant cross-sprite) - draw full-size and let that natural
		// transparency reveal the underlay (drawn separately, see
		// renderGrid) instead of clipping to an artificial centered inset.
		ctx.rect(px, py, size, size);
	} else if (shape === "trapdoor_open") {
		// An open trapdoor has rotated upright against the block face named
		// by doorEdge - viewed from directly above that's a thin panel along
		// just that one edge, not a flat square, so this crops down to a
		// sliver instead of drawing the full-block "closed" silhouette.
		const t = size * 0.18;
		if (doorEdge === "top") ctx.rect(px, py, size, t);
		else if (doorEdge === "bottom") ctx.rect(px, py + size - t, size, t);
		else if (doorEdge === "left") ctx.rect(px, py, t, size);
		else if (doorEdge === "right") ctx.rect(px + size - t, py, t, size);
		else ctx.rect(px, py, size, size);
	} else {
		ctx.rect(px, py, size, size);
	}
}

function fillHalf(ctx, side, px, py, size) {
	const half = size / 2;
	if (side === "top") ctx.fillRect(px, py, size, half);
	else if (side === "bottom") ctx.fillRect(px, py + half, size, half);
	else if (side === "left") ctx.fillRect(px, py, half, size);
	else if (side === "right") ctx.fillRect(px + half, py, half, size);
}

// Stairs: darken-only rect overlay, deliberately more visible than the
// shingle treatment below — they're a small, common element (not a whole
// roof surface), so a stronger cue reads better without looking excessive.
function drawStairDarken(ctx, side, px, py, size) {
	ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
	fillHalf(ctx, side, px, py, size);
}

// A door badge, not an attempt to depict the actual door (it's covered by
// whatever's built above it - see generate_rooftop_renders.js). A flat bar
// standing in for the door's own panel - thin across the axis the panel
// actually spans (see doorOrientation), full-width across the other, roughly
// the footprint a real closed door would occupy without claiming to be a
// literal, pixel-accurate render of it. Color carries a second bit of
// information: purple for an exterior/entrance door (at least one of its two
// threshold sides was reached by the outside-seeded flood fill), teal for a
// door with both sides enclosed - an interior room divider.
function drawDoorLabel(ctx, px, py, size, orientation, isExterior) {
	const cx = px + size / 2, cy = py + size / 2;
	const thin = size * 0.16;
	ctx.save();
	ctx.fillStyle = isExterior ? "rgba(155, 60, 210, 0.85)" : "rgba(45, 150, 160, 0.85)";
	if (orientation === "horizontal") {
		ctx.fillRect(px, cy - thin / 2, size, thin);
	} else {
		ctx.fillRect(cx - thin / 2, py, thin, size);
	}
	ctx.restore();
}

// A fence/plant/wall/lantern/etc. is thin enough that the underlay (drawn
// separately, see renderGrid) is what actually fills most of the cell -
// the decoration's own Y (often a block or more above the real ground, e.g.
// a fence post) isn't what a viewer is reading as "how tall is this patch of
// ground," the visible floor around/through it is. So relief shading keys
// off the underlay's height for any shaped cell, falling back to the cell's
// own Y only when there's nothing shaped in the way (a plain full-block
// tile IS the thing being compared). No underlay recorded (a floating prop
// over air) means no meaningful ground to compare against, so shading is
// skipped rather than guessed.
function heightShadeY(cell) {
	if (!cell) return null;
	return cell.shape ? (cell.underlayY ?? null) : (cell.y ?? null);
}

// Per-block relief shading, same idea as World Viewer's terrain rendering
// (see world-terrain.js) - compare this column's real height to its south
// (+z) neighbor's and tint the whole cell lighter or darker, so a step or
// ledge between two same-material blocks (a stone floor one block up from
// another stone floor, say) actually reads as a step from directly above,
// not just a flat same-color wash. Unlike World Viewer (which paints flat
// pixels), a building cell is a drawn icon, so this is a translucent overlay
// rather than an RGB multiply. Always drawn full-cell, never clipped to the
// cell's own shape path (a fence post's own silhouette): now that the height
// being shown is the underlying ground's, not the decoration's, the shading
// should read as if the whole cell were that ground, same as a plain floor
// tile.
function drawHeightShade(ctx, cell, neighbors, px, py, size) {
	const y = heightShadeY(cell);
	if (y == null) return;
	const lineW = Math.max(1, Math.round(size * 0.035));
	ctx.save();
	// A single fixed light source, not "light whichever side happens to be
	// higher" - light is fixed at the north/west edges, dark at south/east -
	// a block higher than a given neighbor gets its north/west edge toward
	// that neighbor lit and its south/east edge darkened; a block LOWER than
	// a neighbor (a dent) gets the exact opposite on each of those edges.
	// White at 0.2 alpha reads fine against almost anything. Black needs to
	// be higher (0.45) to stay visible against an already-dark texture
	// (spruce leaves, coal, etc.), where there's barely any headroom left to
	// darken further.
	// A stair's low/open half (see drawStairDarken above) is only half the
	// height of a full block, not a whole step down - so a light edge that
	// lands on that half is overstating the relief if drawn at full
	// strength. Only the edge matching the stair's own darkened side
	// qualifies (that's the one strip that sits entirely within the low
	// half - the two side edges run the full height of the cell, crossing
	// both halves, so they're left alone).
	const DIR_TO_DARKEN_SIDE = { north: "top", south: "bottom", west: "left", east: "right" };
	const isStair = cell.name.endsWith("_stairs");
	const edge = (neighborY, rectArgs, lightSide, dir) => {
		if (neighborY == null || neighborY === y) return;
		const isHigher = y > neighborY;
		const lit = lightSide ? isHigher : !isHigher;
		const onStairLowHalf = isStair && cell.facingDarken === DIR_TO_DARKEN_SIDE[dir];
		const alpha = lit ? (onStairLowHalf ? 0.1 : 0.2) : 0.45;
		ctx.fillStyle = lit ? `rgba(255, 255, 255, ${alpha})` : `rgba(0, 0, 0, ${alpha})`;
		ctx.fillRect(...rectArgs);
	};
	edge(neighbors.north, [px, py, size, lineW], true, "north");
	edge(neighbors.south, [px, py + size - lineW, size, lineW], false, "south");
	edge(neighbors.west, [px, py, lineW, size], true, "west");
	edge(neighbors.east, [px + size - lineW, py, lineW, size], false, "east");
	ctx.restore();
}

// Shingles: rather than drawing separate overlay rects per cell (which kept
// looking inconsistent — a gradient already baked into the base texture
// varies per-tile, not per-direction, so no single "boost this direction"
// rule was ever safe), pre-shade the icon ONCE (dark bottom half, light top
// half) and rotate that single shaded image per cell instead. Same shading,
// guaranteed pixel-identical across every direction, since it's the same
// image just turned to face the right way.
// The shaded copy is kept as a canvas - drawImage() takes one directly, so
// there's no need to round-trip it through a data URL and an <img>.
const shadedIconCache = new Map(); // iconPath -> HTMLCanvasElement

function getShadedIcon(iconPath, baseImg) {
	if (!shadedIconCache.has(iconPath)) {
		const off = document.createElement("canvas");
		off.width = baseImg.width;
		off.height = baseImg.height;
		const octx = off.getContext("2d");
		octx.imageSmoothingEnabled = false;
		octx.drawImage(baseImg, 0, 0);
		octx.fillStyle = "rgba(0, 0, 0, 0.16)";
		octx.fillRect(0, off.height / 2, off.width, off.height / 2);
		octx.fillStyle = "rgba(255, 255, 255, 0.1)";
		octx.fillRect(0, 0, off.width, off.height / 2);
		shadedIconCache.set(iconPath, off);
	}
	return shadedIconCache.get(iconPath);
}

// The pre-shaded image has its dark half at the BOTTOM by construction, so
// "bottom" needs no rotation; the others turn it to match. Canvas rotate()
// is clockwise for positive angles, and rotating a shape 90° clockwise moves
// whatever was at the bottom to the left (6 o'clock → 9 o'clock).
const SIDE_ROTATION_DEG = { bottom: 0, left: 90, top: 180, right: 270 };

function drawRotatedShaded(ctx, img, side, px, py, size) {
	const deg = SIDE_ROTATION_DEG[side] ?? 0;
	ctx.save();
	ctx.translate(px + size / 2, py + size / 2);
	ctx.rotate((deg * Math.PI) / 180);
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
}

// Renders gridData (from a rooftop-data/*.json file) into canvas, sized to
// fit exactly. Returns once every layer has actually been drawn (all image
// loads awaited) - the caller doesn't need its own "is it done yet" signal.
async function renderGrid(gridData, canvas, { cellSize = CELL, showDoors = true, showCompass = true } = {}) {
	const { size_x, size_z, grid } = gridData;
	canvas.width = size_x * cellSize;
	canvas.height = size_z * cellSize;
	// Loaded before touching the canvas, so the drawing below is synchronous.
	const images = await preloadGridImages(grid);
	const getImage = (src) => images.get(src) || null;
	const ctx = canvas.getContext("2d");
	ctx.imageSmoothingEnabled = false;
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	for (let z = 0; z < size_z; z++) {
		for (let x = 0; x < size_x; x++) {
			const cell = grid[z][x];
			const px = x * cellSize, py = z * cellSize;
			if (!cell) continue; // leave transparent (no block at this column)

			// Non-full-block shapes (fence/wall/slab/lantern/etc.) leave part of
			// the cell showing whatever's directly beneath them in-world — draw
			// that first, full-cell, before the clipped primary icon on top.
			if (cell.shape && cell.underlayIcon) {
				const underImg = getImage(cell.underlayIcon);
				if (underImg) ctx.drawImage(underImg, px, py, cellSize, cellSize);
			}

			if (cell.icon) {
				const img = getImage(cell.icon);
				if (img) {
					if (cell.shape) {
						ctx.save();
						buildShapePath(ctx, cell.shape, px, py, cellSize, cell.fenceConnections, cell.doorEdge, cell.wallConnections, cell.buttonEdge);
						ctx.clip();
						ctx.drawImage(img, px, py, cellSize, cellSize);
						ctx.restore();
						// A same-material fence/wall on a same-material floor
						// (oak fence over oak planks, stone wall over stone
						// bricks) otherwise blends into an unbroken square —
						// outline it so it's visually distinct.
						if (cell.shape === "fence") {
							ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
							ctx.lineWidth = Math.max(1, cellSize * 0.06);
							drawFenceOutline(ctx, px, py, cellSize, cell.fenceConnections);
						} else if (cell.shape === "wall") {
							ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
							ctx.lineWidth = Math.max(1, cellSize * 0.06);
							drawWallOutline(ctx, px, py, cellSize, cell.wallConnections);
						}
						// A topper (e.g. a lantern perched on this fence
						// post) got folded into this cell so the fence's own
						// shape/connections wouldn't be discarded - draw it
						// full-size on top now, same as it'd render on its
						// own.
						if (cell.topper?.icon) {
							const topperImg = getImage(cell.topper.icon);
							if (topperImg) ctx.drawImage(topperImg, px, py, cellSize, cellSize);
						}
					} else if (cell.facingDarken && !cell.name.endsWith("_stairs")) {
						const shadedImg = getShadedIcon(cell.icon, img);
						if (shadedImg) drawRotatedShaded(ctx, shadedImg, cell.facingDarken, px, py, cellSize);
						else ctx.drawImage(img, px, py, cellSize, cellSize);
					} else {
						ctx.drawImage(img, px, py, cellSize, cellSize);
						if (cell.facingDarken) {
							drawStairDarken(ctx, cell.facingDarken, px, py, cellSize);
						}
					}
					const neighborY = {
						north: z > 0 ? heightShadeY(grid[z - 1][x]) : null,
						south: z + 1 < size_z ? heightShadeY(grid[z + 1][x]) : null,
						west: x > 0 ? heightShadeY(grid[z][x - 1]) : null,
						east: x + 1 < size_x ? heightShadeY(grid[z][x + 1]) : null,
					};
					drawHeightShade(ctx, cell, neighborY, px, py, cellSize);
				}
			}

			// No icon resolved at all (e.g. banners — genuinely no static
			// texture exists anywhere in the game's files) — leave transparent
			// rather than a placeholder fill, same as an empty/air column.

			// A door almost never survives as the visible block in its own
			// column (see generate_rooftop_renders.js - a lintel/awning built
			// above it wins the "topmost block" search first), so label the
			// column instead of trying to draw the door itself. Interior doors
			// disabled for now (exterior/entrance labels only) - the exterior/
			// interior split is still computed and stored on the cell either
			// way, just not drawn for the interior case.
			if (showDoors && cell.hasDoor && cell.doorIsExterior) drawDoorLabel(ctx, px, py, cellSize, cell.doorOrientation, cell.doorIsExterior);
		}
	}

	if (showCompass) drawCompass(ctx, canvas);
}

// A fixed-size (not cellSize-scaled) N arrow in the top-right corner - the
// grid's row/column convention is z-as-rows/x-as-columns = north-up (see
// FACING_TO_DARKEN_SIDE's comment in generate_rooftop_renders.js), so "up"
// on this canvas always IS north; this just makes that fact visible so a
// render can be lined up against an actual in-game build. Skipped on very
// small canvases (a tiny 1-2 cell render) where a fixed 20px badge would
// swamp the image rather than sit unobtrusively in a corner.
function drawCompass(ctx, canvas) {
	if (canvas.width < 32 || canvas.height < 32) return;
	const r = 11;
	const cx = canvas.width - r - 4;
	const cy = r + 4;
	ctx.save();
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.fillStyle = "rgba(10, 10, 14, 0.6)";
	ctx.fill();
	// Upward-pointing arrow (canvas "up" = north, per the row/column
	// convention above), with the "N" label given its own clear band below
	// it rather than crowding the arrowhead.
	ctx.beginPath();
	ctx.moveTo(cx, cy - 7);
	ctx.lineTo(cx - 3, cy - 1);
	ctx.lineTo(cx + 3, cy - 1);
	ctx.closePath();
	ctx.fillStyle = "#ffffff";
	ctx.fill();
	ctx.font = "bold 7px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.fillText("N", cx, cy);
	ctx.restore();
}

window.RooftopRender = { renderGrid, CELL };

})();
