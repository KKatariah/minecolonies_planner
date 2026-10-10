// Fixed values shared across the planner.

// On-screen pixels per block at 100% zoom. Everything placed on the grid is
// positioned in multiples of this.
export const cellSize = 5;

// Minecraft chunk width in blocks; Ctrl/Cmd snaps placement to this.
export const chunkSize = 16;

// The default grid covers one whole region file (512x512 blocks); it grows
// to fit an uploaded world background or a loaded plan.
export const DEFAULT_GRID_SIZE = 32 * 16;

// Largest grid a plan may use, per axis - the same ceiling world-terrain.js
// puts on an uploaded background.
export const MAX_PLAN_GRID_DIMENSION = 16384;

// Every building style the planner can load. A plan can mix them, since a
// colony can in-game.
export const STYLE_FILES = [
	{ id: "caledonia", label: "Caledonia", file: "styles/caledonia.json" },
	{ id: "medievalspruce", label: "Medieval Spruce", file: "styles/medievalspruce.json" },
];
