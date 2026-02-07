const rows = 8 * 16;
const cols = 10 * 16;
const cellSize = 5;
const chunkSize = 16;
const STYLE_FILES = [
	{ id: "caledonia", label: "Caledonia", file: "styles/caledonia.json" },
];

const root = document.getElementById("root");
const grid = document.createElement("div");

grid.className = "grid";

const gridWidth = cols * cellSize;
const gridHeight = rows * cellSize;

grid.style.setProperty("--cell-size", `${cellSize}px`);
grid.style.setProperty("--chunk-size", `${cellSize * chunkSize}px`);
document.documentElement.style.setProperty("--cell-size", `${cellSize}px`);
grid.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
grid.style.gridTemplateRows = `repeat(${rows}, ${cellSize}px)`;
grid.style.width = `${gridWidth}px`;
grid.style.height = `${gridHeight}px`;

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

grid.appendChild(fragment);
root.appendChild(grid);

const actionMenu = document.createElement("div");
actionMenu.className = "action-menu";
actionMenu.innerHTML = `
	<button type="button" data-action="rotate">Rotate</button>
	<button type="button" data-action="delete">Delete</button>
	<button type="button" data-action="duplicate">Duplicate</button>
`;
grid.appendChild(actionMenu);

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
let suppressClick = false;
let selectedPlaced = null;
let duplicateMode = false;
let duplicateSource = null;
let selectedShapeId = null;
let shapes = [];
let activeTab = "farming";
let activeSubcategory = "all";

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
	],
	infrastructure: [
		"alleys",
		"avenues",
		"birail",
		"fields",
		"monorail",
		"plaza",
		"roads",
	],
	walls: ["corners", "gates", "misc", "stairs", "walls"],
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
		const previewWidth = shape.w * cellSize;
		const previewHeight = shape.h * cellSize;
		const scale =
			previewHeight > maxPreviewHeight ? maxPreviewHeight / previewHeight : 1;
		const scaledWidth = Math.round(previewWidth * scale);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "shape-option";
		button.dataset.shapeId = shape.id;
		button.innerHTML = `
			<div class="shape-label">${shape.label}</div>
			<div class="shape-preview-wrap" style="width:${scaledWidth}px;">
				<div
					class="shape-preview"
					style="width:${previewWidth}px; height:${previewHeight}px; transform: scale(${scale});"
				></div>
			</div>
		`;
		button.style.width = `${scaledWidth + 12}px`;
		button.addEventListener("click", () => selectShape(shape.id));
		shapeTray.appendChild(button);
	});
	updateShapeSelectionUI();
}

function selectShape(shapeId) {
	selectedShapeId = selectedShapeId === shapeId ? null : shapeId;
	updateShapeSelectionUI();
}

function updateShapeSelectionUI() {
	shapeTray.querySelectorAll(".shape-option").forEach((button) => {
		button.classList.toggle(
			"is-selected",
			button.dataset.shapeId === selectedShapeId,
		);
	});
}

function getSelectedShape() {
	return shapes.find((shape) => shape.id === selectedShapeId) || null;
}

function placeSquare(x, y, shape) {
	const placed = document.createElement("div");
	placed.className = "placed-square";
	placed.style.width = `${cellSize * shape.w}px`;
	placed.style.height = `${cellSize * shape.h}px`;
	placed.style.left = `${x * cellSize}px`;
	placed.style.top = `${y * cellSize}px`;
	placed.addEventListener("pointerdown", startDrag);
	placed.addEventListener("click", (event) => {
		if (suppressClick || isDragging) return;
		event.stopPropagation();
		selectPlaced(placed);
	});
	grid.appendChild(placed);
	placedSquares.push({
		el: placed,
		x,
		y,
		w: shape.w,
		h: shape.h,
		id: shape.id,
	});
}

function rectanglesOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
	return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function canPlaceAt(x, y, w, h, ignoreEl) {
	return !placedSquares.some((placed) => {
		if (ignoreEl && placed.el === ignoreEl) return false;
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
	if (selectedPlaced !== target) return;
	event.preventDefault();
	isDragging = true;
	dragItem = item;
	suppressClick = true;
	hideMenu();
	item.el.classList.add("is-dragging");
	if (target.setPointerCapture) {
		target.setPointerCapture(event.pointerId);
	}
	handleMove(event);
}

function handleMove(event) {
	if (!isDragging || !dragItem) return;
	const step = event.shiftKey ? chunkSize : 1;
	const snap = getCenteredSnapPoint(
		event.clientX,
		event.clientY,
		dragItem.w,
		dragItem.h,
		step,
	);
	if (!snap) return;
	if (canPlaceAt(snap.x, snap.y, dragItem.w, dragItem.h, dragItem.el)) {
		dragItem.x = snap.x;
		dragItem.y = snap.y;
		dragItem.el.style.left = `${snap.x * cellSize}px`;
		dragItem.el.style.top = `${snap.y * cellSize}px`;
		return;
	}

	const canMoveX =
		snap.x !== dragItem.x &&
		canPlaceAt(snap.x, dragItem.y, dragItem.w, dragItem.h, dragItem.el);
	const canMoveY =
		snap.y !== dragItem.y &&
		canPlaceAt(dragItem.x, snap.y, dragItem.w, dragItem.h, dragItem.el);

	if (canMoveY) {
		dragItem.y = snap.y;
		dragItem.el.style.top = `${snap.y * cellSize}px`;
	}
	if (canMoveX) {
		dragItem.x = snap.x;
		dragItem.el.style.left = `${snap.x * cellSize}px`;
	}
}

function finishDrag(event) {
	if (!isDragging || !dragItem) return;
	const element = dragItem.el;
	dragItem.el.classList.remove("is-dragging");
	isDragging = false;
	dragItem = null;
	selectPlaced(element);
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

function selectPlaced(element) {
	if (selectedPlaced && selectedPlaced !== element) {
		selectedPlaced.classList.remove("is-selected");
	}
	selectedPlaced = element;
	if (selectedPlaced) {
		selectedPlaced.classList.add("is-selected");
		showMenuFor(selectedPlaced);
	}
}

function showMenuFor(element) {
	const item = placedSquares.find((placed) => placed.el === element);
	if (!item) return;
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
	if (!preserveSelection && selectedPlaced) {
		selectedPlaced.classList.remove("is-selected");
		selectedPlaced = null;
	}
}

function deleteSelected() {
	if (!selectedPlaced) return;
	const index = placedSquares.findIndex(
		(placed) => placed.el === selectedPlaced,
	);
	if (index >= 0) placedSquares.splice(index, 1);
	selectedPlaced.remove();
	duplicateMode = false;
	duplicateSource = null;
	hideMenu();
}

async function loadStyle(file) {
	const response = await fetch(file);
	if (!response.ok) throw new Error("Failed to load style file.");
	return response.json();
}

async function applyStyle(file) {
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
	if (!event.target.closest(".placed-square") && !duplicateMode) hideMenu();
	if (duplicateMode) {
		const cell = event.target.closest(".grid-cell");
		if (!cell) return;
		const x = Number(cell.dataset.x);
		const y = Number(cell.dataset.y);
		const step = event.shiftKey ? chunkSize : 1;
		const snap = snapToGrid(
			x,
			y,
			duplicateSource?.w || 1,
			duplicateSource?.h || 1,
			step,
		);
		if (!duplicateSource) return;
		if (snap.x + duplicateSource.w > cols || snap.y + duplicateSource.h > rows)
			return;
		if (!canPlaceAt(snap.x, snap.y, duplicateSource.w, duplicateSource.h))
			return;
		placeSquare(snap.x, snap.y, duplicateSource);
		duplicateMode = false;
		duplicateSource = null;
		return;
	}
	if (suppressClick) return;
	const selectedShape = getSelectedShape();
	if (!selectedShape) return;
	const cell = event.target.closest(".grid-cell");
	if (!cell) return;
	const x = Number(cell.dataset.x);
	const y = Number(cell.dataset.y);
	const step = event.shiftKey ? chunkSize : 1;
	const snap = snapToGrid(x, y, selectedShape.w, selectedShape.h, step);
	if (snap.x + selectedShape.w > cols || snap.y + selectedShape.h > rows)
		return;
	if (!canPlaceAt(snap.x, snap.y, selectedShape.w, selectedShape.h)) return;
	placeSquare(snap.x, snap.y, selectedShape);
	selectedShapeId = null;
	updateShapeSelectionUI();
});

document.addEventListener("pointermove", handleMove);
document.addEventListener("pointerup", finishDrag);
document.addEventListener("pointercancel", finishDrag);
actionMenu.addEventListener("click", (event) => {
	const button = event.target.closest("button");
	if (!button) return;
	const action = button.dataset.action;
	if (action === "delete") deleteSelected();
	if (action === "duplicate") {
		if (!selectedPlaced) return;
		duplicateMode = true;
		duplicateSource = placedSquares.find(
			(placed) => placed.el === selectedPlaced,
		);
		hideMenu(true);
	}
});
document.addEventListener("click", (event) => {
	if (event.target.closest(".action-menu")) return;
	if (event.target.closest(".placed-square")) return;
	hideMenu();
});

applyStyle(STYLE_FILES[0].file);
