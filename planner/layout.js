// Builds the planner's static DOM and exports the elements other modules
// need. No behavior lives here; each element's owner attaches its own.
//
// Structure of the map area:
//   #root (scroll container)
//     .grid-zoom-sizer   sized to the ZOOMED grid, so #root's scrollbars
//                        match the zoom (a CSS transform doesn't affect
//                        layout size on its own - see grid-view.js)
//       .grid-shell      unzoomed size, scaled with transform: scale()
//         .world-bg-layer   uploaded terrain, behind the grid, cropped to it
//         .grid             buildings, paths and overlays

import { STYLE_FILES, cellSize, chunkSize } from "./config.js";

const query = (parent, selector) => parent.querySelector(selector);

function create(tag, className, html) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (html !== undefined) el.innerHTML = html;
	return el;
}

// ---------- map area ----------

export const root = document.getElementById("root");

export const gridZoomSizer = create("div", "grid-zoom-sizer");
root.appendChild(gridZoomSizer);

export const gridShell = create("div", "grid-shell");
gridZoomSizer.appendChild(gridShell);

export const worldBgLayer = create("div", "world-bg-layer");
worldBgLayer.hidden = true;
export const worldBgCanvas = document.createElement("canvas");
worldBgLayer.appendChild(worldBgCanvas);
gridShell.appendChild(worldBgLayer);

export const grid = create("div", "grid");
grid.style.setProperty("--cell-size", `${cellSize}px`);
grid.style.setProperty("--chunk-size", `${cellSize * chunkSize}px`);
document.documentElement.style.setProperty("--cell-size", `${cellSize}px`);
gridShell.appendChild(grid);

export const zoomControls = create(
	"div",
	"grid-zoom-controls",
	`
	<button type="button" data-zoom-in title="Zoom in">+</button>
	<button type="button" data-zoom-out title="Zoom out">&minus;</button>
	<button type="button" data-zoom-reset title="Reset zoom">⤢</button>
`,
);
document.body.appendChild(zoomControls);

// One compass for the whole map rather than one per top-down render: the
// grid is always north-up.
const mapCompass = create(
	"div",
	"map-compass",
	`<span class="map-compass__arrow">&#9650;</span><span class="map-compass__label">N</span>`,
);
mapCompass.title = "North is up";
document.body.appendChild(mapCompass);

// ---------- left pane ----------

export const leftSidebar = create(
	"aside",
	"left-sidebar",
	`
	<div class="left-sidebar__header">
		<h2 class="left-sidebar__title">Left Pane</h2>
		<button type="button" class="left-sidebar__toggle" data-left-toggle aria-expanded="true" aria-label="Collapse left pane">Collapse</button>
	</div>
	<div class="left-sidebar__content">
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">Edit History</h3>
			<div class="left-sidebar__button-row">
				<button type="button" class="left-sidebar__button" data-undo disabled>Undo</button>
				<button type="button" class="left-sidebar__button" data-redo disabled>Redo</button>
			</div>
			<button type="button" class="left-sidebar__button left-sidebar__button--danger" data-clear-board>Clear board</button>
		</div>
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">Building Display</h3>
			<label class="world-bg-controls__row" data-hint="Where available, placed buildings show their real top-down render instead of a flat color block.">
				<input type="checkbox" data-rooftop-toggle />
				Show top-down renders
			</label>
			<label class="world-bg-controls__row" data-hint="Marks exterior door locations on top-down renders (Building Preview and the planner grid).">
				<input type="checkbox" data-door-toggle />
				Show doors
			</label>
			<label class="world-bg-controls__row" data-hint="Uncheck for a clean, unobstructed view of top-down renders. Tapping Left Ctrl toggles this too.">
				<input type="checkbox" data-names-toggle checked />
				Show name tags & borders
			</label>
			<label class="world-bg-controls__row" data-hint="Hides the per-cell grid lines on the planner map.">
				<input type="checkbox" data-grid-lines-toggle checked />
				Show grid lines
			</label>
		</div>
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">Plan Check</h3>
			<div class="plan-check" data-plan-check></div>
		</div>
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">World Background</h3>
			<p class="left-sidebar__hint">Upload region files (<code>.mca</code>) from a world save to see real terrain behind the grid.</p>
			<div class="left-sidebar__button-row">
				<button type="button" class="left-sidebar__button" data-bg-file-trigger>Choose files</button>
				<button type="button" class="left-sidebar__button" data-bg-folder-trigger>Choose folder</button>
			</div>
			<input type="file" accept=".mca" multiple hidden data-bg-file-input />
			<input type="file" webkitdirectory multiple hidden data-bg-folder-input />
			<p class="left-sidebar__hint" data-bg-status></p>
			<div class="world-bg-controls" data-bg-controls hidden>
				<label class="world-bg-controls__row">
					<input type="checkbox" data-bg-visible checked />
					Show background
				</label>
				<button type="button" class="left-sidebar__button" data-bg-remove>Remove background</button>
			</div>
		</div>
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">Save / Load</h3>
			<button type="button" class="left-sidebar__button" data-export-json>Export JSON</button>
			<button type="button" class="left-sidebar__button" data-import-json-trigger>Import JSON</button>
			<input type="file" accept="application/json" data-import-json hidden />
			<button type="button" class="left-sidebar__button" data-export-png>Export PNG</button>
		</div>
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">My Plans</h3>
			<div class="left-sidebar__button-row">
				<input type="text" class="left-sidebar__text-input" data-plan-name-input placeholder="Name" aria-label="Plan name" maxlength="60" />
				<button type="button" class="left-sidebar__button left-sidebar__button--fit" data-save-named-plan>Save As</button>
			</div>
			<div class="left-sidebar__plans-list" data-named-plans-list>
				<div class="left-sidebar__plans-empty" data-named-plans-empty>No saved plans yet.</div>
			</div>
		</div>
	</div>
`,
);
document.body.appendChild(leftSidebar);

export const leftToggleButton = query(leftSidebar, "[data-left-toggle]");
export const undoButton = query(leftSidebar, "[data-undo]");
export const redoButton = query(leftSidebar, "[data-redo]");
export const clearBoardButton = query(leftSidebar, "[data-clear-board]");
export const rooftopToggleCheckbox = query(leftSidebar, "[data-rooftop-toggle]");
export const doorToggleCheckbox = query(leftSidebar, "[data-door-toggle]");
export const namesToggleCheckbox = query(leftSidebar, "[data-names-toggle]");
export const gridLinesToggleCheckbox = query(leftSidebar, "[data-grid-lines-toggle]");
export const planCheckEl = query(leftSidebar, "[data-plan-check]");
export const bgFileTriggerButton = query(leftSidebar, "[data-bg-file-trigger]");
export const bgFolderTriggerButton = query(leftSidebar, "[data-bg-folder-trigger]");
export const bgFileInput = query(leftSidebar, "[data-bg-file-input]");
export const bgFolderInput = query(leftSidebar, "[data-bg-folder-input]");
export const bgStatusEl = query(leftSidebar, "[data-bg-status]");
export const bgControlsEl = query(leftSidebar, "[data-bg-controls]");
export const bgVisibleCheckbox = query(leftSidebar, "[data-bg-visible]");
export const bgRemoveButton = query(leftSidebar, "[data-bg-remove]");
export const exportJsonButton = query(leftSidebar, "[data-export-json]");
export const importJsonTriggerButton = query(leftSidebar, "[data-import-json-trigger]");
export const importJsonInput = query(leftSidebar, "[data-import-json]");
export const exportPngButton = query(leftSidebar, "[data-export-png]");
export const planNameInput = query(leftSidebar, "[data-plan-name-input]");
export const saveNamedPlanButton = query(leftSidebar, "[data-save-named-plan]");
export const namedPlansListEl = query(leftSidebar, "[data-named-plans-list]");
export const namedPlansEmptyEl = query(leftSidebar, "[data-named-plans-empty]");

// ---------- right pane ----------

export const previewSidebar = create(
	"aside",
	"preview-sidebar",
	`
	<div class="preview-sidebar__header">
		<h2 class="preview-sidebar__title">Building Preview</h2>
		<button type="button" class="preview-sidebar__toggle" data-preview-toggle aria-expanded="true" aria-label="Collapse preview pane">Collapse</button>
	</div>
	<form class="grid-goto-controls" data-goto-form>
		<label>X <input type="number" step="1" inputmode="numeric" data-goto-x /></label>
		<label>Z <input type="number" step="1" inputmode="numeric" data-goto-z /></label>
		<button type="submit">Go</button>
	</form>
	<div class="hover-coords" data-hover-coords hidden>
		<span data-hover-coords-pos></span>
		<span class="hover-coords__biome" data-hover-coords-biome></span>
	</div>
	<div class="preview-card">
		<div class="preview-card__name" data-preview-name>Select a building</div>
		<div class="preview-card__view-toggle" data-preview-view-toggle hidden>
			<button type="button" class="preview-card__view-btn is-active" data-preview-view="front">Front</button>
			<button type="button" class="preview-card__view-btn" data-preview-view="top">Top-down</button>
		</div>
		<div class="preview-card__image-wrap">
			<img class="preview-card__image" data-preview-image alt="Selected building preview" />
			<canvas class="preview-card__canvas" data-preview-canvas hidden></canvas>
			<div class="preview-card__topdown-label" data-preview-topdown-label hidden></div>
			<div class="preview-card__empty" data-preview-empty>
				Select a building from the tray to see its front view.
			</div>
		</div>
	</div>
	<div class="cost-card" data-cost-card hidden>
		<div class="cost-card__levels" data-cost-levels></div>
		<div class="cost-card__body" data-cost-body></div>
	</div>
`,
);
document.body.appendChild(previewSidebar);

export const previewToggleButton = query(previewSidebar, "[data-preview-toggle]");
export const gotoForm = query(previewSidebar, "[data-goto-form]");
export const gotoXInput = query(previewSidebar, "[data-goto-x]");
export const gotoZInput = query(previewSidebar, "[data-goto-z]");
export const hoverCoordsEl = query(previewSidebar, "[data-hover-coords]");
export const hoverCoordsPosEl = query(previewSidebar, "[data-hover-coords-pos]");
export const hoverCoordsBiomeEl = query(previewSidebar, "[data-hover-coords-biome]");
export const previewName = query(previewSidebar, "[data-preview-name]");
export const previewViewToggle = query(previewSidebar, "[data-preview-view-toggle]");
export const previewImage = query(previewSidebar, "[data-preview-image]");
export const previewCanvas = query(previewSidebar, "[data-preview-canvas]");
export const previewTopDownLabel = query(previewSidebar, "[data-preview-topdown-label]");
export const previewEmpty = query(previewSidebar, "[data-preview-empty]");
export const costCard = query(previewSidebar, "[data-cost-card]");
export const costLevelsEl = query(previewSidebar, "[data-cost-levels]");
export const costBodyEl = query(previewSidebar, "[data-cost-body]");

// ---------- overlays inside the grid ----------

export const actionMenu = create(
	"div",
	"action-menu",
	`
	<button type="button" data-action="rotate">Rotate</button>
	<button type="button" data-action="delete">Delete</button>
	<button type="button" data-action="duplicate">Duplicate</button>
`,
);
grid.appendChild(actionMenu);

export const pathActionMenu = create(
	"div",
	"path-action-menu",
	`<button type="button" data-path-action="delete">Delete</button>`,
);
grid.appendChild(pathActionMenu);

// The eraser's footprint under the cursor.
export const eraserHoverEl = create("div", "eraser-hover-preview");
grid.appendChild(eraserHoverEl);

// The rubber-band rectangle while marquee-selecting.
export const marqueeEl = create("div", "marquee-select");
grid.appendChild(marqueeEl);

// Where a road or wall run will go while it's being dragged out.
export const runDrawPreviewEl = create("div", "run-draw-preview");
grid.appendChild(runDrawPreviewEl);

// ---------- bottom bar (style picker, search, tabs, tray) ----------

export const bottomBar = create("div", "bottom-bar");

export const styleSelect = create("select", "style-select");
for (const style of STYLE_FILES) {
	const option = document.createElement("option");
	option.value = style.file;
	option.textContent = style.label;
	styleSelect.appendChild(option);
}

export const shapeSearchInput = create("input", "shape-search-input");
shapeSearchInput.type = "search";
shapeSearchInput.placeholder = "Search buildings...";

export const tabBar = create("div", "tab-bar");
export const subTabBar = create("div", "subtab-bar");
export const shapeTray = create("div", "shape-tray");

const bottomTop = create("div", "bottom-top");
const categoryStack = create("div", "category-stack");
const bottomBottom = create("div", "bottom-bottom");
categoryStack.append(tabBar, subTabBar);
bottomTop.append(styleSelect, shapeSearchInput, categoryStack);
bottomBottom.appendChild(shapeTray);
bottomBar.append(bottomTop, bottomBottom);
document.body.appendChild(bottomBar);

// The road/river brush controls. Shown inside the shape tray while the
// "Roads & Rivers" tab is open (see tray.js); created once so its listeners
// and values survive being detached and re-attached.
export const pathControls = create(
	"div",
	"path-controls",
	`
	<p class="path-controls__hint" data-path-controls-hint></p>
	<div class="path-type-picker" data-path-type-picker></div>
	<div class="path-controls__row">
		<div class="path-controls__field" data-path-width-field>
			Width
			<span class="number-stepper" data-path-width-stepper>
				<button type="button" class="number-stepper__button" data-path-width-step="-1" aria-label="Narrower">−</button>
				<input type="number" step="1" class="number-stepper__input" aria-label="Width" data-path-width-input />
				<button type="button" class="number-stepper__button" data-path-width-step="1" aria-label="Wider">+</button>
			</span>
		</div>
		<button type="button" class="path-controls__erase-toggle" data-path-erase-toggle>Eraser</button>
	</div>
`,
);
export const pathControlsHintEl = query(pathControls, "[data-path-controls-hint]");
export const pathTypePicker = query(pathControls, "[data-path-type-picker]");
export const pathWidthField = query(pathControls, "[data-path-width-field]");
export const pathWidthStepper = query(pathControls, "[data-path-width-stepper]");
export const pathWidthInput = query(pathControls, "[data-path-width-input]");
export const pathEraseToggleButton = query(pathControls, "[data-path-erase-toggle]");
