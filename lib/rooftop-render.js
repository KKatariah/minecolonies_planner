// Draws a building's top-down render onto a canvas from the per-block grid
// data that scripts/generate_rooftop_renders.js produces (rooftop-data/*.json).
//
// Each visual rule here (fence/wall connections, stair and shingle facing
// shading, height relief, door markers) was tuned against real blueprints;
// see the generator for how the per-cell fields are derived.

export const CELL = 24;

// Shared across every render, so each block icon is fetched and decoded once
// per page rather than once per building. A failed load resolves to null and
// is evicted, so a later render retries it.
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

// Fetches every icon a grid uses in parallel, so a render waits roughly one
// round trip instead of one per distinct block.
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

// Fences and walls are drawn the same way from above: a square post in the
// middle plus an arm toward each neighbor it connects to, which covers
// straight runs, corners, T-junctions, crosses, stubs and lone posts with
// one rule. Walls are chunkier. Values are fractions of the cell size.
const POST_PROPORTIONS = {
	fence: { post: [0.35, 0.65], arm: [0.42, 0.58] },
	wall: { post: [0.3, 0.7], arm: [0.35, 0.65] },
};

function buildPostPath(ctx, px, py, size, connections, proportions) {
	const [postLo, postHi] = proportions.post.map((f) => f * size);
	const [armLo, armHi] = proportions.arm.map((f) => f * size);
	ctx.rect(px + postLo, py + postLo, postHi - postLo, postHi - postLo);
	if (!connections) return;
	if (connections.north) ctx.rect(px + armLo, py, armHi - armLo, postLo);
	if (connections.south) ctx.rect(px + armLo, py + postHi, armHi - armLo, size - postHi);
	if (connections.west) ctx.rect(px, py + armLo, postLo, armHi - armLo);
	if (connections.east) ctx.rect(px + postHi, py + armLo, size - postHi, armHi - armLo);
}

// Outlines only the exposed edges: the post's sides with no arm, and each
// arm's two long sides. Stroking the whole path would also draw each arm's
// end at the cell boundary - exactly where the connected neighbor's arm
// begins - leaving a dark cut at every joint of a run.
function drawPostOutline(ctx, px, py, size, connections, proportions) {
	const [postLo, postHi] = proportions.post.map((f) => f * size);
	const [armLo, armHi] = proportions.arm.map((f) => f * size);
	const c = connections || {};
	const line = (x0, y0, x1, y1) => {
		ctx.moveTo(px + x0, py + y0);
		ctx.lineTo(px + x1, py + y1);
	};
	ctx.beginPath();
	if (!c.north) line(postLo, postLo, postHi, postLo);
	if (!c.south) line(postLo, postHi, postHi, postHi);
	if (!c.west) line(postLo, postLo, postLo, postHi);
	if (!c.east) line(postHi, postLo, postHi, postHi);
	if (c.north) {
		line(armLo, 0, armLo, postLo);
		line(armHi, 0, armHi, postLo);
	}
	if (c.south) {
		line(armLo, postHi, armLo, size);
		line(armHi, postHi, armHi, size);
	}
	if (c.west) {
		line(0, armLo, postLo, armLo);
		line(0, armHi, postLo, armHi);
	}
	if (c.east) {
		line(postHi, armLo, size, armLo);
		line(postHi, armHi, size, armHi);
	}
	ctx.stroke();
}

// The clip region for a non-full block, so its texture is cropped to the
// block's silhouette (the canvas equivalent of styles.css's
// .material-shape--* clip-paths).
function buildShapePath(ctx, cell, px, py, size) {
	const { shape } = cell;
	ctx.beginPath();
	if (shape === "fence") {
		buildPostPath(ctx, px, py, size, cell.fenceConnections, POST_PROPORTIONS.fence);
	} else if (shape === "wall") {
		buildPostPath(ctx, px, py, size, cell.wallConnections, POST_PROPORTIONS.wall);
	} else if (shape === "plate") {
		const l = size * 0.08, r = size * 0.08, t = size * 0.72, b = size * 0.06;
		ctx.rect(px + l, py + t, size - l - r, size - t - b);
	} else if (shape === "button") {
		// Floor/ceiling buttons are a centered nub; wall buttons are a thin
		// strip against the wall they're mounted on (buttonEdge).
		const edge = cell.buttonEdge;
		if (edge) {
			const depth = size * 0.14;
			const w = size * 0.32;
			const inset = (size - w) / 2;
			if (edge === "top") ctx.rect(px + inset, py, w, depth);
			else if (edge === "bottom") ctx.rect(px + inset, py + size - depth, w, depth);
			else if (edge === "left") ctx.rect(px, py + inset, depth, w);
			else if (edge === "right") ctx.rect(px + size - depth, py + inset, depth, w);
		} else {
			const inset = size * 0.34;
			ctx.rect(px + inset, py + inset, size - inset * 2, size - inset * 2);
		}
	} else if (shape === "trapdoor_open") {
		// An open trapdoor stands upright against one face: a thin strip from above.
		const t = size * 0.18;
		const edge = cell.doorEdge;
		if (edge === "top") ctx.rect(px, py, size, t);
		else if (edge === "bottom") ctx.rect(px, py + size - t, size, t);
		else if (edge === "left") ctx.rect(px, py, t, size);
		else if (edge === "right") ctx.rect(px + size - t, py, t, size);
		else ctx.rect(px, py, size, size);
	} else {
		// Includes barrel/plant/lantern: their sprites already have transparent
		// margins, which reveal the underlay without any clipping.
		ctx.rect(px, py, size, size);
	}
}

// Stairs get a stronger darken than shingles: they're small and scattered,
// so a subtle cue gets lost.
function drawStairDarken(ctx, side, px, py, size) {
	const half = size / 2;
	ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
	if (side === "top") ctx.fillRect(px, py, size, half);
	else if (side === "bottom") ctx.fillRect(px, py + half, size, half);
	else if (side === "left") ctx.fillRect(px, py, half, size);
	else if (side === "right") ctx.fillRect(px + half, py, half, size);
}

// A door marker, not a picture of the door (it's usually hidden under a
// lintel or awning - see the generator): a bar across the doorway, purple
// for an exterior door, teal for an interior one.
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

// The height a cell's relief shading compares. A thin shaped block (fence,
// plant, lantern...) mostly shows the ground beneath it, so it uses that
// ground's height; with no ground recorded (a prop over air) there's nothing
// meaningful to compare, so it isn't shaded.
function heightShadeY(cell) {
	if (!cell) return null;
	return cell.shape ? (cell.underlayY ?? null) : (cell.y ?? null);
}

// Relief: a light or dark strip on each edge where this cell is higher or
// lower than its neighbor, with a fixed light from the north-west, so steps
// between same-colored blocks are visible from above. Dark strips are more
// opaque so they still show on dark textures. A stair's low half is only
// half a block down, so a light edge on that half is drawn fainter.
const DIR_TO_DARKEN_SIDE = { north: "top", south: "bottom", west: "left", east: "right" };

function drawHeightShade(ctx, cell, neighbors, px, py, size) {
	const y = heightShadeY(cell);
	if (y == null) return;
	const lineW = Math.max(1, Math.round(size * 0.035));
	const isStair = cell.name.endsWith("_stairs");
	ctx.save();
	const edge = (neighborY, rect, lightSide, dir) => {
		if (neighborY == null || neighborY === y) return;
		const isHigher = y > neighborY;
		const lit = lightSide ? isHigher : !isHigher;
		const onStairLowHalf = isStair && cell.facingDarken === DIR_TO_DARKEN_SIDE[dir];
		const alpha = lit ? (onStairLowHalf ? 0.1 : 0.2) : 0.45;
		ctx.fillStyle = lit ? `rgba(255, 255, 255, ${alpha})` : `rgba(0, 0, 0, ${alpha})`;
		ctx.fillRect(...rect);
	};
	edge(neighbors.north, [px, py, size, lineW], true, "north");
	edge(neighbors.south, [px, py + size - lineW, size, lineW], false, "south");
	edge(neighbors.west, [px, py, lineW, size], true, "west");
	edge(neighbors.east, [px + size - lineW, py, lineW, size], false, "east");
	ctx.restore();
}

// Shingles and other facing blocks: the icon is shaded once (dark bottom
// half, light top half) and that copy is rotated to face each direction, so
// every direction gets identical shading regardless of the texture.
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

// The shaded copy is dark at the bottom; rotate() is clockwise, and a quarter
// turn clockwise moves the bottom to the left.
const SIDE_ROTATION_DEG = { bottom: 0, left: 90, top: 180, right: 270 };

function drawRotatedShaded(ctx, img, side, px, py, size) {
	const deg = SIDE_ROTATION_DEG[side] ?? 0;
	ctx.save();
	ctx.translate(px + size / 2, py + size / 2);
	ctx.rotate((deg * Math.PI) / 180);
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
}

// Renders gridData into canvas, resizing it to fit. Resolves once everything
// is drawn.
export async function renderGrid(gridData, canvas, { cellSize = CELL, showDoors = true, showCompass = true } = {}) {
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
			if (!cell) continue; // nothing in this column - left transparent
			const px = x * cellSize, py = z * cellSize;

			// A shaped block only partly covers its cell; draw the block beneath
			// it first.
			if (cell.shape && cell.underlayIcon) {
				const underImg = getImage(cell.underlayIcon);
				if (underImg) ctx.drawImage(underImg, px, py, cellSize, cellSize);
			}

			// No icon at all (e.g. banners, which have no static texture) leaves
			// the cell transparent.
			const img = cell.icon ? getImage(cell.icon) : null;
			if (img) {
				if (cell.shape) {
					ctx.save();
					buildShapePath(ctx, cell, px, py, cellSize);
					ctx.clip();
					ctx.drawImage(img, px, py, cellSize, cellSize);
					ctx.restore();
					// Outlined, or an oak fence on an oak floor disappears.
					if (cell.shape === "fence" || cell.shape === "wall") {
						ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
						ctx.lineWidth = Math.max(1, cellSize * 0.06);
						const connections = cell.shape === "fence" ? cell.fenceConnections : cell.wallConnections;
						drawPostOutline(ctx, px, py, cellSize, connections, POST_PROPORTIONS[cell.shape]);
					}
					// Something sitting on top (e.g. a lantern on a fence post).
					if (cell.topper?.icon) {
						const topperImg = getImage(cell.topper.icon);
						if (topperImg) ctx.drawImage(topperImg, px, py, cellSize, cellSize);
					}
				} else if (cell.facingDarken && !cell.name.endsWith("_stairs")) {
					drawRotatedShaded(ctx, getShadedIcon(cell.icon, img), cell.facingDarken, px, py, cellSize);
				} else {
					ctx.drawImage(img, px, py, cellSize, cellSize);
					if (cell.facingDarken) drawStairDarken(ctx, cell.facingDarken, px, py, cellSize);
				}
				const neighborY = {
					north: z > 0 ? heightShadeY(grid[z - 1][x]) : null,
					south: z + 1 < size_z ? heightShadeY(grid[z + 1][x]) : null,
					west: x > 0 ? heightShadeY(grid[z][x - 1]) : null,
					east: x + 1 < size_x ? heightShadeY(grid[z][x + 1]) : null,
				};
				drawHeightShade(ctx, cell, neighborY, px, py, cellSize);
			}

			// Exterior doors only; the generator also records interior doors,
			// but marking them made renders too busy.
			if (showDoors && cell.hasDoor && cell.doorIsExterior) {
				drawDoorLabel(ctx, px, py, cellSize, cell.doorOrientation, cell.doorIsExterior);
			}
		}
	}

	if (showCompass) drawCompass(ctx, canvas);
}

// A small "N" arrow in the top-right corner: rows are z and columns are x,
// so up is always north. Skipped on renders too small to fit it.
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
