// planner/run-layout.js and planner/run-kits.js - laying real blueprint
// pieces (walls, Caledonia's road families) along drawn runs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { REPO_ROOT } = require("../helpers/repo-root.js");
const L = require("../../planner/run-layout.js");
const { RUN_KITS } = require("../../planner/run-kits.js");

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const manifest = readJson("rooftop-data/manifest.json");
const sizesFor = (styleFile) => new Map(readJson(styleFile).shapes.map((s) => [s.id, { w: s.w, h: s.h }]));

const run = (axis, sx, sy, ex, ey) => ({ axis, start: { x: sx, y: sy }, end: { x: ex, y: ey } });
const kitPieces = (kit) => [...kit.segments, kit.turn, kit.tee, kit.cross].filter(Boolean);

test("every kit piece is a real shape, its size matches its blueprint, and its center is inside it", () => {
	for (const [styleFile, kits] of Object.entries(RUN_KITS)) {
		const sizes = sizesFor(styleFile);
		for (const [type, kit] of Object.entries(kits)) {
			for (const piece of kitPieces(kit)) {
				const where = `${styleFile} ${type} ${piece.id}`;
				const size = sizes.get(piece.id);
				assert.ok(size, `${where}: not in the style`);
				// The style's w/h must be the blueprint's own orientation, or a
				// rotation would turn the wrong way.
				// Every piece is a real blueprint (so it renders), and the style's
				// w/h is its own orientation, or a rotation would turn the wrong way.
				const renderPath = manifest[`${styleFile}::${piece.id}`];
				assert.ok(renderPath, `${where}: no blueprint render`);
				const render = readJson(renderPath);
				assert.deepEqual([render.size_x, render.size_z], [size.w, size.h], `${where}: style size vs blueprint`);
				if (piece.length) {
					const native = kit.axis === "horizontal" ? [piece.length, kit.thickness] : [kit.thickness, piece.length];
					assert.deepEqual([size.w, size.h], native, `${where}: segment size`);
				}
				if (piece.center) {
					assert.ok(piece.center.x >= 0 && piece.center.x < size.w && piece.center.y >= 0 && piece.center.y < size.h, `${where}: center`);
				}
			}
			const lengths = kit.segments.map((s) => s.length);
			assert.deepEqual(lengths, [...lengths].sort((a, b) => b - a), `${styleFile} ${type}: segments longest first`);
		}
	}
});

test("rotatePiece turns footprints and center points clockwise", () => {
	// A 10x6 piece with its center point near the top-left.
	assert.deepEqual(L.rotatePiece(10, 6, { x: 1.5, y: 2.5 }, 0), { w: 10, h: 6, center: { x: 1.5, y: 2.5 } });
	assert.deepEqual(L.rotatePiece(10, 6, { x: 1.5, y: 2.5 }, 1), { w: 6, h: 10, center: { x: 3.5, y: 1.5 } });
	assert.deepEqual(L.rotatePiece(10, 6, { x: 1.5, y: 2.5 }, 2), { w: 10, h: 6, center: { x: 8.5, y: 3.5 } });
	assert.deepEqual(L.rotatePiece(10, 6, { x: 1.5, y: 2.5 }, 4), { w: 10, h: 6, center: { x: 1.5, y: 2.5 } });
});

// Medieval Spruce's walls are 6 wide, so their centerline falls between
// cells; a turned tee must still line its walkway up with the straights'.
test("an even-width tee lines up with the straights whichever way it's turned", () => {
	const sizes = sizesFor("styles/medievalspruce.json");
	const kit = RUN_KITS["styles/medievalspruce.json"].walls;
	const cases = [
		// [main run, stem run]
		[run("horizontal", 0, 50, 100, 50), run("vertical", 50, 50, 50, 100)], // stem south
		[run("horizontal", 0, 50, 100, 50), run("vertical", 50, 0, 50, 50)], // stem north
		[run("vertical", 50, 0, 50, 100), run("horizontal", 50, 50, 100, 50)], // stem east
		[run("vertical", 50, 0, 50, 100), run("horizontal", 0, 50, 50, 50)], // stem west
	];
	for (const runs of cases) {
		const pieces = L.computeRunLayout(kit, runs, sizes);
		const tee = pieces.find((p) => p.id === "walls_tcorner");
		assert.ok(tee, "tee placed");
		// Every straight is the same 6-wide band (x or y 48-53), centered on
		// the boundary at 51, and the tee covers the junction.
		for (const p of pieces.filter((q) => q.id === "walls_segment")) {
			const band = p.w === 6 ? [p.x, p.x + 5] : [p.y, p.y + 5];
			assert.deepEqual(band, [48, 53]);
		}
		assert.ok(tee.x <= 48 && tee.x + tee.w - 1 >= 53 && tee.y <= 48 && tee.y + tee.h - 1 >= 53, `tee at ${tee.x},${tee.y} r${tee.rotation} covers the junction`);
		// The tee's own centerline crossing (the blueprint point 3,5),
		// turned with it, lands exactly on the bands' crossing.
		const turned = L.rotatePiece(9, 9, { x: 3, y: 5 }, tee.rotation);
		assert.deepEqual([tee.x + turned.center.x, tee.y + turned.center.y], [51, 51]);
	}
});

test("findRotation picks the turn whose open sides cover the junction", () => {
	assert.equal(L.findRotation("NE", new Set(["N", "E"])), 0);
	assert.equal(L.findRotation("NE", new Set(["E", "S"])), 1);
	assert.equal(L.findRotation("NE", new Set(["S", "W"])), 2);
	assert.equal(L.findRotation("NE", new Set(["W", "N"])), 3);
	assert.equal(L.findRotation("NEW", new Set(["N", "S", "E"])), 1);
	assert.equal(L.findRotation("NESW", new Set(["S", "W"])), 0); // symmetric
	assert.equal(L.findRotation("NE", new Set(["N", "S"])), null);
});

test("findNodes finds ends, tees and crossings with the directions runs leave in", () => {
	const nodes = L.findNodes([run("horizontal", 0, 10, 40, 10), run("vertical", 20, 10, 20, 40), run("vertical", 30, 0, 30, 20)]);
	const at = (x, y) => [...nodes.find((n) => n.cell.x === x && n.cell.y === y).arms].sort().join("");
	assert.equal(at(0, 10), "E");
	assert.equal(at(40, 10), "W");
	assert.equal(at(20, 10), "ESW"); // a tee
	assert.equal(at(30, 10), "ENSW".split("").sort().join("")); // a cross
});

// A loop of four runs in every Caledonia family: each corner gets the
// family's turn piece turned to face both runs, sitting exactly on the
// corner, and straights fill the gaps between corners without overlapping
// them.
test("a closed loop gets four correctly turned corner pieces and straights that butt against them", () => {
	const sizes = sizesFor("styles/caledonia.json");
	for (const [type, kit] of Object.entries(RUN_KITS["styles/caledonia.json"])) {
		const loop = [
			run("horizontal", 100, 100, 200, 100),
			run("vertical", 200, 100, 200, 180),
			run("horizontal", 100, 180, 200, 180),
			run("vertical", 100, 100, 100, 180),
		];
		const pieces = L.computeRunLayout(kit, loop, sizes);
		const corners = pieces.filter((p) => p.id === kit.turn.id);
		assert.equal(corners.length, 4, type);
		// Top-left needs E+S, top-right S+W, bottom-right W+N, bottom-left N+E.
		const expected = { "100,100": "ES", "200,100": "SW", "200,180": "NW", "100,180": "EN" };
		for (const corner of corners) {
			const native = sizes.get(corner.id);
			const turned = L.rotatePiece(native.w, native.h, L.pieceCenterPoint(kit.turn, native.w, native.h), corner.rotation);
			const node = `${corner.x + turned.center.x - 0.5},${corner.y + turned.center.y - 0.5}`;
			assert.ok(node in expected, `${type}: corner centered on ${node}`);
			assert.equal(L.findRotation(kit.turn.arms, new Set(expected[node])), corner.rotation, `${type} at ${node}`);
		}
		// Straights never overlap a corner, and the top run is covered from
		// the top-left corner's edge to the top-right corner's edge.
		const straights = pieces.filter((p) => p.id !== kit.turn.id);
		for (const s of straights) {
			for (const c of corners) {
				const overlap = s.x < c.x + c.w && s.x + s.w > c.x && s.y < c.y + c.h && s.y + s.h > c.y;
				assert.ok(!overlap, `${type}: ${s.id} at ${s.x},${s.y} overlaps corner at ${c.x},${c.y}`);
			}
		}
		const [tl, tr] = ["100,100", "200,100"].map((key) => corners.find((c) => {
			const native = sizes.get(c.id);
			const t = L.rotatePiece(native.w, native.h, L.pieceCenterPoint(kit.turn, native.w, native.h), c.rotation);
			return `${c.x + t.center.x - 0.5},${c.y + t.center.y - 0.5}` === key;
		}));
		// Caledonia's straights run east-west unturned.
		const top = straights.filter((s) => s.y + s.h - 1 >= 100 && s.y <= 100 && s.rotation === 0);
		const covered = new Set();
		for (const s of top) for (let x = s.x; x < s.x + s.w; x++) covered.add(x);
		for (let x = tl.x + tl.w; x < tr.x; x++) assert.ok(covered.has(x), `${type}: gap at x=${x} on the top run`);
	}
});

test("a tee and a cross get their pieces; Medieval Spruce, with no cross piece, just overlaps", () => {
	const sizes = sizesFor("styles/caledonia.json");
	const kit = RUN_KITS["styles/caledonia.json"].roads;
	const tee = L.computeRunLayout(kit, [run("horizontal", 0, 50, 100, 50), run("vertical", 50, 50, 50, 100)], sizes);
	const teePiece = tee.find((p) => p.id === "roads_tee");
	// roads_tee is open E, W and S as drawn - a stem going south needs no turn.
	assert.deepEqual([teePiece.x, teePiece.y, teePiece.rotation], [47, 47, 0]);
	const cross = L.computeRunLayout(kit, [run("horizontal", 0, 50, 100, 50), run("vertical", 50, 0, 50, 100)], sizes);
	assert.ok(cross.some((p) => p.id === "roads_cross" && p.x === 47 && p.y === 47));

	const msSizes = sizesFor("styles/medievalspruce.json");
	const msKit = RUN_KITS["styles/medievalspruce.json"].walls;
	const ms = L.computeRunLayout(msKit, [run("horizontal", 0, 50, 100, 50), run("vertical", 50, 0, 50, 100)], msSizes);
	assert.ok(ms.every((p) => p.id === "walls_segment"));
});

test("straights tile longest-first and the last one slides back to end exactly at the run's end", () => {
	const sizes = sizesFor("styles/caledonia.json");
	const kit = RUN_KITS["styles/caledonia.json"].roads;
	const pieces = L.computeRunLayout(kit, [run("horizontal", 0, 10, 40, 10)], sizes);
	assert.deepEqual(pieces.map((p) => [p.id, p.x]), [["roads_long", 0], ["roads_long", 19], ["roads_short", 34]]);
	// Vertical runs turn the (east-west) pieces a quarter.
	const vertical = L.computeRunLayout(kit, [run("vertical", 10, 0, 10, 18)], sizes);
	assert.deepEqual(vertical.map((p) => [p.id, p.x, p.y, p.w, p.h, p.rotation]), [["roads_long", 7, 0, 7, 19, 1]]);
});
