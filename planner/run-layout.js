// Turns a network of straight runs into the real blueprint pieces that
// build it - straights tiled along each run, and a turn, tee or cross piece
// rotated into place wherever runs meet. Pure (no DOM or app state), so
// it's unit-tested directly (tests/unit/run-layout.test.js); run-kits.js
// says which pieces each style has, and run-network.js places the result.
//
// Runs are centerlines as in cell-geometry.js: { axis, start, end }.
// Directions are compass letters: N is -y, E is +x, S is +y, W is -x.
// Rotations are quarter turns clockwise, as placed buildings store them.
//
// Junction pieces are lined up by exact points, not cells: cell i spans
// [i, i + 1], so a run's true centerline can sit on a cell boundary. That
// matters for even widths (Medieval Spruce's 6-wide walls), where no cell
// is the middle and rounding would flip sides each time a piece turns.

import { brushExtent } from "./cell-geometry.js";

const CLOCKWISE = { N: "E", E: "S", S: "W", W: "N" };

function rotateArms(arms, turns) {
	let out = [...arms];
	for (let i = 0; i < turns; i++) out = out.map((d) => CLOCKWISE[d]);
	return new Set(out);
}

// A piece's footprint and center point after `turns` quarter turns: each
// turn maps the point (x, y) to (h - y, x) and swaps w and h.
export function rotatePiece(w, h, center, turns) {
	let size = { w, h };
	let c = { ...center };
	for (let i = 0; i < turns; i++) {
		c = { x: size.h - c.y, y: c.x };
		size = { w: size.h, h: size.w };
	}
	return { ...size, center: c };
}

// A kit piece's center as a point: the middle of its center cell (which
// may be a half, between two cells), or the middle of the piece.
export function pieceCenterPoint(piece, w, h) {
	return piece.center ? { x: piece.center.x + 0.5, y: piece.center.y + 0.5 } : { x: w / 2, y: h / 2 };
}

// The first rotation whose open sides include every one in `needed`, or
// null. (A symmetric piece, like a tower open on all four sides, fits any
// junction at rotation 0.)
export function findRotation(nativeArms, needed) {
	for (let turns = 0; turns < 4; turns++) {
		const arms = rotateArms(nativeArms, turns);
		if ([...needed].every((d) => arms.has(d))) return turns;
	}
	return null;
}

const runSpan = (run) => {
	const a = run.axis === "horizontal" ? "x" : "y";
	return { lo: Math.min(run.start[a], run.end[a]), hi: Math.max(run.start[a], run.end[a]) };
};
const runLine = (run) => (run.axis === "horizontal" ? run.start.y : run.start.x);
const along = (run, cell) => (run.axis === "horizontal" ? cell.x : cell.y);
const onRun = (run, cell) => {
	const { lo, hi } = runSpan(run);
	const across = run.axis === "horizontal" ? cell.y : cell.x;
	return across === runLine(run) && along(run, cell) >= lo && along(run, cell) <= hi;
};

// Every cell where a run ends or two runs cross, with the directions runs
// leave it in.
export function findNodes(runs) {
	const cells = new Map();
	const add = (c) => cells.set(`${c.x},${c.y}`, c);
	for (const run of runs) {
		add(run.start);
		add(run.end);
	}
	for (const h of runs) {
		if (h.axis !== "horizontal") continue;
		for (const v of runs) {
			if (v.axis !== "vertical") continue;
			const cross = { x: runLine(v), y: runLine(h) };
			if (onRun(h, cross) && onRun(v, cross)) add(cross);
		}
	}
	const nodes = [];
	for (const cell of cells.values()) {
		const arms = new Set();
		const owners = [];
		for (const run of runs) {
			if (!onRun(run, cell)) continue;
			const { lo, hi } = runSpan(run);
			if (lo === hi) continue;
			owners.push(run);
			const pos = along(run, cell);
			const [minus, plus] = run.axis === "horizontal" ? ["W", "E"] : ["N", "S"];
			if (pos > lo) arms.add(minus);
			if (pos < hi) arms.add(plus);
		}
		nodes.push({ cell, arms, owners });
	}
	return nodes;
}

// The kit piece a node needs, by how many runs meet there: a turn for two
// at a right angle, a tee for three, a cross for four. A dead end or a run
// passing straight through needs none.
function junctionKind(arms) {
	if (arms.size === 4) return "cross";
	if (arms.size === 3) return "tee";
	if (arms.size === 2 && !(arms.has("N") && arms.has("S")) && !(arms.has("E") && arms.has("W"))) return "turn";
	return null;
}

// Every piece the runs need: [{ id, x, y, w, h, rotation, owners }], where
// owners are the runs a piece belongs to. `kit` is a run-kits.js entry;
// `sizes` maps each of its piece ids to the blueprint's { w, h }.
export function computeRunLayout(kit, runs, sizes) {
	const pieces = [];
	const before = brushExtent(kit.thickness).before;

	// A run's centerline point across it: the middle of its straights'
	// footprint, which starts `before` cells before the run's line.
	const centerline = (line) => line - before + kit.thickness / 2;

	// Junction pieces, by node, so straights can stop at their edges.
	const junctionAt = new Map(); // "x,y" -> { x, y, w, h }
	for (const node of findNodes(runs)) {
		const kind = junctionKind(node.arms);
		const piece = kind && kit[kind];
		if (!piece || !sizes.has(piece.id)) continue;
		const turns = findRotation(piece.arms, node.arms);
		if (turns === null) continue;
		const native = sizes.get(piece.id);
		const { w, h, center } = rotatePiece(native.w, native.h, pieceCenterPoint(piece, native.w, native.h), turns);
		// Floored for a piece that can't center exactly (a 7-wide tower on
		// a 6-wide wall).
		const x = Math.floor(centerline(node.cell.x) - center.x);
		const y = Math.floor(centerline(node.cell.y) - center.y);
		pieces.push({ id: piece.id, x, y, w, h, rotation: turns, owners: node.owners });
		junctionAt.set(`${node.cell.x},${node.cell.y}`, { x, y, w, h });
	}

	// Straights: each run is cut at the junction pieces on it, and each
	// stretch between is tiled with the longest piece that still fits. When
	// even the shortest is too long for what's left, it's slid back to end
	// exactly at the stretch's end, overlapping its neighbor rather than
	// leaving a gap (same as walls always did).
	const shortest = kit.segments[kit.segments.length - 1];
	for (const run of runs) {
		const { lo, hi } = runSpan(run);
		const line = runLine(run);
		const horizontal = run.axis === "horizontal";
		// A junction's extent along this run: [first cell, last cell].
		const extent = (j) => (horizontal ? [j.x, j.x + j.w - 1] : [j.y, j.y + j.h - 1]);
		const stops = [{ pos: lo, junction: null }];
		for (let pos = lo; pos <= hi; pos++) {
			const junction = junctionAt.get(horizontal ? `${pos},${line}` : `${line},${pos}`);
			if (!junction) continue;
			if (pos === lo) stops[0].junction = junction;
			else stops.push({ pos, junction });
		}
		if (stops[stops.length - 1].pos !== hi) stops.push({ pos: hi, junction: null });

		for (let i = 0; i < stops.length - 1; i++) {
			const from = stops[i].junction ? extent(stops[i].junction)[1] + 1 : stops[i].pos;
			const to = stops[i + 1].junction ? extent(stops[i + 1].junction)[0] - 1 : stops[i + 1].pos;
			let pos = from;
			while (pos <= to) {
				const segment = kit.segments.find((s) => s.length <= to - pos + 1) || shortest;
				const segStart = Math.min(pos, to - segment.length + 1);
				const turned = horizontal !== (kit.axis === "horizontal");
				pieces.push({
					id: segment.id,
					x: horizontal ? segStart : line - before,
					y: horizontal ? line - before : segStart,
					w: horizontal ? segment.length : kit.thickness,
					h: horizontal ? kit.thickness : segment.length,
					rotation: turned ? 1 : 0,
					owners: [run],
				});
				if (segStart + segment.length - 1 >= to) break;
				pos = segStart + segment.length;
			}
		}
	}
	return pieces;
}
