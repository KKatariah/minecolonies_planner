// The "Building Display" settings in the left pane, remembered across
// reloads. Each change is announced as a "display-changed" event (payload:
// the setting's name) for the modules that redraw because of it.

import { isEditableTarget } from "../lib/dom.js";
import { persistedToggle } from "../lib/storage.js";
import { emit } from "./events.js";
import { doorToggleCheckbox, grid, gridLinesToggleCheckbox, namesToggleCheckbox, rooftopToggleCheckbox } from "./layout.js";

export const settings = {};

export function initDisplaySettings() {
	// Real top-down renders on placed buildings and textured paths, instead
	// of flat colors.
	settings.topDownRenders = persistedToggle({
		key: "minecolonies.rooftopRenders.v1",
		defaultValue: false,
		checkbox: rooftopToggleCheckbox,
		applyInitial: false,
		onChange: () => emit("display-changed", "topDownRenders"),
	});

	// Exterior door markers on top-down renders.
	settings.doorLabels = persistedToggle({
		key: "minecolonies.rooftopDoors.v1",
		defaultValue: true,
		checkbox: doorToggleCheckbox,
		applyInitial: false,
		onChange: () => emit("display-changed", "doorLabels"),
	});

	// Name tags and category borders over top-down renders. Hidden purely
	// with CSS (.hide-topdown-overlay), so nothing needs redrawing.
	settings.buildingOverlay = persistedToggle({
		key: "minecolonies.showNames.v1",
		defaultValue: true,
		checkbox: namesToggleCheckbox,
		onChange: (on) => document.body.classList.toggle("hide-topdown-overlay", !on),
	});

	// The grid's own line pattern is CSS; solid paths (canal) draw their own
	// lines and redraw on change.
	settings.gridLines = persistedToggle({
		key: "minecolonies.showGridLines.v1",
		defaultValue: true,
		checkbox: gridLinesToggleCheckbox,
		onChange: (on) => {
			grid.classList.toggle("hide-grid-lines", !on);
			emit("display-changed", "gridLines");
		},
	});

	initLeftCtrlToggle();
}

// Tapping Left Ctrl toggles the name-tag overlay - only a clean tap (pressed
// and released with nothing else in between), since Ctrl is also the
// modifier for undo/copy/paste, snapping and zoom.
function initLeftCtrlToggle() {
	let tapPending = false;
	window.addEventListener("keydown", (event) => {
		if (event.code === "ControlLeft") {
			if (!event.repeat) tapPending = !isEditableTarget(event.target);
		} else {
			tapPending = false;
		}
	});
	window.addEventListener("keyup", (event) => {
		if (event.code !== "ControlLeft") return;
		if (tapPending) settings.buildingOverlay.toggle();
		tapPending = false;
	});
	const cancelTap = () => {
		tapPending = false;
	};
	window.addEventListener("pointerdown", cancelTap, { capture: true, passive: true });
	window.addEventListener("wheel", cancelTap, { capture: true, passive: true });
	window.addEventListener("blur", cancelTap);
}
