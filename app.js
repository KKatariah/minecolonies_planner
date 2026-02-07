const rows = 100;
const cols = 100;
const cellSize = 5;
const STYLE_FILES = [
	{ id: "caledonia", label: "Caledonia", file: "styles/caledonia.json" },
];

const root = document.getElementById("root");
const grid = document.createElement("div");

grid.className = "grid";

const gridWidth = cols * cellSize;
const gridHeight = rows * cellSize;

grid.style.setProperty("--cell-size", `${cellSize}px`);
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

bottomBar.appendChild(styleSelect);
bottomBar.appendChild(shapeTray);
document.body.appendChild(bottomBar);

const placedSquares = [];
let isDragging = false;
let dragItem = null;
let suppressClick = false;
let selectedPlaced = null;
let duplicateMode = false;
let duplicateSource = null;
let selectedShapeId = null;
let shapes = [];

function renderShapeTray() {
	shapeTray.innerHTML = "";
	shapes.forEach((shape) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "shape-option";
		button.dataset.shapeId = shape.id;
		button.innerHTML = `
			<div class="shape-preview" style="width:${shape.w * cellSize}px; height:${shape.h * cellSize}px"></div>
			<div class="shape-label">${shape.label}</div>
		`;
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

function getSnapPoint(clientX, clientY, w, h) {
	const rect = grid.getBoundingClientRect();
	const x = Math.floor((clientX - rect.left) / cellSize);
	const y = Math.floor((clientY - rect.top) / cellSize);
	if (x < 0 || y < 0 || x + w > cols || y + h > rows) return null;
	return { x, y };
}

function getCenteredSnapPoint(clientX, clientY, w, h) {
	const rect = grid.getBoundingClientRect();
	const centeredX = (clientX - rect.left) / cellSize - w / 2;
	const centeredY = (clientY - rect.top) / cellSize - h / 2;
	const x = Math.round(centeredX);
	const y = Math.round(centeredY);
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
	const snap = getCenteredSnapPoint(
		event.clientX,
		event.clientY,
		dragItem.w,
		dragItem.h,
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
		renderShapeTray();
		selectedShapeId = null;
	} catch (error) {
		console.error(error);
		shapes = [];
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
		if (!duplicateSource) return;
		if (x + duplicateSource.w > cols || y + duplicateSource.h > rows) return;
		if (!canPlaceAt(x, y, duplicateSource.w, duplicateSource.h)) return;
		placeSquare(x, y, duplicateSource);
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
	if (x + selectedShape.w > cols || y + selectedShape.h > rows) return;
	if (!canPlaceAt(x, y, selectedShape.w, selectedShape.h)) return;
	placeSquare(x, y, selectedShape);
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
