let rows = 8 * 16;
let cols = 10 * 16;
const cellSize = 5;
const chunkSize = 16;
const STYLE_FILES = [
	{ id: "caledonia", label: "Caledonia", file: "styles/caledonia.json" },
	{
		id: "medievalspruce",
		label: "Medieval Spruce",
		file: "styles/medievalspruce.json",
	},
];
let activeStyleId = STYLE_FILES[0].id;

const root = document.getElementById("root");
const gridShell = document.createElement("div");
gridShell.className = "grid-shell";
const grid = document.createElement("div");
grid.className = "grid";
gridShell.appendChild(grid);
root.appendChild(gridShell);

const leftSidebar = document.createElement("aside");
leftSidebar.className = "left-sidebar";
leftSidebar.innerHTML = `
	<div class="left-sidebar__header">
		<h2 class="left-sidebar__title">Left Pane</h2>
		<button type="button" class="left-sidebar__theme-toggle" data-theme-toggle aria-label="Toggle light/dark theme">🌙</button>
		<button type="button" class="left-sidebar__toggle" data-left-toggle aria-expanded="true" aria-label="Collapse left pane">Collapse</button>
	</div>
	<div class="left-sidebar__content">
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">Edit History</h3>
			<div class="left-sidebar__button-row">
				<button type="button" class="left-sidebar__button" data-undo disabled>Undo</button>
				<button type="button" class="left-sidebar__button" data-redo disabled>Redo</button>
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
				<input type="text" class="left-sidebar__text-input" data-plan-name-input placeholder="Plan name" maxlength="60" />
				<button type="button" class="left-sidebar__button" data-save-named-plan>Save As</button>
			</div>
			<div class="left-sidebar__plans-list" data-named-plans-list>
				<div class="left-sidebar__plans-empty" data-named-plans-empty>No saved plans yet.</div>
			</div>
		</div>
	</div>
`;
document.body.appendChild(leftSidebar);

const leftToggleButton = leftSidebar.querySelector("[data-left-toggle]");
const undoButton = leftSidebar.querySelector("[data-undo]");
const redoButton = leftSidebar.querySelector("[data-redo]");
const exportJsonButton = leftSidebar.querySelector("[data-export-json]");
const importJsonTriggerButton = leftSidebar.querySelector(
	"[data-import-json-trigger]",
);
const importJsonInput = leftSidebar.querySelector("[data-import-json]");
const exportPngButton = leftSidebar.querySelector("[data-export-png]");
const planNameInput = leftSidebar.querySelector("[data-plan-name-input]");
const saveNamedPlanButton = leftSidebar.querySelector("[data-save-named-plan]");
const namedPlansListEl = leftSidebar.querySelector("[data-named-plans-list]");
const namedPlansEmptyEl = leftSidebar.querySelector("[data-named-plans-empty]");
const LEFT_COLLAPSE_STORAGE_KEY = "minecolonies.left.collapsed";

function applyLeftCollapsedState(collapsed, persist = true) {
	const isCollapsed = Boolean(collapsed);
	leftSidebar.classList.toggle("is-collapsed", isCollapsed);
	document.body.classList.toggle("left-pane-collapsed", isCollapsed);
	leftToggleButton.setAttribute("aria-expanded", String(!isCollapsed));
	leftToggleButton.setAttribute(
		"aria-label",
		isCollapsed ? "Expand left pane" : "Collapse left pane",
	);
	leftToggleButton.textContent = isCollapsed ? ">" : "Collapse";
	if (!persist) return;
	try {
		window.localStorage.setItem(
			LEFT_COLLAPSE_STORAGE_KEY,
			isCollapsed ? "1" : "0",
		);
	} catch {
		// localStorage may be unavailable in some contexts.
	}
}

leftToggleButton.addEventListener("click", () => {
	const isCollapsed = leftSidebar.classList.contains("is-collapsed");
	applyLeftCollapsedState(!isCollapsed);
});

try {
	const savedLeft = window.localStorage.getItem(LEFT_COLLAPSE_STORAGE_KEY);
	applyLeftCollapsedState(savedLeft === "1", false);
} catch {
	applyLeftCollapsedState(false, false);
}

const themeToggleButton = leftSidebar.querySelector("[data-theme-toggle]");
const THEME_STORAGE_KEY = "minecolonies.theme";

function applyTheme(theme, persist = true) {
	const resolved = theme === "light" ? "light" : "dark";
	document.documentElement.setAttribute("data-theme", resolved);
	themeToggleButton.textContent = resolved === "light" ? "🌙" : "☀️";
	themeToggleButton.setAttribute(
		"aria-label",
		resolved === "light" ? "Switch to dark theme" : "Switch to light theme",
	);
	if (!persist) return;
	try {
		window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
	} catch {
		// localStorage may be unavailable in some contexts.
	}
}

themeToggleButton.addEventListener("click", () => {
	const current =
		document.documentElement.getAttribute("data-theme") === "light"
			? "light"
			: "dark";
	applyTheme(current === "light" ? "dark" : "light");
});

try {
	const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (savedTheme === "light" || savedTheme === "dark") {
		applyTheme(savedTheme, false);
	} else {
		const prefersLight = window.matchMedia?.(
			"(prefers-color-scheme: light)",
		).matches;
		applyTheme(prefersLight ? "light" : "dark", false);
	}
} catch {
	applyTheme("dark", false);
}

const previewSidebar = document.createElement("aside");
previewSidebar.className = "preview-sidebar";
previewSidebar.innerHTML = `
	<div class="preview-sidebar__header">
		<h2 class="preview-sidebar__title">Building Preview</h2>
		<button type="button" class="preview-sidebar__toggle" data-preview-toggle aria-expanded="true" aria-label="Collapse preview pane">Collapse</button>
	</div>
	<div class="preview-card">
		<div class="preview-card__name" data-preview-name>Select a building</div>
		<div class="preview-card__image-wrap">
			<img class="preview-card__image" data-preview-image alt="Selected building preview" />
			<div class="preview-card__empty" data-preview-empty>
				Select a building from the tray to see its front view.
			</div>
		</div>
	</div>
`;
document.body.appendChild(previewSidebar);

const previewName = previewSidebar.querySelector("[data-preview-name]");
const previewImage = previewSidebar.querySelector("[data-preview-image]");
const previewEmpty = previewSidebar.querySelector("[data-preview-empty]");
const previewToggleButton = previewSidebar.querySelector(
	"[data-preview-toggle]",
);
let previewRequestId = 0;
const PREVIEW_COLLAPSE_STORAGE_KEY = "minecolonies.preview.collapsed";

function applyPreviewCollapsedState(collapsed, persist = true) {
	const isCollapsed = Boolean(collapsed);
	previewSidebar.classList.toggle("is-collapsed", isCollapsed);
	document.body.classList.toggle("preview-collapsed", isCollapsed);
	previewToggleButton.setAttribute("aria-expanded", String(!isCollapsed));
	previewToggleButton.setAttribute(
		"aria-label",
		isCollapsed ? "Expand preview pane" : "Collapse preview pane",
	);
	previewToggleButton.textContent = isCollapsed ? ">" : "Collapse";
	if (!persist) return;
	try {
		window.localStorage.setItem(
			PREVIEW_COLLAPSE_STORAGE_KEY,
			isCollapsed ? "1" : "0",
		);
	} catch {
		// localStorage may be unavailable in some contexts.
	}
}

previewToggleButton.addEventListener("click", () => {
	const isCollapsed = previewSidebar.classList.contains("is-collapsed");
	applyPreviewCollapsedState(!isCollapsed);
});

try {
	const saved = window.localStorage.getItem(PREVIEW_COLLAPSE_STORAGE_KEY);
	applyPreviewCollapsedState(saved === "1", false);
} catch {
	applyPreviewCollapsedState(false, false);
}

let gridWidth = 0;
let gridHeight = 0;

grid.style.setProperty("--cell-size", `${cellSize}px`);
grid.style.setProperty("--chunk-size", `${cellSize * chunkSize}px`);
document.documentElement.style.setProperty("--cell-size", `${cellSize}px`);

function updateGridSize() {
	gridWidth = cols * cellSize;
	gridHeight = rows * cellSize;
	grid.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
	grid.style.gridTemplateRows = `repeat(${rows}, ${cellSize}px)`;
	grid.style.width = `${gridWidth}px`;
	grid.style.height = `${gridHeight}px`;
}

function renderGridCells() {
	grid.querySelectorAll(".grid-cell").forEach((cell) => cell.remove());
	const fragment = document.createDocumentFragment();
	for (let i = 0; i < rows * cols; i += 1) {
		const cell = document.createElement("div");
		cell.className = "grid-cell";
		const x = i % cols;
		const y = Math.floor(i / cols);
		if (x === cols - 1) cell.classList.add("last-col");
		cell.dataset.x = String(x);
		cell.dataset.y = String(y);
		fragment.appendChild(cell);
	}
	if (actionMenu) {
		grid.insertBefore(fragment, actionMenu);
	} else {
		grid.appendChild(fragment);
	}
}

updateGridSize();

const actionMenu = document.createElement("div");
actionMenu.className = "action-menu";
actionMenu.innerHTML = `
	<button type="button" data-action="rotate">Rotate</button>
	<button type="button" data-action="delete">Delete</button>
	<button type="button" data-action="duplicate">Duplicate</button>
`;
grid.appendChild(actionMenu);

const pathActionMenu = document.createElement("div");
pathActionMenu.className = "path-action-menu";
pathActionMenu.innerHTML = `
	<button type="button" data-path-action="delete">Delete</button>
`;
grid.appendChild(pathActionMenu);
renderGridCells();

const expandTop = document.createElement("button");
expandTop.type = "button";
expandTop.className = "grid-expand grid-expand--top";
expandTop.textContent = "+ Row";

const expandBottom = document.createElement("button");
expandBottom.type = "button";
expandBottom.className = "grid-expand grid-expand--bottom";
expandBottom.textContent = "+ Row";

const expandLeft = document.createElement("button");
expandLeft.type = "button";
expandLeft.className = "grid-expand grid-expand--left";
expandLeft.textContent = "+ Col";

const expandRight = document.createElement("button");
expandRight.type = "button";
expandRight.className = "grid-expand grid-expand--right";
expandRight.textContent = "+ Col";

gridShell.appendChild(expandTop);
gridShell.appendChild(expandBottom);
gridShell.appendChild(expandLeft);
gridShell.appendChild(expandRight);

function updateExpandLabels(isShiftPressed) {
	expandTop.textContent = isShiftPressed ? "- Row" : "+ Row";
	expandBottom.textContent = isShiftPressed ? "- Row" : "+ Row";
	expandLeft.textContent = isShiftPressed ? "- Col" : "+ Col";
	expandRight.textContent = isShiftPressed ? "- Col" : "+ Col";
}

updateExpandLabels(false);

function shiftPlacedSquares(dx, dy) {
	if (!dx && !dy) return;
	placedSquares.forEach((placed) => {
		placed.x += dx;
		placed.y += dy;
		placed.el.style.left = `${placed.x * cellSize}px`;
		placed.el.style.top = `${placed.y * cellSize}px`;
	});
	if (selectedPrimary) {
		showMenuFor(selectedPrimary);
	}
}

function pruneOutOfBounds() {
	const removed = [];
	for (let i = placedSquares.length - 1; i >= 0; i -= 1) {
		const placed = placedSquares[i];
		const outOfBounds =
			placed.x < 0 ||
			placed.y < 0 ||
			placed.x + placed.w > cols ||
			placed.y + placed.h > rows;
		if (outOfBounds) {
			removed.push(placed.el);
			placed.el.remove();
			placedSquares.splice(i, 1);
		}
	}
	if (removed.length) {
		removed.forEach((el) => selectedPlaced.delete(el));
		if (selectedPrimary && !selectedPlaced.has(selectedPrimary)) {
			selectedPrimary = selectedPlaced.values().next().value || null;
		}
		if (selectedPrimary) {
			showMenuFor(selectedPrimary);
		} else {
			hideMenu();
		}
	}
}

function addChunkRowBottom() {
	rows += chunkSize;
	updateGridSize();
	renderGridCells();
	scheduleAutoSave();
}

function addChunkRowTop() {
	rows += chunkSize;
	updateGridSize();
	shiftPlacedSquares(0, chunkSize);
	shiftPaths(0, chunkSize);
	renderGridCells();
	scheduleAutoSave();
}

function removeChunkRowBottom() {
	if (rows <= chunkSize) return;
	rows -= chunkSize;
	updateGridSize();
	pruneOutOfBounds();
	prunePathsOutOfBounds();
	renderGridCells();
	scheduleAutoSave();
}

function removeChunkRowTop() {
	if (rows <= chunkSize) return;
	rows -= chunkSize;
	updateGridSize();
	shiftPlacedSquares(0, -chunkSize);
	shiftPaths(0, -chunkSize);
	pruneOutOfBounds();
	prunePathsOutOfBounds();
	renderGridCells();
	scheduleAutoSave();
}

function addChunkColumnRight() {
	cols += chunkSize;
	updateGridSize();
	renderGridCells();
	scheduleAutoSave();
}

function addChunkColumnLeft() {
	cols += chunkSize;
	updateGridSize();
	shiftPlacedSquares(chunkSize, 0);
	shiftPaths(chunkSize, 0);
	renderGridCells();
	scheduleAutoSave();
}

function removeChunkColumnRight() {
	if (cols <= chunkSize) return;
	cols -= chunkSize;
	updateGridSize();
	pruneOutOfBounds();
	prunePathsOutOfBounds();
	renderGridCells();
	scheduleAutoSave();
}

function removeChunkColumnLeft() {
	if (cols <= chunkSize) return;
	cols -= chunkSize;
	updateGridSize();
	shiftPlacedSquares(-chunkSize, 0);
	shiftPaths(-chunkSize, 0);
	pruneOutOfBounds();
	prunePathsOutOfBounds();
	renderGridCells();
	scheduleAutoSave();
}

expandTop.addEventListener("click", (event) => {
	if (event.shiftKey) {
		removeChunkRowTop();
		return;
	}
	addChunkRowTop();
});
expandBottom.addEventListener("click", (event) => {
	if (event.shiftKey) {
		removeChunkRowBottom();
		return;
	}
	addChunkRowBottom();
});
expandLeft.addEventListener("click", (event) => {
	if (event.shiftKey) {
		removeChunkColumnLeft();
		return;
	}
	addChunkColumnLeft();
});
expandRight.addEventListener("click", (event) => {
	if (event.shiftKey) {
		removeChunkColumnRight();
		return;
	}
	addChunkColumnRight();
});

const ARROW_KEY_DELTAS = {
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
};

document.addEventListener("keydown", (event) => {
	if (event.key === "Shift") updateExpandLabels(true);

	const target = event.target;
	const isEditable =
		target &&
		(target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.tagName === "SELECT" ||
			target.isContentEditable);
	if (isEditable) return;

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
			return;
		}
		if ((key === "z" && event.shiftKey) || key === "y") {
			event.preventDefault();
			redo();
			return;
		}
	}

	if (event.key === "r" || event.key === "R") {
		if (selectedShapeId && !pathToolActive) {
			event.preventDefault();
			toggleShapeRotation();
		}
		return;
	}

	const delta = ARROW_KEY_DELTAS[event.key];
	if (delta && selectedPlaced.size) {
		event.preventDefault();
		moveSelectedBy(delta[0], delta[1]);
	}
});

document.addEventListener("keyup", (event) => {
	if (event.key === "Shift") updateExpandLabels(false);
});

const bottomBar = document.createElement("div");
bottomBar.className = "bottom-bar";

const styleSelect = document.createElement("select");
styleSelect.className = "style-select";
STYLE_FILES.forEach((styleFile) => {
	const option = document.createElement("option");
	option.value = styleFile.file;
	option.textContent = styleFile.label;
	styleSelect.appendChild(option);
});

const shapeTray = document.createElement("div");
shapeTray.className = "shape-tray";

const tabBar = document.createElement("div");
tabBar.className = "tab-bar";

const subTabBar = document.createElement("div");
subTabBar.className = "subtab-bar";

const tabs = [
	{ id: "farming", label: "Farming" },
	{ id: "craftsmanship", label: "Craftsmanship" },
	{ id: "decoration", label: "Decoration" },
	{ id: "education", label: "Education" },
	{ id: "fundamentals", label: "Fundamentals" },
	{ id: "infrastructure", label: "Infrastructure" },
	{ id: "military", label: "Military" },
	{ id: "mystic", label: "Mystic" },
	{ id: "walls", label: "Walls" },
];

const bottomTop = document.createElement("div");
bottomTop.className = "bottom-top";

const categoryStack = document.createElement("div");
categoryStack.className = "category-stack";

const bottomBottom = document.createElement("div");
bottomBottom.className = "bottom-bottom";

categoryStack.appendChild(tabBar);
categoryStack.appendChild(subTabBar);
bottomTop.appendChild(styleSelect);
const pathToggle = document.createElement("button");
pathToggle.type = "button";
pathToggle.className = "path-toggle";
pathToggle.textContent = "Path Tool";
pathToggle.addEventListener("click", () => togglePathTool());
bottomTop.appendChild(pathToggle);
bottomTop.appendChild(categoryStack);
bottomBottom.appendChild(shapeTray);
bottomBar.appendChild(bottomTop);
bottomBar.appendChild(bottomBottom);
document.body.appendChild(bottomBar);

function updateBottomBarHeight() {
	const height = bottomBar.offsetHeight;
	document.documentElement.style.setProperty(
		"--bottom-bar-height",
		`${height}px`,
	);
}

updateBottomBarHeight();
window.addEventListener("resize", updateBottomBarHeight);

if (window.ResizeObserver) {
	const observer = new ResizeObserver(updateBottomBarHeight);
	observer.observe(bottomBar);
}

const placedSquares = [];
let isDragging = false;
let dragItem = null;
let dragGroup = null;
let suppressClick = false;
let pendingDrag = null;
const selectedPlaced = new Set();
let selectedPrimary = null;
let duplicateMode = false;
let duplicateGroup = null;
let selectedShapeId = null;
let pendingRotated = false;
let shapes = [];
let activeTab = "farming";
let activeSubcategory = "all";

// Path tool state
const pathWidth = 5; // in blocks
let pathToolActive = false;
let nextPathId = 1;
let nextNodeId = 1;
const pathNodes = []; // {id,x,y}
const paths = []; // {id,from,to,cells,elements}
const pathPreviewEls = [];
let pathDrawing = false;
let pathStartCell = null;
let selectedPathId = null; // tracks selected path for menu
let pathDragPending = null; // {pointerId, startCell, pathId, origFrom, origTo}
let pathDragging = false;
let suppressPathClick = false;

const defaultEmoji = "❓";

const subcategoryMap = {
	farming: ["horticulture", "husbandry"],
	craftsmanship: ["carpentry", "luxury", "masonry", "metallurgy", "storage"],
	decoration: [
		"arches",
		"decorative",
		"planning",
		"plaza",
		"supplies",
		"utility",
		"misc",
	],
	infrastructure: [
		"alleys",
		"avenues",
		"birail",
		"fields",
		"monorail",
		"plaza",
		"roads",
		"canal",
	],
	walls: ["corners", "gates", "misc", "stairs", "walls", "corner", "gate", "segment", "tower"],
};

function renderTabs() {
	tabBar.innerHTML = "";
	tabs.forEach((tab) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "tab";
		button.textContent = tab.label;
		button.dataset.tabId = tab.id;
		if (tab.id === activeTab) button.classList.add("is-active");
		button.addEventListener("click", () => setActiveTab(tab.id));
		tabBar.appendChild(button);
	});
}

function setActiveTab(tabId) {
	activeTab = tabId;
	activeSubcategory = "all";
	selectedShapeId = null;
	updateShapeSelectionUI();
	renderTabs();
	renderSubTabs();
	renderShapeTray();
}

function getSubcategory(shape) {
	if (shape.subcategory) return shape.subcategory;
	const category = shape.category || "";
	const id = shape.id || "";
	const allowed = subcategoryMap[category];
	if (!allowed) return "";
	if (category === "walls" && id.startsWith("walls_")) {
		if (id.startsWith("walls_corners_")) return "corners";
		if (id.startsWith("walls_gates_")) return "gates";
		if (id.startsWith("walls_misc_")) return "misc";
		if (id.startsWith("walls_stairs_")) return "stairs";
		return "walls";
	}
	const firstToken = id.split("_")[0] || "";
	if (allowed.includes(firstToken)) return firstToken;
	if (id.startsWith("infra_plaza_")) return "plaza";
	return "";
}

function formatSubcategoryLabel(key) {
	const cleaned = key.replace(/_/g, " ");
	return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderSubTabs() {
	const visibleShapes = shapes.filter(
		(shape) => (shape.category || "farming") === activeTab,
	);
	const definedSubcategories = subcategoryMap[activeTab];
	if (!definedSubcategories || definedSubcategories.length === 0) {
		subTabBar.innerHTML = "";
		subTabBar.classList.add("is-hidden");
		activeSubcategory = "all";
		return;
	}
	const subcategories = definedSubcategories.filter((subcategory) =>
		visibleShapes.some((shape) => getSubcategory(shape) === subcategory),
	);
	if (subcategories.length <= 1) {
		subTabBar.innerHTML = "";
		subTabBar.classList.add("is-hidden");
		activeSubcategory = "all";
		return;
	}

	if (!subcategories.includes(activeSubcategory)) {
		activeSubcategory = "all";
	}

	subTabBar.classList.remove("is-hidden");
	subTabBar.innerHTML = "";

	const allButton = document.createElement("button");
	allButton.type = "button";
	allButton.className = "subtab";
	allButton.textContent = "All";
	allButton.dataset.subtabId = "all";
	if (activeSubcategory === "all") allButton.classList.add("is-active");
	allButton.addEventListener("click", () => setActiveSubcategory("all"));
	subTabBar.appendChild(allButton);

	subcategories.forEach((subcategory) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "subtab";
		button.textContent = formatSubcategoryLabel(subcategory);
		button.dataset.subtabId = subcategory;
		if (subcategory === activeSubcategory) button.classList.add("is-active");
		button.addEventListener("click", () => setActiveSubcategory(subcategory));
		subTabBar.appendChild(button);
	});
}

function setActiveSubcategory(subcategory) {
	activeSubcategory = subcategory;
	selectedShapeId = null;
	updateShapeSelectionUI();
	renderSubTabs();
	renderShapeTray();
}

function getBadgeFontSize(w, h) {
	const minPx = Math.min(w, h) * cellSize;
	const scaled = Math.round(minPx * 0.18);
	return Math.max(8, Math.min(18, scaled));
}

function renderShapeTray() {
	shapeTray.innerHTML = "";
	const maxPreviewHeight = 110;
	const visibleShapes = shapes.filter((shape) => {
		const category = shape.category || "farming";
		if (category !== activeTab) return false;
		if (activeSubcategory === "all") return true;
		return getSubcategory(shape) === activeSubcategory;
	});
	visibleShapes.forEach((shape) => {
		const category = shape.category || "farming";
		const emoji = shape.emoji || defaultEmoji;
		const isRotatedSelection = shape.id === selectedShapeId && pendingRotated;
		const effW = isRotatedSelection ? shape.h : shape.w;
		const effH = isRotatedSelection ? shape.w : shape.h;
		const previewWidth = effW * cellSize;
		const previewHeight = effH * cellSize;
		const badgeSize = getBadgeFontSize(effW, effH);
		const scale =
			previewHeight > maxPreviewHeight ? maxPreviewHeight / previewHeight : 1;
		const scaledWidth = Math.round(previewWidth * scale);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "shape-option";
		button.dataset.shapeId = shape.id;
		button.innerHTML = `
			<div class="shape-label">${shape.label}</div>
			<div class="shape-dimensions">${effW}×${effH}${isRotatedSelection ? " ↻" : ""}</div>
			<div class="shape-preview-wrap" style="width:${scaledWidth}px;">
				<div
					class="shape-preview category-${category}"
					style="width:${previewWidth}px; height:${previewHeight}px; transform: scale(${scale});"
				>
					<div class="preview-badge" style="font-size:${badgeSize}px;">${emoji} ${shape.label}</div>
				</div>
			</div>
		`;
		button.style.width = `${scaledWidth + 12}px`;
		button.addEventListener("click", () => selectShape(shape.id));
		shapeTray.appendChild(button);
	});
	updateShapeSelectionUI();
}

function selectShape(shapeId) {
	if (pathToolActive) return;
	selectedShapeId = selectedShapeId === shapeId ? null : shapeId;
	pendingRotated = false;
	renderShapeTray();
}

function toggleShapeRotation() {
	if (!selectedShapeId || pathToolActive) return;
	pendingRotated = !pendingRotated;
	renderShapeTray();
}

function getSelectedShapeDimensions(shape) {
	if (!pendingRotated) return { w: shape.w, h: shape.h };
	return { w: shape.h, h: shape.w };
}

function updateShapeSelectionUI() {
	shapeTray.querySelectorAll(".shape-option").forEach((button) => {
		button.classList.toggle(
			"is-selected",
			button.dataset.shapeId === selectedShapeId,
		);
	});
	updatePreviewSidebar();
}

function getPreviewImageCandidates(shape) {
	const normalizedLabel = (shape.label || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "_");
	const id = String(shape.id || "")
		.trim()
		.toLowerCase();
	const idTokens = id.split("_").filter(Boolean);
	const lastToken = idTokens[idTokens.length - 1] || "";
	const names = [id, lastToken, normalizedLabel].filter(Boolean);
	const uniqueNames = [...new Set(names)];
	return uniqueNames.map((name) => `images/${activeStyleId}/${name}_front.jpg`);
}

function updatePreviewSidebar() {
	const shape = getSelectedShape();
	previewRequestId += 1;
	const requestId = previewRequestId;

	if (!shape) {
		previewName.textContent = "Select a building";
		previewImage.removeAttribute("src");
		previewImage.style.display = "none";
		previewEmpty.textContent =
			"Select a building from the tray to see its front view.";
		previewEmpty.style.display = "flex";
		return;
	}

	previewName.textContent = shape.label || "Selected Building";
	previewImage.style.display = "none";
	previewEmpty.style.display = "flex";
	previewEmpty.textContent = "Loading preview...";

	const candidates = getPreviewImageCandidates(shape);
	let index = 0;

	const tryNext = () => {
		if (requestId !== previewRequestId) return;
		if (index >= candidates.length) {
			previewImage.removeAttribute("src");
			previewImage.style.display = "none";
			previewEmpty.style.display = "flex";
			previewEmpty.textContent =
				"No preview image found. Expected: images/<building>_front.jpg";
			return;
		}
		previewImage.src = candidates[index];
		index += 1;
	};

	previewImage.onload = () => {
		if (requestId !== previewRequestId) return;
		previewEmpty.style.display = "none";
		previewImage.style.display = "block";
	};

	previewImage.onerror = () => {
		if (requestId !== previewRequestId) return;
		tryNext();
	};

	tryNext();
}

function getSelectedShape() {
	return shapes.find((shape) => shape.id === selectedShapeId) || null;
}

function resolveShapeData(shape) {
	if (!shape) return null;
	const base = shape.id ? shapes.find((item) => item.id === shape.id) : null;
	return {
		id: shape.id || base?.id,
		label: shape.label || base?.label || "Unknown",
		w: shape.w ?? base?.w ?? 1,
		h: shape.h ?? base?.h ?? 1,
		category: shape.category || base?.category || "farming",
		emoji: shape.emoji || base?.emoji,
	};
}

function placeSquare(x, y, shape) {
	const resolved = resolveShapeData(shape);
	if (!resolved) return;
	const placed = document.createElement("div");
	placed.className = "placed-square";
	const category = resolved.category || "farming";
	placed.classList.add(`category-${category}`);
	placed.style.width = `${cellSize * resolved.w}px`;
	placed.style.height = `${cellSize * resolved.h}px`;
	placed.style.left = `${x * cellSize}px`;
	placed.style.top = `${y * cellSize}px`;
	const badge = document.createElement("div");
	badge.className = "placed-badge";
	const emoji = resolved.emoji || defaultEmoji;
	badge.textContent = `${emoji} ${resolved.label}`;
	badge.style.fontSize = `${getBadgeFontSize(resolved.w, resolved.h)}px`;
	placed.appendChild(badge);
	placed.addEventListener("pointerdown", startDrag);
	placed.addEventListener("click", (event) => {
		if (suppressClick || isDragging) return;
		event.stopPropagation();
		selectPlaced(placed, event.shiftKey);
	});
	grid.appendChild(placed);
	placedSquares.push({
		el: placed,
		x,
		y,
		w: resolved.w,
		h: resolved.h,
		id: resolved.id,
		label: resolved.label,
		category,
		emoji,
	});
	scheduleAutoSave();
}

function rectanglesOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
	return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function canPlaceAt(x, y, w, h, ignoreEl) {
	return !placedSquares.some((placed) => {
		if (ignoreEl instanceof Set) {
			if (ignoreEl.has(placed.el)) return false;
		} else if (ignoreEl && placed.el === ignoreEl) {
			return false;
		}
		return rectanglesOverlap(
			x,
			y,
			w,
			h,
			placed.x,
			placed.y,
			placed.w,
			placed.h,
		);
	});
}

function clampGroupAnchor(anchorX, anchorY, groupItems) {
	let minAnchorX = -Infinity;
	let maxAnchorX = Infinity;
	let minAnchorY = -Infinity;
	let maxAnchorY = Infinity;
	groupItems.forEach((entry) => {
		const minX = -entry.dx;
		const maxX = cols - entry.item.w - entry.dx;
		const minY = -entry.dy;
		const maxY = rows - entry.item.h - entry.dy;
		minAnchorX = Math.max(minAnchorX, minX);
		maxAnchorX = Math.min(maxAnchorX, maxX);
		minAnchorY = Math.max(minAnchorY, minY);
		maxAnchorY = Math.min(maxAnchorY, maxY);
	});
	const clampedX = Math.min(Math.max(anchorX, minAnchorX), maxAnchorX);
	const clampedY = Math.min(Math.max(anchorY, minAnchorY), maxAnchorY);
	return { x: clampedX, y: clampedY };
}

function getSnapPoint(clientX, clientY, w, h, step) {
	const rect = grid.getBoundingClientRect();
	const x = Math.floor((clientX - rect.left) / cellSize);
	const y = Math.floor((clientY - rect.top) / cellSize);
	if (x < 0 || y < 0 || x + w > cols || y + h > rows) return null;
	return snapToGrid(x, y, w, h, step);
}

function getCenteredSnapPoint(clientX, clientY, w, h, step) {
	const rect = grid.getBoundingClientRect();
	const centeredX = (clientX - rect.left) / cellSize - w / 2;
	const centeredY = (clientY - rect.top) / cellSize - h / 2;
	const x = Math.round(centeredX);
	const y = Math.round(centeredY);
	return snapToGrid(x, y, w, h, step);
}

function snapToGrid(x, y, w, h, step) {
	if (w > cols || h > rows) return null;
	const snapStep = Math.max(1, step || 1);
	const snappedX = Math.round(x / snapStep) * snapStep;
	const snappedY = Math.round(y / snapStep) * snapStep;
	return clampToBounds(snappedX, snappedY, w, h);
}

function clampToBounds(x, y, w, h) {
	const maxX = cols - w;
	const maxY = rows - h;
	const clampedX = Math.min(Math.max(x, 0), maxX);
	const clampedY = Math.min(Math.max(y, 0), maxY);
	return { x: clampedX, y: clampedY };
}

function startDrag(event) {
	const target = event.currentTarget;
	const item = placedSquares.find((placed) => placed.el === target);
	if (!item) return;
	if (!selectedPlaced.has(target) && !event.shiftKey) {
		selectPlaced(target, false);
	}
	if (!selectedPlaced.has(target)) return;
	pendingDrag = {
		pointerId: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
		anchor: item,
		target,
	};
}

function beginDrag(event) {
	if (!pendingDrag) return;
	const target = pendingDrag.target;
	const item = pendingDrag.anchor;
	pendingDrag = null;
	event.preventDefault();
	pushUndoState();
	isDragging = true;
	dragItem = item;
	suppressClick = true;
	hideMenu(true);
	const dragItems = Array.from(selectedPlaced)
		.map((el) => placedSquares.find((placed) => placed.el === el))
		.filter(Boolean);
	dragGroup = {
		anchor: item,
		items: dragItems.map((entry) => ({
			item: entry,
			dx: entry.x - item.x,
			dy: entry.y - item.y,
		})),
	};
	dragGroup.items.forEach((entry) => {
		entry.item.el.classList.add("is-dragging");
	});
	if (target.setPointerCapture) {
		target.setPointerCapture(event.pointerId);
	}
	handleMove(event);
}

function handleMove(event) {
	if (pendingDrag && event.pointerId === pendingDrag.pointerId) {
		const dx = event.clientX - pendingDrag.startX;
		const dy = event.clientY - pendingDrag.startY;
		if (Math.hypot(dx, dy) >= 4) {
			beginDrag(event);
		}
	}
	if (!isDragging || !dragItem || !dragGroup) return;
	const step = event.ctrlKey ? chunkSize : 1;
	const snap = getCenteredSnapPoint(
		event.clientX,
		event.clientY,
		dragItem.w,
		dragItem.h,
		step,
	);
	if (!snap) return;
	const applyGroupMove = (anchorX, anchorY) => {
		const clamped = clampGroupAnchor(anchorX, anchorY, dragGroup.items);
		const canMove = dragGroup.items.every((entry) => {
			const nextX = clamped.x + entry.dx;
			const nextY = clamped.y + entry.dy;
			return canPlaceAt(
				nextX,
				nextY,
				entry.item.w,
				entry.item.h,
				selectedPlaced,
			);
		});
		if (!canMove) return false;
		dragGroup.items.forEach((entry) => {
			const nextX = clamped.x + entry.dx;
			const nextY = clamped.y + entry.dy;
			entry.item.x = nextX;
			entry.item.y = nextY;
			entry.item.el.style.left = `${nextX * cellSize}px`;
			entry.item.el.style.top = `${nextY * cellSize}px`;
		});
		return true;
	};
	if (applyGroupMove(snap.x, snap.y)) return;
	const currentX = dragItem.x;
	const currentY = dragItem.y;
	if (applyGroupMove(snap.x, currentY)) return;
	applyGroupMove(currentX, snap.y);
}

function finishDrag(event) {
	if (pendingDrag && event.pointerId === pendingDrag.pointerId) {
		pendingDrag = null;
	}
	if (!isDragging || !dragItem || !dragGroup) return;
	const element = dragItem.el;
	dragGroup.items.forEach((entry) => {
		entry.item.el.classList.remove("is-dragging");
	});
	isDragging = false;
	dragItem = null;
	dragGroup = null;
	scheduleAutoSave();
	if (selectedPrimary) showMenuFor(selectedPrimary);
	if (event && element.releasePointerCapture) {
		try {
			element.releasePointerCapture(event.pointerId);
		} catch {
			// Pointer capture may already be released.
		}
	}
	setTimeout(() => {
		suppressClick = false;
	}, 0);
}

function clearSelection() {
	selectedPlaced.forEach((el) => el.classList.remove("is-selected"));
	selectedPlaced.clear();
	selectedPrimary = null;
}

function selectPlaced(element, additive = false) {
	if (!additive) {
		clearSelection();
		selectedPlaced.add(element);
		selectedPrimary = element;
		element.classList.add("is-selected");
		showMenuFor(element);
		return;
	}
	if (selectedPlaced.has(element)) {
		element.classList.remove("is-selected");
		selectedPlaced.delete(element);
		if (selectedPrimary === element) {
			selectedPrimary = selectedPlaced.values().next().value || null;
		}
	} else {
		selectedPlaced.add(element);
		selectedPrimary = element;
		element.classList.add("is-selected");
	}
	if (selectedPrimary) {
		showMenuFor(selectedPrimary);
	} else {
		hideMenu(true);
	}
}

function showMenuFor(element) {
	const item = placedSquares.find((placed) => placed.el === element);
	if (!item) return;
	hidePathMenu();
	actionMenu.style.display = "flex";
	const menuWidth = actionMenu.offsetWidth;
	const menuHeight = actionMenu.offsetHeight;
	let left = (item.x + item.w) * cellSize + 8;
	let top = item.y * cellSize;
	if (left + menuWidth > gridWidth) {
		left = item.x * cellSize - menuWidth - 8;
	}
	if (left < 0) left = 0;
	if (top + menuHeight > gridHeight) {
		top = gridHeight - menuHeight;
	}
	if (top < 0) top = 0;
	actionMenu.style.left = `${left}px`;
	actionMenu.style.top = `${top}px`;
}

function hideMenu(preserveSelection = false) {
	actionMenu.style.display = "none";
	if (!preserveSelection && selectedPlaced.size) {
		clearSelection();
	}
}

function deleteSelected() {
	if (!selectedPlaced.size) return;
	pushUndoState();
	const toDelete = Array.from(selectedPlaced);
	for (let i = placedSquares.length - 1; i >= 0; i -= 1) {
		if (selectedPlaced.has(placedSquares[i].el)) {
			placedSquares.splice(i, 1);
		}
	}
	toDelete.forEach((el) => el.remove());
	clearSelection();
	duplicateMode = false;
	hideMenu();
	scheduleAutoSave();
}

function rotateSelected() {
	if (!selectedPrimary) return;
	const item = placedSquares.find((placed) => placed.el === selectedPrimary);
	if (!item) return;
	const nextW = item.h;
	const nextH = item.w;
	const centerX = item.x + item.w / 2;
	const centerY = item.y + item.h / 2;
	const desiredX = Math.round(centerX - nextW / 2);
	const desiredY = Math.round(centerY - nextH / 2);
	const clamped = clampToBounds(desiredX, desiredY, nextW, nextH);
	if (!canPlaceAt(clamped.x, clamped.y, nextW, nextH, item.el)) return;
	pushUndoState();
	item.w = nextW;
	item.h = nextH;
	item.x = clamped.x;
	item.y = clamped.y;
	item.el.style.width = `${cellSize * item.w}px`;
	item.el.style.height = `${cellSize * item.h}px`;
	item.el.style.left = `${item.x * cellSize}px`;
	item.el.style.top = `${item.y * cellSize}px`;
	showMenuFor(item.el);
	scheduleAutoSave();
}

function moveSelectedBy(dx, dy) {
	if (!selectedPlaced.size) return false;
	const items = Array.from(selectedPlaced)
		.map((el) => placedSquares.find((placed) => placed.el === el))
		.filter(Boolean);
	if (!items.length) return false;
	const canMove = items.every((item) => {
		const nextX = item.x + dx;
		const nextY = item.y + dy;
		if (nextX < 0 || nextY < 0 || nextX + item.w > cols || nextY + item.h > rows)
			return false;
		return canPlaceAt(nextX, nextY, item.w, item.h, selectedPlaced);
	});
	if (!canMove) return false;
	pushUndoState();
	items.forEach((item) => {
		item.x += dx;
		item.y += dy;
		item.el.style.left = `${item.x * cellSize}px`;
		item.el.style.top = `${item.y * cellSize}px`;
	});
	if (selectedPrimary) showMenuFor(selectedPrimary);
	scheduleAutoSave();
	return true;
}

async function loadStyle(file) {
	const response = await fetch(file);
	if (!response.ok) throw new Error("Failed to load style file.");
	return response.json();
}

async function applyStyle(file) {
	const styleEntry = STYLE_FILES.find((entry) => entry.file === file);
	activeStyleId = styleEntry ? styleEntry.id : activeStyleId;
	try {
		const data = await loadStyle(file);
		shapes = Array.isArray(data.shapes) ? data.shapes : [];
		const availableTabs = new Set(
			shapes.map((shape) => shape.category || "farming"),
		);
		if (!availableTabs.has(activeTab)) {
			activeTab = availableTabs.values().next().value || "farming";
		}
		renderTabs();
		renderSubTabs();
		renderShapeTray();
		selectedShapeId = null;
	} catch (error) {
		console.error(error);
		shapes = [];
		renderTabs();
		renderSubTabs();
		renderShapeTray();
		selectedShapeId = null;
	}
}

styleSelect.addEventListener("change", (event) => {
	applyStyle(event.target.value);
});
grid.addEventListener("click", (event) => {
	if (event.target.closest(".action-menu")) return;
	if (event.target.closest(".path-action-menu")) return;
	if (event.target.closest(".path-resize-handle")) return;
	if (suppressPathClick) return;
	hidePathMenu();
	if (!pathToolActive) {
		const pathEl = event.target.closest(".placed-path");
		if (pathEl) {
			const pathId = pathEl.dataset.pathId;
			if (pathId) {
				selectPath(pathId);
				showPathMenuFor(pathId);
			}
			return;
		}
	}
	if (!event.target.closest(".placed-square") && !duplicateMode) hideMenu();
	if (pathToolActive) return;
	if (duplicateMode) {
		const cell = event.target.closest(".grid-cell");
		if (!cell) return;
		const x = Number(cell.dataset.x);
		const y = Number(cell.dataset.y);
		const step = event.ctrlKey ? chunkSize : 1;
		if (!duplicateGroup) return;
		const anchor = duplicateGroup.anchor;
		const snap = snapToGrid(x, y, anchor?.w || 1, anchor?.h || 1, step);
		if (!snap) return;
		if (!anchor) return;
		const nextPositions = duplicateGroup.items.map((entry) => {
			const nextX = snap.x + entry.dx;
			const nextY = snap.y + entry.dy;
			return { entry, x: nextX, y: nextY };
		});
		const fits = nextPositions.every(({ entry, x: nextX, y: nextY }) => {
			if (nextX < 0 || nextY < 0) return false;
			if (nextX + entry.item.w > cols || nextY + entry.item.h > rows)
				return false;
			return canPlaceAt(nextX, nextY, entry.item.w, entry.item.h);
		});
		if (!fits) return;
		pushUndoState();
		nextPositions.forEach(({ entry, x: nextX, y: nextY }) => {
			placeSquare(nextX, nextY, entry.item);
		});
		duplicateMode = false;
		duplicateGroup = null;
		return;
	}
	if (suppressClick) return;
	const selectedShape = getSelectedShape();
	if (!selectedShape) return;
	const { w: shapeW, h: shapeH } = getSelectedShapeDimensions(selectedShape);
	const cell = event.target.closest(".grid-cell");
	if (!cell) return;
	const x = Number(cell.dataset.x);
	const y = Number(cell.dataset.y);
	const step = event.ctrlKey ? chunkSize : 1;
	const snap = snapToGrid(x, y, shapeW, shapeH, step);
	if (!snap) return;
	if (snap.x + shapeW > cols || snap.y + shapeH > rows) return;
	if (!canPlaceAt(snap.x, snap.y, shapeW, shapeH)) return;
	pushUndoState();
	placeSquare(snap.x, snap.y, { ...selectedShape, w: shapeW, h: shapeH });
	selectedShapeId = null;
	pendingRotated = false;
	renderShapeTray();
});

document.addEventListener("pointermove", handleMove);
document.addEventListener("pointerup", finishDrag);
document.addEventListener("pointercancel", finishDrag);
actionMenu.addEventListener("click", (event) => {
	const button = event.target.closest("button");
	if (!button) return;
	const action = button.dataset.action;
	if (action === "rotate") rotateSelected();
	if (action === "delete") deleteSelected();
	if (action === "duplicate") {
		if (!selectedPlaced.size) return;
		const selectedItems = Array.from(selectedPlaced)
			.map((el) => placedSquares.find((placed) => placed.el === el))
			.filter(Boolean);
		const anchor =
			placedSquares.find((placed) => placed.el === selectedPrimary) ||
			selectedItems[0];
		if (!anchor) return;
		duplicateMode = true;
		duplicateGroup = {
			anchor,
			items: selectedItems.map((item) => ({
				item,
				dx: item.x - anchor.x,
				dy: item.y - anchor.y,
			})),
		};
		hideMenu(true);
	}
});
document.addEventListener("click", (event) => {
	if (event.target.closest(".action-menu")) return;
	if (event.target.closest(".placed-square")) return;
	hideMenu();
});

// ----- Path tool helpers and handlers -----
function getCellFromPoint(clientX, clientY) {
	const rect = grid.getBoundingClientRect();
	const x = Math.floor((clientX - rect.left) / cellSize);
	const y = Math.floor((clientY - rect.top) / cellSize);
	if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
	return { x, y };
}

function bresenhamLine(x0, y0, x1, y1) {
	// Orthogonal path: only move in one direction (horizontal OR vertical, not both)
	const cells = [];
	const dx = Math.abs(x1 - x0);
	const dy = Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;

	if (dx >= dy) {
		let x = x0;
		while (x !== x1) {
			cells.push({ x, y: y0 });
			x += sx;
		}
		cells.push({ x: x1, y: y0 });
	} else {
		let y = y0;
		while (y !== y1) {
			cells.push({ x: x0, y });
			y += sy;
		}
		cells.push({ x: x0, y: y1 });
	}
	return cells;
}

function thickCellsFromLine(lineCells, width) {
	const r = Math.floor(width / 2);
	const set = new Set();
	lineCells.forEach(({ x, y }) => {
		for (let dx = -r; dx <= r; dx++) {
			for (let dy = -r; dy <= r; dy++) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
				set.add(`${nx},${ny}`);
			}
		}
	});
	return Array.from(set).map((s) => {
		const [x, y] = s.split(",").map(Number);
		return { x, y };
	});
}

function buildGlobalCellSet() {
	const set = new Set();
	for (const p of paths) {
		for (const c of p.cells) set.add(`${c.x},${c.y}`);
	}
	return set;
}

function rebuildPathCells(path) {
	const line = bresenhamLine(path.from.x, path.from.y, path.to.x, path.to.y);
	path.cells = thickCellsFromLine(line, pathWidth);
}

function renderPathDOM(path, globalCellSet) {
	path.elements.forEach((el) => el.remove());
	path.elements = [];

	const cells = path.cells;
	if (cells.length === 0) return;

	const xs = cells.map((c) => c.x);
	const ys = cells.map((c) => c.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);

	const container = document.createElement("div");
	container.className = "placed-path";
	if (selectedPathId === path.id) container.classList.add("is-selected");
	container.style.position = "absolute";
	container.style.left = `${minX * cellSize}px`;
	container.style.top = `${minY * cellSize}px`;
	container.style.width = `${(maxX - minX + 1) * cellSize}px`;
	container.style.height = `${(maxY - minY + 1) * cellSize}px`;
	container.style.pointerEvents = "auto";
	container.dataset.pathId = path.id;

	for (const cell of cells) {
		const relX = cell.x - minX;
		const relY = cell.y - minY;
		const hasLeft = globalCellSet.has(`${cell.x - 1},${cell.y}`);
		const hasRight = globalCellSet.has(`${cell.x + 1},${cell.y}`);
		const hasTop = globalCellSet.has(`${cell.x},${cell.y - 1}`);
		const hasBottom = globalCellSet.has(`${cell.x},${cell.y + 1}`);

		const cellEl = document.createElement("div");
		cellEl.style.position = "absolute";
		cellEl.style.left = `${relX * cellSize}px`;
		cellEl.style.top = `${relY * cellSize}px`;
		cellEl.style.width = `${cellSize}px`;
		cellEl.style.height = `${cellSize}px`;
		cellEl.style.background =
			selectedPathId === path.id
				? "var(--path-cell-bg-selected)"
				: "var(--path-cell-bg)";
		cellEl.style.pointerEvents = "none";
		cellEl.style.boxSizing = "border-box";

		const border = "1px solid var(--path-cell-border)";
		if (!hasTop) cellEl.style.borderTop = border;
		if (!hasBottom) cellEl.style.borderBottom = border;
		if (!hasLeft) cellEl.style.borderLeft = border;
		if (!hasRight) cellEl.style.borderRight = border;

		container.appendChild(cellEl);
	}

	grid.appendChild(container);
	path.elements = [container];
}

function rerenderAllPathBorders() {
	const globalCellSet = buildGlobalCellSet();
	for (const path of paths) renderPathDOM(path, globalCellSet);
	if (selectedPathId) {
		const path = paths.find((p) => p.id === selectedPathId);
		if (path) {
			if (pathResizing) {
				// Don't recreate handles mid-drag — just move them so pointer capture is preserved
				updatePathHandlePositions(path);
			} else {
				showPathHandles(path);
			}
		}
	}
}

function clearPathPreview() {
	while (pathPreviewEls.length) pathPreviewEls.pop().remove();
}

function showPathPreview(cells) {
	clearPathPreview();
	if (cells.length === 0) return;

	const xs = cells.map((c) => c.x);
	const ys = cells.map((c) => c.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);

	const container = document.createElement("div");
	container.className = "path-preview";
	container.style.position = "absolute";
	container.style.left = `${minX * cellSize}px`;
	container.style.top = `${minY * cellSize}px`;
	container.style.width = `${(maxX - minX + 1) * cellSize}px`;
	container.style.height = `${(maxY - minY + 1) * cellSize}px`;
	container.style.pointerEvents = "none";

	// Use global cell set so preview respects existing path borders
	const globalCellSet = buildGlobalCellSet();
	const previewSet = new Set(cells.map((c) => `${c.x},${c.y}`));

	for (const cell of cells) {
		const relX = cell.x - minX;
		const relY = cell.y - minY;
		const hasLeft =
			globalCellSet.has(`${cell.x - 1},${cell.y}`) ||
			previewSet.has(`${cell.x - 1},${cell.y}`);
		const hasRight =
			globalCellSet.has(`${cell.x + 1},${cell.y}`) ||
			previewSet.has(`${cell.x + 1},${cell.y}`);
		const hasTop =
			globalCellSet.has(`${cell.x},${cell.y - 1}`) ||
			previewSet.has(`${cell.x},${cell.y - 1}`);
		const hasBottom =
			globalCellSet.has(`${cell.x},${cell.y + 1}`) ||
			previewSet.has(`${cell.x},${cell.y + 1}`);

		const cellEl = document.createElement("div");
		cellEl.style.position = "absolute";
		cellEl.style.left = `${relX * cellSize}px`;
		cellEl.style.top = `${relY * cellSize}px`;
		cellEl.style.width = `${cellSize}px`;
		cellEl.style.height = `${cellSize}px`;
		cellEl.style.background = "var(--path-preview-bg)";
		cellEl.style.pointerEvents = "none";
		cellEl.style.boxSizing = "border-box";

		const border = "1px dashed var(--path-preview-border)";
		if (!hasTop) cellEl.style.borderTop = border;
		if (!hasBottom) cellEl.style.borderBottom = border;
		if (!hasLeft) cellEl.style.borderLeft = border;
		if (!hasRight) cellEl.style.borderRight = border;

		container.appendChild(cellEl);
	}

	grid.appendChild(container);
	pathPreviewEls.push(container);
}

function findNodeNear(x, y, threshold = 1) {
	return (
		pathNodes.find((n) => Math.hypot(n.x - x, n.y - y) <= threshold) || null
	);
}

function findBuildingEdgeSnapValue(coord, axis, threshold) {
	let best = null;
	let bestDist = Infinity;
	placedSquares.forEach((b) => {
		const edges = axis === "x" ? [b.x, b.x + b.w] : [b.y, b.y + b.h];
		edges.forEach((edge) => {
			const dist = Math.abs(edge - coord);
			if (dist <= threshold && dist < bestDist) {
				bestDist = dist;
				best = edge;
			}
		});
	});
	return best;
}

function addNode(x, y) {
	const id = `node_${nextNodeId++}`;
	const node = { id, x, y };
	pathNodes.push(node);
	return node;
}

function syncPathNodesFromPaths() {
	const unique = new Map();
	for (const path of paths) {
		const fromKey = `${path.from.x},${path.from.y}`;
		if (!unique.has(fromKey))
			unique.set(fromKey, { x: path.from.x, y: path.from.y });
		const toKey = `${path.to.x},${path.to.y}`;
		if (!unique.has(toKey)) unique.set(toKey, { x: path.to.x, y: path.to.y });
	}
	pathNodes.length = 0;
	let idx = 1;
	for (const pos of unique.values()) {
		pathNodes.push({ id: `node_${idx++}`, x: pos.x, y: pos.y });
	}
	nextNodeId = Math.max(nextNodeId, idx);
}

function isPathOutOfBounds(path) {
	const r = Math.floor(pathWidth / 2);
	const minX = Math.min(path.from.x, path.to.x) - r;
	const maxX = Math.max(path.from.x, path.to.x) + r;
	const minY = Math.min(path.from.y, path.to.y) - r;
	const maxY = Math.max(path.from.y, path.to.y) + r;
	return minX < 0 || minY < 0 || maxX >= cols || maxY >= rows;
}

function clampPathToBounds(path) {
	const r = Math.floor(pathWidth / 2);
	const minX = Math.min(path.from.x, path.to.x) - r;
	const maxX = Math.max(path.from.x, path.to.x) + r;
	const minY = Math.min(path.from.y, path.to.y) - r;
	const maxY = Math.max(path.from.y, path.to.y) + r;
	const spanX = maxX - minX + 1;
	const spanY = maxY - minY + 1;

	if (spanX > cols || spanY > rows) return false;

	let dx = 0;
	let dy = 0;
	if (minX < 0) dx = -minX;
	else if (maxX >= cols) dx = cols - 1 - maxX;
	if (minY < 0) dy = -minY;
	else if (maxY >= rows) dy = rows - 1 - maxY;

	if (dx || dy) {
		path.from.x += dx;
		path.from.y += dy;
		path.to.x += dx;
		path.to.y += dy;
		rebuildPathCells(path);
	}

	return true;
}

function shiftPaths(dx, dy) {
	if (!dx && !dy) return;
	for (const path of paths) {
		path.from.x += dx;
		path.from.y += dy;
		path.to.x += dx;
		path.to.y += dy;
		rebuildPathCells(path);
	}
	syncPathNodesFromPaths();
	rerenderAllPathBorders();
	if (selectedPathId && paths.some((p) => p.id === selectedPathId)) {
		showPathMenuFor(selectedPathId);
	}
}

function prunePathsOutOfBounds() {
	let removedSelected = false;
	for (let i = paths.length - 1; i >= 0; i -= 1) {
		const path = paths[i];
		if (!isPathOutOfBounds(path)) continue;
		const clamped = clampPathToBounds(path);
		if (clamped) continue;
		if (path.id === selectedPathId) removedSelected = true;
		path.elements.forEach((el) => el.remove());
		paths.splice(i, 1);
	}
	if (removedSelected) {
		selectedPathId = null;
		pathActionMenu.style.display = "none";
		hidePathHandles();
	}
	syncPathNodesFromPaths();
	rerenderAllPathBorders();
	if (selectedPathId && paths.some((p) => p.id === selectedPathId)) {
		showPathMenuFor(selectedPathId);
	}
}

function createPath(startCell, endCell) {
	if (!startCell || !endCell) return;
	pushUndoState();
	const snapThreshold = 1;
	const nearStart = findNodeNear(startCell.x, startCell.y, snapThreshold);
	const fromPos = nearStart
		? { x: nearStart.x, y: nearStart.y }
		: { x: startCell.x, y: startCell.y };
	if (!nearStart) {
		const edgeX = findBuildingEdgeSnapValue(fromPos.x, "x", snapThreshold);
		const edgeY = findBuildingEdgeSnapValue(fromPos.y, "y", snapThreshold);
		if (edgeX !== null) fromPos.x = edgeX;
		if (edgeY !== null) fromPos.y = edgeY;
		addNode(fromPos.x, fromPos.y);
	}

	// Compute the actual endpoint after direction clamping (bresenhamLine picks H or V only)
	const line = bresenhamLine(fromPos.x, fromPos.y, endCell.x, endCell.y);
	const actualEnd = line[line.length - 1];

	// Snap around the clamped endpoint, not the raw mouse position
	const nearEnd = findNodeNear(actualEnd.x, actualEnd.y, snapThreshold);
	const toPos = nearEnd
		? { x: nearEnd.x, y: nearEnd.y }
		: { x: actualEnd.x, y: actualEnd.y };
	if (!nearEnd) {
		const freeAxis = actualEnd.y === fromPos.y ? "x" : "y";
		const edgeValue = findBuildingEdgeSnapValue(
			freeAxis === "x" ? toPos.x : toPos.y,
			freeAxis,
			snapThreshold,
		);
		if (edgeValue !== null) {
			if (freeAxis === "x") toPos.x = edgeValue;
			else toPos.y = edgeValue;
		}
		addNode(toPos.x, toPos.y);
	}

	const id = `path_${nextPathId++}`;
	const path = {
		id,
		from: { ...fromPos },
		to: { ...toPos },
		cells: [],
		elements: [],
	};
	rebuildPathCells(path);
	paths.push(path);
	rerenderAllPathBorders();
	scheduleAutoSave();
}

// ----- Path resize handles -----
let pathResizing = false;
let pathResizeId = null;
let pathResizeEnd = null; // 'from' or 'to'
let pathResizeOriginalPos = null;
let pathResizeChanged = false;
const pathHandleEls = [];

function showPathHandles(path) {
	hidePathHandles();
	[
		{ end: "from", pos: path.from },
		{ end: "to", pos: path.to },
	].forEach(({ end, pos }) => {
		const handle = document.createElement("div");
		handle.className = "path-resize-handle";
		const hs = cellSize * 3;
		handle.style.position = "absolute";
		handle.style.left = `${pos.x * cellSize - (hs - cellSize) / 2}px`;
		handle.style.top = `${pos.y * cellSize - (hs - cellSize) / 2}px`;
		handle.style.width = `${hs}px`;
		handle.style.height = `${hs}px`;
		handle.style.background = "var(--path-resize-handle-bg)";
		handle.style.border = "2px solid var(--path-resize-handle-border)";
		handle.style.borderRadius = "50%";
		handle.style.cursor = "grab";
		handle.style.zIndex = "20";
		handle.style.pointerEvents = "auto";
		handle.dataset.pathId = path.id;
		handle.dataset.end = end;

		handle.addEventListener("pointerdown", (e) => {
			e.stopPropagation();
			e.preventDefault();
			pathResizing = true;
			pathResizeId = path.id;
			pathResizeEnd = end;
			pathResizeOriginalPos =
				end === "from" ? { ...path.from } : { ...path.to };
			pathResizeChanged = false;
			handle.style.cursor = "grabbing";
			handle.setPointerCapture(e.pointerId);
		});

		handle.addEventListener("pointermove", (e) => {
			if (!pathResizing || pathResizeId !== path.id) return;
			const cell = getCellFromPoint(e.clientX, e.clientY);
			if (!cell) return;
			const p = paths.find((pt) => pt.id === pathResizeId);
			if (!p) return;

			// Determine axis from the fixed endpoint vs the original drag start position
			const fixedPos = pathResizeEnd === "from" ? p.to : p.from;
			const origPos = pathResizeOriginalPos;
			const isHorizontal =
				Math.abs(origPos.x - fixedPos.x) >= Math.abs(origPos.y - fixedPos.y);

			// Constrain cell to the correct axis
			const constrained = isHorizontal
				? { x: cell.x, y: fixedPos.y }
				: { x: fixedPos.x, y: cell.y };

			// Snap to existing node along the same axis
			const snapThreshold = 2;
			const nearbyNode = pathNodes.find(
				(n) =>
					Math.hypot(n.x - constrained.x, n.y - constrained.y) <= snapThreshold,
			);
			let snapped;
			if (nearbyNode) {
				snapped = isHorizontal
					? { x: nearbyNode.x, y: fixedPos.y }
					: { x: fixedPos.x, y: nearbyNode.y };
			} else {
				const axis = isHorizontal ? "x" : "y";
				const coord = isHorizontal ? constrained.x : constrained.y;
				const edgeSnap = findBuildingEdgeSnapValue(coord, axis, snapThreshold);
				snapped =
					edgeSnap !== null
						? isHorizontal
							? { x: edgeSnap, y: fixedPos.y }
							: { x: fixedPos.x, y: edgeSnap }
						: constrained;
			}

			if (!pathResizeChanged) {
				pushUndoState();
				pathResizeChanged = true;
			}
			if (pathResizeEnd === "from") p.from = { ...snapped };
			else p.to = { ...snapped };

			rebuildPathCells(p);
			rerenderAllPathBorders();
		});

		handle.addEventListener("pointerup", () => {
			if (!pathResizing) return;
			pathResizing = false;
			pathResizeId = null;
			pathResizeEnd = null;
			pathResizeOriginalPos = null;
			handle.style.cursor = "grab";
			scheduleAutoSave();
		});

		handle.addEventListener("pointercancel", () => {
			if (!pathResizing) return;
			const p = paths.find((pt) => pt.id === pathResizeId);
			if (p && pathResizeOriginalPos) {
				if (pathResizeEnd === "from") p.from = { ...pathResizeOriginalPos };
				else p.to = { ...pathResizeOriginalPos };
				rebuildPathCells(p);
				rerenderAllPathBorders();
			}
			pathResizing = false;
			pathResizeId = null;
			pathResizeEnd = null;
			pathResizeOriginalPos = null;
		});

		grid.appendChild(handle);
		pathHandleEls.push(handle);
	});
}

function hidePathHandles() {
	while (pathHandleEls.length) pathHandleEls.pop().remove();
}

function updatePathHandlePositions(path) {
	const hs = cellSize * 3;
	for (const handle of pathHandleEls) {
		if (handle.dataset.pathId !== path.id) continue;
		const pos = handle.dataset.end === "from" ? path.from : path.to;
		handle.style.left = `${pos.x * cellSize - (hs - cellSize) / 2}px`;
		handle.style.top = `${pos.y * cellSize - (hs - cellSize) / 2}px`;
	}
}

function togglePathTool(on) {
	pathToolActive = typeof on === "boolean" ? on : !pathToolActive;
	pathToggle.classList.toggle("is-active", pathToolActive);
	if (!pathToolActive) {
		clearPathPreview();
	}
}

// Pointer handlers for drawing and dragging
grid.addEventListener("pointerdown", (e) => {
	if (e.target.classList.contains("path-resize-handle")) return;

	// Path drag: clicking a selected path while NOT in path-draw mode
	if (!pathToolActive && selectedPathId) {
		const pathEl = e.target.closest(".placed-path");
		if (pathEl && pathEl.dataset.pathId === selectedPathId) {
			const cell = getCellFromPoint(e.clientX, e.clientY);
			if (!cell) return;
			const p = paths.find((pt) => pt.id === selectedPathId);
			if (!p) return;
			pathDragPending = {
				pointerId: e.pointerId,
				startCell: { ...cell },
				pathId: selectedPathId,
				origFrom: { ...p.from },
				origTo: { ...p.to },
			};
			grid.setPointerCapture(e.pointerId);
			e.preventDefault();
			return;
		}
	}

	if (!pathToolActive) return;
	const cell = getCellFromPoint(e.clientX, e.clientY);
	if (!cell) return;
	pathDrawing = true;
	pathStartCell = cell;
	e.preventDefault();
});

grid.addEventListener("pointermove", (e) => {
	// Path drag move
	if (pathDragPending && e.pointerId === pathDragPending.pointerId) {
		const cell = getCellFromPoint(e.clientX, e.clientY);
		if (cell) {
			const dx = cell.x - pathDragPending.startCell.x;
			const dy = cell.y - pathDragPending.startCell.y;
			if (!pathDragging && (Math.abs(dx) >= 1 || Math.abs(dy) >= 1)) {
				pathDragging = true;
				suppressPathClick = true;
				pushUndoState();
			}
			if (pathDragging) {
				const p = paths.find((pt) => pt.id === pathDragPending.pathId);
				if (p) {
					p.from = {
						x: pathDragPending.origFrom.x + dx,
						y: pathDragPending.origFrom.y + dy,
					};
					p.to = {
						x: pathDragPending.origTo.x + dx,
						y: pathDragPending.origTo.y + dy,
					};
					rebuildPathCells(p);
					rerenderAllPathBorders();
				}
			}
		}
		return;
	}

	if (!pathDrawing) return;
	const cell = getCellFromPoint(e.clientX, e.clientY);
	if (!cell) {
		clearPathPreview();
		return;
	}
	const snapThreshold = 2;
	const nearbyNode = pathNodes.find(
		(n) => Math.hypot(n.x - cell.x, n.y - cell.y) <= snapThreshold,
	);
	let endCell = nearbyNode ? { x: nearbyNode.x, y: nearbyNode.y } : { ...cell };
	if (!nearbyNode) {
		const previewLine = bresenhamLine(
			pathStartCell.x,
			pathStartCell.y,
			cell.x,
			cell.y,
		);
		const previewEnd = previewLine[previewLine.length - 1];
		const freeAxis = previewEnd.y === pathStartCell.y ? "x" : "y";
		const edgeValue = findBuildingEdgeSnapValue(
			freeAxis === "x" ? previewEnd.x : previewEnd.y,
			freeAxis,
			snapThreshold,
		);
		endCell = { ...previewEnd };
		if (edgeValue !== null) {
			if (freeAxis === "x") endCell.x = edgeValue;
			else endCell.y = edgeValue;
		}
	}
	const line = bresenhamLine(
		pathStartCell.x,
		pathStartCell.y,
		endCell.x,
		endCell.y,
	);
	const thick = thickCellsFromLine(line, pathWidth);
	showPathPreview(thick);
});

grid.addEventListener("pointerup", (e) => {
	// Path drag end
	if (pathDragPending && e.pointerId === pathDragPending.pointerId) {
		if (pathDragging) {
			// Update nodes that lived at the original endpoints
			const p = paths.find((pt) => pt.id === pathDragPending.pathId);
			if (p) {
				const fromNode = pathNodes.find(
					(n) =>
						n.x === pathDragPending.origFrom.x &&
						n.y === pathDragPending.origFrom.y,
				);
				if (fromNode) {
					fromNode.x = p.from.x;
					fromNode.y = p.from.y;
				}
				const toNode = pathNodes.find(
					(n) =>
						n.x === pathDragPending.origTo.x &&
						n.y === pathDragPending.origTo.y,
				);
				if (toNode) {
					toNode.x = p.to.x;
					toNode.y = p.to.y;
				}
			}
			scheduleAutoSave();
		}
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {}
		pathDragPending = null;
		pathDragging = false;
		setTimeout(() => {
			suppressPathClick = false;
		}, 0);
		return;
	}

	if (!pathDrawing) return;
	const cell = getCellFromPoint(e.clientX, e.clientY);
	if (cell && (cell.x !== pathStartCell.x || cell.y !== pathStartCell.y)) {
		createPath(pathStartCell, cell);
	}
	pathDrawing = false;
	pathStartCell = null;
	clearPathPreview();
});

// toggle via keyboard key 'p'
document.addEventListener("keydown", (e) => {
	if (e.key === "p" || e.key === "P") togglePathTool(true);
});
document.addEventListener("keyup", (e) => {
	if (e.key === "p" || e.key === "P") togglePathTool(false);
});

// ----- Path menu and selection -----
function selectPath(pathId) {
	selectedPathId = pathId;
	rerenderAllPathBorders();
}

function showPathMenuFor(pathId) {
	const path = paths.find((p) => p.id === pathId);
	if (!path || !path.elements.length) return;
	hideMenu(true);
	pathActionMenu.style.display = "flex";
	const menuWidth = pathActionMenu.offsetWidth;
	const menuHeight = pathActionMenu.offsetHeight;
	const firstEl = path.elements[0];
	const rect = firstEl.getBoundingClientRect();
	const gridRect = grid.getBoundingClientRect();
	let left = rect.right - gridRect.left + 8;
	let top = rect.top - gridRect.top;
	if (left + menuWidth > gridWidth) {
		left = rect.left - gridRect.left - menuWidth - 8;
	}
	if (left < 0) left = 0;
	if (top + menuHeight > gridHeight) top = gridHeight - menuHeight;
	if (top < 0) top = 0;
	pathActionMenu.style.left = `${left}px`;
	pathActionMenu.style.top = `${top}px`;
}

function hidePathMenu() {
	pathActionMenu.style.display = "none";
	selectedPathId = null;
	hidePathHandles();
	rerenderAllPathBorders();
}

function deleteSelectedPath() {
	if (!selectedPathId) return;
	const pathIdx = paths.findIndex((p) => p.id === selectedPathId);
	if (pathIdx < 0) return;
	pushUndoState();
	const path = paths[pathIdx];
	path.elements.forEach((el) => el.remove());
	paths.splice(pathIdx, 1);
	hidePathHandles();
	selectedPathId = null;
	pathActionMenu.style.display = "none";
	rerenderAllPathBorders();
	scheduleAutoSave();
}

pathActionMenu.addEventListener("click", (event) => {
	const button = event.target.closest("button");
	if (!button) return;
	const action = button.dataset.pathAction;
	if (action === "delete") deleteSelectedPath();
});

// ----- Image export -----
const CATEGORY_LIST = [
	"farming",
	"craftsmanship",
	"decoration",
	"education",
	"fundamentals",
	"infrastructure",
	"military",
	"mystic",
	"walls",
];
const categorySwatches = {};
CATEGORY_LIST.forEach((category) => {
	const swatch = document.createElement("div");
	swatch.className = `category-${category}`;
	swatch.style.position = "absolute";
	swatch.style.width = "0";
	swatch.style.height = "0";
	swatch.style.overflow = "hidden";
	swatch.style.opacity = "0";
	swatch.style.pointerEvents = "none";
	document.body.appendChild(swatch);
	categorySwatches[category] = swatch;
});

function getCategoryColors(category) {
	const swatch = categorySwatches[category] || categorySwatches.farming;
	const style = getComputedStyle(swatch);
	return {
		fill: style.getPropertyValue("--category-color").trim() || "#d8c4a8",
		border: style.getPropertyValue("--category-border").trim() || "#b59a7a",
	};
}

function exportPlanAsPNG() {
	const width = cols * cellSize;
	const height = rows * cellSize;
	if (width > 8000 || height > 8000) {
		console.warn("Plan is very large; PNG export may be slow or fail.");
	}
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");

	const rootStyle = getComputedStyle(document.documentElement);
	const gridBg = rootStyle.getPropertyValue("--grid-bg").trim() || "#1e1e1e";
	const gridLine =
		rootStyle.getPropertyValue("--grid-line").trim() || "#3a3a3a";
	const pathBg =
		rootStyle.getPropertyValue("--path-cell-bg").trim() ||
		"rgba(100,180,220,0.4)";
	const badgeInk =
		rootStyle.getPropertyValue("--accent-ink").trim() || "#0f1115";

	ctx.fillStyle = gridBg;
	ctx.fillRect(0, 0, width, height);

	ctx.strokeStyle = gridLine;
	ctx.lineWidth = 1;
	for (let x = 0; x <= cols; x += chunkSize) {
		ctx.beginPath();
		ctx.moveTo(x * cellSize, 0);
		ctx.lineTo(x * cellSize, height);
		ctx.stroke();
	}
	for (let y = 0; y <= rows; y += chunkSize) {
		ctx.beginPath();
		ctx.moveTo(0, y * cellSize);
		ctx.lineTo(width, y * cellSize);
		ctx.stroke();
	}

	ctx.fillStyle = pathBg;
	paths.forEach((path) => {
		path.cells.forEach((cell) => {
			ctx.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
		});
	});

	placedSquares.forEach((placed) => {
		const colors = getCategoryColors(placed.category);
		const x = placed.x * cellSize;
		const y = placed.y * cellSize;
		const w = placed.w * cellSize;
		const h = placed.h * cellSize;
		ctx.fillStyle = colors.fill;
		ctx.fillRect(x, y, w, h);
		ctx.strokeStyle = colors.border;
		ctx.lineWidth = 2;
		ctx.strokeRect(x, y, w, h);

		const fontSize = getBadgeFontSize(placed.w, placed.h);
		ctx.fillStyle = badgeInk;
		ctx.font = `700 ${fontSize}px "Segoe UI", sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const label = `${placed.emoji || defaultEmoji} ${placed.label}`;
		ctx.fillText(label, x + w / 2, y + h / 2, Math.max(w - 8, 4));
	});

	canvas.toBlob((blob) => {
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `minecolonies-plan-${Date.now()}.png`;
		link.click();
		URL.revokeObjectURL(url);
	}, "image/png");
}

// ----- Save / Load -----
const SAVE_FORMAT_VERSION = 1;
const AUTOSAVE_STORAGE_KEY = "minecolonies.autosave.v1";
let autoSaveTimer = null;
let autoSaveSuppressed = false;

function scheduleAutoSave() {
	if (autoSaveSuppressed) return;
	if (autoSaveTimer) clearTimeout(autoSaveTimer);
	autoSaveTimer = setTimeout(() => {
		autoSaveTimer = null;
		try {
			window.localStorage.setItem(
				AUTOSAVE_STORAGE_KEY,
				JSON.stringify(serializePlan()),
			);
		} catch {
			// localStorage may be unavailable or full.
		}
	}, 500);
}

function serializePlan() {
	return {
		formatVersion: SAVE_FORMAT_VERSION,
		styleFile: styleSelect.value,
		savedAt: new Date().toISOString(),
		grid: { rows, cols },
		buildings: placedSquares.map((placed) => ({
			id: placed.id,
			x: placed.x,
			y: placed.y,
			w: placed.w,
			h: placed.h,
		})),
		roads: {
			paths: paths.map((path) => ({
				id: path.id,
				from: { x: path.from.x, y: path.from.y },
				to: { x: path.to.x, y: path.to.y },
			})),
		},
	};
}

function downloadPlanAsJSON() {
	const json = JSON.stringify(serializePlan(), null, 2);
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `minecolonies-plan-${Date.now()}.json`;
	link.click();
	URL.revokeObjectURL(url);
}

function clearPlan() {
	placedSquares.forEach((placed) => placed.el.remove());
	placedSquares.length = 0;
	paths.forEach((path) => path.elements.forEach((el) => el.remove()));
	paths.length = 0;
	pathNodes.length = 0;
	clearSelection();
	hideMenu();
	hidePathMenu();
}

function restoreBuildingsFromSaved(buildings) {
	if (!Array.isArray(buildings)) return;
	buildings.forEach((building) => {
		if (!building || !building.id) return;
		placeSquare(building.x, building.y, {
			id: building.id,
			w: building.w,
			h: building.h,
		});
	});
}

function restorePathsFromSaved(savedPaths) {
	if (!Array.isArray(savedPaths)) return;
	let maxId = 0;
	savedPaths.forEach((saved) => {
		if (!saved || !saved.from || !saved.to) return;
		const path = {
			id: saved.id,
			from: { x: saved.from.x, y: saved.from.y },
			to: { x: saved.to.x, y: saved.to.y },
			cells: [],
			elements: [],
		};
		rebuildPathCells(path);
		paths.push(path);
		const match = /_(\d+)$/.exec(String(saved.id || ""));
		if (match) maxId = Math.max(maxId, Number(match[1]));
	});
	nextPathId = Math.max(nextPathId, maxId + 1);
	syncPathNodesFromPaths();
	rerenderAllPathBorders();
}

async function applyPlanData(data) {
	if (!data || data.formatVersion !== SAVE_FORMAT_VERSION) {
		console.error("Unsupported or missing plan format version.");
		return;
	}
	undoStack.length = 0;
	redoStack.length = 0;
	updateUndoRedoButtons();
	autoSaveSuppressed = true;
	try {
		if (data.styleFile && data.styleFile !== styleSelect.value) {
			const match = STYLE_FILES.find(
				(styleFile) => styleFile.file === data.styleFile,
			);
			if (match) {
				styleSelect.value = match.file;
				await applyStyle(match.file);
			}
		}
		clearPlan();
		if (data.grid) {
			rows = data.grid.rows || rows;
			cols = data.grid.cols || cols;
			updateGridSize();
			renderGridCells();
		}
		restoreBuildingsFromSaved(data.buildings);
		restorePathsFromSaved(data.roads && data.roads.paths);
	} finally {
		autoSaveSuppressed = false;
	}
	scheduleAutoSave();
}

function readPlanFile(file) {
	if (!file) return;
	const reader = new FileReader();
	reader.onload = () => {
		try {
			const data = JSON.parse(reader.result);
			applyPlanData(data);
		} catch (error) {
			console.error("Failed to read plan file.", error);
		}
	};
	reader.readAsText(file);
}

// ----- My Plans (named, multi-slot saves) -----
const NAMED_PLANS_STORAGE_KEY = "minecolonies.namedPlans.v1";

function loadNamedPlans() {
	try {
		const raw = window.localStorage.getItem(NAMED_PLANS_STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function saveNamedPlans(plans) {
	try {
		window.localStorage.setItem(NAMED_PLANS_STORAGE_KEY, JSON.stringify(plans));
	} catch {
		// localStorage may be unavailable or full.
	}
}

function saveCurrentPlanAs(name) {
	const trimmed = name.trim();
	if (!trimmed) return;
	const plans = loadNamedPlans();
	if (plans[trimmed]) {
		const confirmed = window.confirm(
			`A plan named "${trimmed}" already exists. Overwrite it?`,
		);
		if (!confirmed) return;
	}
	plans[trimmed] = { plan: serializePlan(), savedAt: new Date().toISOString() };
	saveNamedPlans(plans);
	renderNamedPlansList();
}

async function loadNamedPlan(name) {
	const plans = loadNamedPlans();
	const entry = plans[name];
	if (!entry) return;
	await applyPlanData(entry.plan);
}

function deleteNamedPlan(name) {
	const confirmed = window.confirm(`Delete the saved plan "${name}"?`);
	if (!confirmed) return;
	const plans = loadNamedPlans();
	delete plans[name];
	saveNamedPlans(plans);
	renderNamedPlansList();
}

function renderNamedPlansList() {
	const plans = loadNamedPlans();
	const names = Object.keys(plans).sort((a, b) =>
		(plans[b].savedAt || "").localeCompare(plans[a].savedAt || ""),
	);
	namedPlansListEl
		.querySelectorAll(".left-sidebar__plan-row")
		.forEach((row) => row.remove());
	namedPlansEmptyEl.style.display = names.length ? "none" : "block";
	names.forEach((name) => {
		const row = document.createElement("div");
		row.className = "left-sidebar__plan-row";
		const nameSpan = document.createElement("span");
		nameSpan.className = "left-sidebar__plan-name";
		nameSpan.textContent = name;
		nameSpan.title = name;
		const loadBtn = document.createElement("button");
		loadBtn.type = "button";
		loadBtn.className = "left-sidebar__plan-action";
		loadBtn.textContent = "Load";
		loadBtn.addEventListener("click", () => loadNamedPlan(name));
		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "left-sidebar__plan-action left-sidebar__plan-action--danger";
		deleteBtn.textContent = "Delete";
		deleteBtn.addEventListener("click", () => deleteNamedPlan(name));
		row.appendChild(nameSpan);
		row.appendChild(loadBtn);
		row.appendChild(deleteBtn);
		namedPlansListEl.appendChild(row);
	});
}

// ----- Undo / Redo -----
const MAX_UNDO_STATES = 50;
const undoStack = [];
const redoStack = [];
let isRestoringHistory = false;

function updateUndoRedoButtons() {
	undoButton.disabled = undoStack.length === 0;
	redoButton.disabled = redoStack.length === 0;
}

function pushUndoState() {
	if (isRestoringHistory) return;
	undoStack.push(JSON.stringify(serializePlan()));
	if (undoStack.length > MAX_UNDO_STATES) undoStack.shift();
	redoStack.length = 0;
	updateUndoRedoButtons();
}

async function restoreHistoryState(json) {
	const data = JSON.parse(json);
	isRestoringHistory = true;
	autoSaveSuppressed = true;
	try {
		clearPlan();
		if (data.grid) {
			rows = data.grid.rows || rows;
			cols = data.grid.cols || cols;
			updateGridSize();
			renderGridCells();
		}
		restoreBuildingsFromSaved(data.buildings);
		restorePathsFromSaved(data.roads && data.roads.paths);
	} finally {
		autoSaveSuppressed = false;
		isRestoringHistory = false;
	}
	scheduleAutoSave();
}

async function undo() {
	if (!undoStack.length) return;
	const current = JSON.stringify(serializePlan());
	const previous = undoStack.pop();
	redoStack.push(current);
	updateUndoRedoButtons();
	await restoreHistoryState(previous);
}

async function redo() {
	if (!redoStack.length) return;
	const current = JSON.stringify(serializePlan());
	const next = redoStack.pop();
	undoStack.push(current);
	updateUndoRedoButtons();
	await restoreHistoryState(next);
}

undoButton.addEventListener("click", () => undo());
redoButton.addEventListener("click", () => redo());
updateUndoRedoButtons();

exportJsonButton.addEventListener("click", downloadPlanAsJSON);
importJsonTriggerButton.addEventListener("click", () => {
	importJsonInput.click();
});
importJsonInput.addEventListener("change", (event) => {
	const file = event.target.files && event.target.files[0];
	readPlanFile(file);
	importJsonInput.value = "";
});
exportPngButton.addEventListener("click", () => exportPlanAsPNG());

saveNamedPlanButton.addEventListener("click", () => {
	saveCurrentPlanAs(planNameInput.value);
	planNameInput.value = "";
});
planNameInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		saveCurrentPlanAs(planNameInput.value);
		planNameInput.value = "";
	}
});
renderNamedPlansList();

applyStyle(STYLE_FILES[0].file).then(() => {
	try {
		const raw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
		if (raw) applyPlanData(JSON.parse(raw));
	} catch (error) {
		console.error("Failed to restore autosave", error);
	}
});
