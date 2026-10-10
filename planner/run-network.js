// The piece brushes - walls, and Caledonia's road families: dragging a
// straight run places the style's real blueprint pieces along it (see
// run-kits.js for the pieces, run-layout.js for how they're laid out). The
// pieces are ordinary buildings (selectable, movable, deletable); this
// module only remembers the runs they were drawn from, so a later run can
// connect to an earlier one - its ends snap to nearby run ends (turns and
// extensions) or onto a run's side (a tee), and every piece of the network
// is laid out again, so junctions get the right piece turned the right way.
// Holding Alt while dragging places a run without snapping.
//
// Gates and other special pieces are left to the user (where a gate goes is
// a design decision).

import { activeStyleFile, getStyleShapes } from "./catalog.js";
import { addRun, resolveRun } from "./cell-geometry.js";
import { placeBuilding, placedSquares, removeBuildings } from "./buildings.js";
import { getRunKit } from "./run-kits.js";
import { computeRunLayout } from "./run-layout.js";

// How runs were drawn, per style and type: { runs, pieces }, pieces being
// Map<layout key, { entry, owners }>. Not saved - after a reload the
// pieces are just buildings.
const networks = new Map();

const pieceKey = (p) => `${p.id}@${p.x},${p.y}r${p.rotation}`;

function getNetwork(styleFile, type) {
	const key = `${styleFile}::${type}`;
	if (!networks.has(key)) networks.set(key, { runs: [], pieces: new Map() });
	return networks.get(key);
}

// Forgets runs with a piece no longer on the board (undo, Clear board,
// loading a plan, deleting a piece), so a stale run can't be rebuilt. The
// rest of a forgotten run's pieces stay as plain buildings.
function pruneStaleRuns(network) {
	const live = new Set(placedSquares);
	const dead = new Set();
	for (const { entry, owners } of network.pieces.values()) {
		if (!live.has(entry)) for (const run of owners) dead.add(run);
	}
	if (!dead.size) return;
	network.runs = network.runs.filter((run) => !dead.has(run));
	for (const [key, piece] of network.pieces) {
		if (!live.has(piece.entry) || piece.owners.some((run) => dead.has(run))) network.pieces.delete(key);
	}
}

// Lays the whole network out again, keeping pieces that haven't moved.
function rebuildNetwork(kit, network, styleFile) {
	const sizes = new Map(getStyleShapes(styleFile).map((shape) => [shape.id, { w: shape.w, h: shape.h }]));
	const next = new Map();
	for (const piece of computeRunLayout(kit, network.runs, sizes)) {
		const key = pieceKey(piece);
		if (next.has(key)) continue;
		const existing = network.pieces.get(key);
		const entry =
			existing?.entry ??
			placeBuilding(piece.x, piece.y, {
				id: piece.id,
				styleFile,
				w: piece.w,
				h: piece.h,
				rotation: piece.rotation,
			});
		next.set(key, { entry, owners: piece.owners });
	}
	removeBuildings([...network.pieces].filter(([key]) => !next.has(key)).map(([, piece]) => piece.entry));
	network.pieces = next;
}

// The active style's kit for `type`, or null if it has none.
export function getActiveRunKit(type) {
	return getRunKit(activeStyleFile, type);
}

const snapTolerance = (kit) => kit.thickness + 2;

// Where a dragged run will actually go, snapped to its neighbors - or
// exactly where it was dragged with snap off. (Junction pieces only go where
// runs actually meet, so an unsnapped run stopping short of another stays a
// separate road.)
export function resolvePieceRun(type, axis, startCell, endCell, { snap = true } = {}) {
	const kit = getActiveRunKit(type);
	if (!kit) return null;
	const network = getNetwork(activeStyleFile, type);
	pruneStaleRuns(network);
	return resolveRun(snap ? network.runs : [], axis, startCell, endCell, snapTolerance(kit));
}

// Places a straight run between two cells on the same row or column.
export function placePieceRun(type, axis, startCell, endCell, { snap = true } = {}) {
	const kit = getActiveRunKit(type);
	if (!kit) return;
	const network = getNetwork(activeStyleFile, type);
	const run = resolvePieceRun(type, axis, startCell, endCell, { snap });
	addRun(network.runs, run);
	rebuildNetwork(kit, network, activeStyleFile);
}
