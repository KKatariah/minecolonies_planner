// The Path brush: like the piece brushes
// (run-network.js), a drag lays one straight run - here painted rather than
// built from pieces. Each path remembers the centerlines it was drawn with, so a later
// run's ends snap to them (resolveRun in cell-geometry.js): end to end for
// turns and extensions, or onto a run's side for a T. A run that joins
// others becomes part of their path, so a connected network is one path.
// Holding Alt while dragging turns snapping off, and erasing a junction away
// splits the path again (splitDisconnectedPaths in paths.js).
//
// Runs aren't saved, and an undo rebuilds every path without them - after
// either, a path is just its cells, same as walls after a reload.

import { addRun, cellKey, keysToCells, resolveRun, stampRun } from "./cell-geometry.js";
import { addPath, paths, removePath } from "./paths.js";

// How far (Manhattan) a dragged end can be from a run and still snap to it.
const snapTolerance = (width) => width + 2;

// Every remembered run of `type`, tagged with its path. A run with an end
// erased away is forgotten.
function getLiveRuns(type) {
	const runs = [];
	for (const path of paths) {
		if (path.type !== type || !path.runs?.length) continue;
		const keys = new Set(path.cells.map((c) => cellKey(c.x, c.y)));
		path.runs = path.runs.filter((run) => keys.has(cellKey(run.start.x, run.start.y)) && keys.has(cellKey(run.end.x, run.end.y)));
		for (const run of path.runs) runs.push({ ...run, path });
	}
	return runs;
}

// Where a dragged run will actually go, snapped to its neighbors - or
// exactly where it was dragged with snap off, joining nothing.
export function resolveRoadRun(type, width, axis, startCell, endCell, { snap = true } = {}) {
	return resolveRun(snap ? getLiveRuns(type) : [], axis, startCell, endCell, snapTolerance(width));
}

// Paints a run into the path it joins (merging every path it joins into
// one), or a new path if it joins none. Returns that path.
export function placeRoadRun(type, width, axis, startCell, endCell, bounds, { snap = true } = {}) {
	const run = resolveRoadRun(type, width, axis, startCell, endCell, { snap });
	const joined = [...new Set(run.joins.map((r) => r.path))];
	const path = joined[0] || addPath({ type, width });
	path.runs ||= [];
	const keys = new Set(path.cells.map((c) => cellKey(c.x, c.y)));
	for (const other of joined.slice(1)) {
		for (const c of other.cells) keys.add(cellKey(c.x, c.y));
		for (const otherRun of other.runs) addRun(path.runs, otherRun);
		removePath(other);
	}
	stampRun(keys, run, width, bounds);
	path.cells = keysToCells(keys);
	addRun(path.runs, run);
	return path;
}

// Keeps a moved path's runs on its cells.
export function translateRuns(path, runs, dx, dy) {
	if (!runs) return;
	const shift = (c) => ({ x: c.x + dx, y: c.y + dy });
	path.runs = runs.map((run) => ({ axis: run.axis, start: shift(run.start), end: shift(run.end) }));
}
