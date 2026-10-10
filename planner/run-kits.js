// Which real blueprint pieces build each kind of run, per style: walls, and
// Caledonia's road families. Hand-written, because nothing in a style's
// JSON says which piece is a straight, which way it runs, or which sides of
// a junction piece are open - every value here was read off the pieces'
// top-down renders (rooftop-data/), and tests/unit/run-layout.test.js
// checks the ids and sizes against the styles.
//
// A kit: {
//   thickness   blocks across a run (the straights' narrow side)
//   axis        which way the straights run as drawn in their blueprint
//   segments    the straights, longest first: [{ id, length }]
//   turn, tee, cross   junction pieces (each optional): { id, arms, center? }
//     arms      the sides open to a run in the blueprint, as compass
//               letters (N is up); rotated to fit each junction
//     center    the cell where the runs' centerlines meet, in the
//               blueprint - a half when they meet between two cells (even
//               widths); defaults to the middle of the piece
// }
// A junction with no piece in the kit (Medieval Spruce has no cross) just
// lets the straights overlap there.

export const RUN_KITS = {
	"styles/caledonia.json": {
		walls: {
			thickness: 7,
			axis: "horizontal",
			segments: [
				{ id: "walls_long", length: 19 },
				{ id: "walls_medium", length: 13 },
				{ id: "walls_short", length: 5 },
			],
			turn: { id: "walls_corners_corner_a", arms: "NE", center: { x: 3, y: 2 } },
			tee: { id: "walls_tee", arms: "NEW" },
			cross: { id: "walls_misc_cross", arms: "NESW" },
		},
		roads: {
			thickness: 7,
			axis: "horizontal",
			segments: [
				{ id: "roads_long", length: 19 },
				{ id: "roads_medium", length: 13 },
				{ id: "roads_short", length: 7 },
			],
			turn: { id: "roads_corner", arms: "NE" },
			tee: { id: "roads_tee", arms: "EWS" },
			cross: { id: "roads_cross", arms: "NESW" },
		},
		alleys: {
			thickness: 5,
			axis: "horizontal",
			segments: [
				{ id: "alleys_long", length: 13 },
				{ id: "alleys_short", length: 7 },
			],
			turn: { id: "alleys_turn", arms: "NW" },
			tee: { id: "alleys_tee", arms: "NEW" },
			cross: { id: "alleys_cross", arms: "NESW" },
		},
		avenues: {
			thickness: 13,
			axis: "horizontal",
			segments: [
				{ id: "avenues_long", length: 13 },
				{ id: "avenues_short", length: 7 },
			],
			turn: { id: "avenues_turn", arms: "ES" },
			tee: { id: "avenues_tee", arms: "NEW" },
			cross: { id: "avenues_cross", arms: "NESW" },
		},
		// The rail junctions are bigger than the track, so their centers are
		// spelled out.
		birail: {
			thickness: 7,
			axis: "horizontal",
			segments: [
				{ id: "birail_long", length: 13 },
				{ id: "birail_short", length: 7 },
			],
			turn: { id: "birail_turn", arms: "ES", center: { x: 3, y: 3 } },
			tee: { id: "birail_tee", arms: "NEW", center: { x: 6, y: 6 } },
			cross: { id: "birail_cross", arms: "NESW", center: { x: 6, y: 6 } },
		},
		// monorail_short_a/b are in the style but have no blueprint in the
		// mod, so a run ends with a long piece slid back to fit.
		monorail: {
			thickness: 5,
			axis: "horizontal",
			segments: [{ id: "monorail_long", length: 13 }],
			turn: { id: "monorail_turn", arms: "ES", center: { x: 2, y: 2 } },
			tee: { id: "monorail_tee", arms: "NEW", center: { x: 6, y: 6 } },
			cross: { id: "monorail_cross", arms: "NESW", center: { x: 6, y: 6 } },
		},
	},
	"styles/medievalspruce.json": {
		walls: {
			thickness: 6,
			axis: "vertical",
			segments: [{ id: "walls_segment", length: 9 }],
			// A square tower, the same from every side.
			turn: { id: "walls_corner", arms: "NESW" },
			// Its 4-wide walkway runs down x 1-4 and branches east along y 3-6.
			tee: { id: "walls_tcorner", arms: "NES", center: { x: 2.5, y: 4.5 } },
		},
	},
};

export function getRunKit(styleFile, type) {
	const kits = RUN_KITS[styleFile];
	return kits && Object.hasOwn(kits, type) ? kits[type] : null;
}
