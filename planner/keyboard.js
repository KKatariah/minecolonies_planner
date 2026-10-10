// The planner's keyboard shortcuts (listed for users in SHORTCUT_GROUPS,
// shown by the nav bar's "?" modal). Left Ctrl's name-tag toggle is in
// display-settings.js. Ignored while typing in a text field.

import { isEditableTarget } from "../lib/dom.js";
import {
	copySelection,
	deleteSelected,
	hasClipboard,
	moveSelectedBy,
	pasteClipboard,
	rotateSelected,
} from "./building-actions.js";
import { redo, undo } from "./history.js";
import { pathToolActive } from "./path-tool.js";
import { deleteSelectedPath, selectedPathId } from "./paths.js";
import { selectedPlaced, selectedPrimary } from "./selection.js";
import { selectedShapeId, toggleShapeRotation } from "./tray.js";

export const SHORTCUT_GROUPS = [
	{
		title: "General",
		items: [
			{ combo: ["Ctrl", "Z"], description: "Undo (⌘Z on Mac)" },
			{ combo: ["Ctrl", "Shift", "Z"], description: "Redo (also Ctrl+Y)" },
			{ combo: ["Delete"], description: "Delete the selected building(s) or road/river segment (also Backspace)" },
			{ combo: ["Ctrl", "Scroll"], description: "Zoom in/out" },
		],
	},
	{
		title: "Placing & moving buildings",
		items: [
			{ combo: ["Arrow keys"], description: "Nudge the selected building(s) by 1 block" },
			{ combo: ["R"], description: "Rotate the armed building before placing it, or the selected building on the grid" },
			{ combo: ["Shift", "Click"], description: "Add/remove a building from the selection" },
			{ combo: ["Ctrl", "Drag"], description: "Snap to 16-block chunk boundaries while placing, moving, or duplicating (⌘ on Mac)" },
			{ combo: ["Ctrl", "C"], description: "Copy the selected building(s)" },
			{ combo: ["Ctrl", "V"], description: "Arm a placement cursor for the last copy - click the grid to stamp it down, repeatably" },
		],
	},
	{
		title: "Roads & Rivers",
		items: [
			{ combo: ["Drag"], description: "Draw a straight run - Path paints it; walls and road types place real blueprint pieces. Ends snap to nearby runs to join them. Canal paints freehand" },
			{ combo: ["Shift", "Drag"], description: "Canal: constrain the current stroke to a straight line" },
			{ combo: ["Right-click", "Drag"], description: "Pan the map without leaving the tool" },
		],
	},
	{
		title: "Top-down renders",
		items: [{ combo: ["Left Ctrl"], description: "Tap to toggle name tags and category borders for a clean view" }],
	},
];

const ARROW_KEY_DELTAS = {
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
};

function handleKeyDown(event) {
	if (isEditableTarget(event.target)) return;

	if (event.key === "Delete" || event.key === "Backspace") {
		if (selectedPlaced.size) {
			event.preventDefault();
			deleteSelected();
		} else if (selectedPathId) {
			event.preventDefault();
			deleteSelectedPath();
		}
		return;
	}

	if ((event.ctrlKey || event.metaKey) && !event.altKey) {
		const key = event.key.toLowerCase();
		if (key === "z" && !event.shiftKey) {
			event.preventDefault();
			undo();
		} else if ((key === "z" && event.shiftKey) || key === "y") {
			event.preventDefault();
			redo();
		} else if (key === "c" && selectedPlaced.size) {
			event.preventDefault();
			copySelection();
		} else if (key === "v" && hasClipboard()) {
			event.preventDefault();
			pasteClipboard();
		}
		if (["z", "y", "c", "v"].includes(key)) return;
	}

	// R rotates the armed tray shape if there is one, else the selected
	// building. Not with Ctrl/Cmd/Alt, so browser shortcuts like reload work.
	if ((event.key === "r" || event.key === "R") && !event.ctrlKey && !event.metaKey && !event.altKey) {
		if (pathToolActive) return;
		if (selectedShapeId) {
			event.preventDefault();
			toggleShapeRotation();
		} else if (selectedPrimary) {
			event.preventDefault();
			rotateSelected();
		}
		return;
	}

	const delta = ARROW_KEY_DELTAS[event.key];
	if (delta && selectedPlaced.size) {
		event.preventDefault();
		moveSelectedBy(delta[0], delta[1]);
	}
}

export function initKeyboard() {
	document.addEventListener("keydown", handleKeyDown);
}
