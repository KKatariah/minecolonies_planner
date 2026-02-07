const rows = 20;
const cols = 20;
const cellSize = 24;

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
	cell.dataset.x = String(i % cols);
	cell.dataset.y = String(Math.floor(i / cols));
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

const sampleSquare = document.createElement("div");
sampleSquare.className = "sample-square";
sampleSquare.style.width = `${cellSize * 2}px`;
sampleSquare.style.height = `${cellSize * 2}px`;

bottomBar.appendChild(sampleSquare);
document.body.appendChild(bottomBar);

let isSelected = false;
const placedSquares = [];
let isDragging = false;
let dragItem = null;
let suppressClick = false;
let selectedPlaced = null;

function toggleSelected() {
	isSelected = !isSelected;
	sampleSquare.classList.toggle("is-selected", isSelected);
}

function placeSquare(x, y) {
	const placed = document.createElement("div");
	placed.className = "placed-square";
	placed.style.width = `${cellSize * 2}px`;
	placed.style.height = `${cellSize * 2}px`;
	placed.style.left = `${x * cellSize}px`;
	placed.style.top = `${y * cellSize}px`;
	placed.addEventListener("pointerdown", startDrag);
	placed.addEventListener("click", (event) => {
		if (suppressClick || isDragging) return;
		event.stopPropagation();
		selectPlaced(placed);
	});
	grid.appendChild(placed);
	placedSquares.push({ el: placed, x, y, w: 2, h: 2 });
	isSelected = false;
	sampleSquare.classList.remove("is-selected");
}

function rectanglesOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
	return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function canPlaceAt(x, y, ignoreEl) {
	return !placedSquares.some((placed) => {
		if (ignoreEl && placed.el === ignoreEl) return false;
		return rectanglesOverlap(
			x,
			y,
			2,
			2,
			placed.x,
			placed.y,
			placed.w,
			placed.h,
		);
	});
}

function getSnapPoint(clientX, clientY) {
	const rect = grid.getBoundingClientRect();
	const x = Math.floor((clientX - rect.left) / cellSize);
	const y = Math.floor((clientY - rect.top) / cellSize);
	if (x < 0 || y < 0 || x + 2 > cols || y + 2 > rows) return null;
	return { x, y };
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
}

function handleMove(event) {
	if (!isDragging || !dragItem) return;
	const snap = getSnapPoint(event.clientX, event.clientY);
	if (!snap) return;
	if (!canPlaceAt(snap.x, snap.y, dragItem.el)) return;
	dragItem.x = snap.x;
	dragItem.y = snap.y;
	dragItem.el.style.left = `${snap.x * cellSize}px`;
	dragItem.el.style.top = `${snap.y * cellSize}px`;
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
	let left = (item.x + 2) * cellSize + 8;
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

function hideMenu() {
	actionMenu.style.display = "none";
	if (selectedPlaced) {
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
	hideMenu();
}

sampleSquare.addEventListener("click", toggleSelected);
grid.addEventListener("click", (event) => {
	if (!event.target.closest(".placed-square")) hideMenu();
	if (!isSelected || suppressClick) return;
	const cell = event.target.closest(".grid-cell");
	if (!cell) return;
	const x = Number(cell.dataset.x);
	const y = Number(cell.dataset.y);
	if (x + 2 > cols || y + 2 > rows) return;
	if (!canPlaceAt(x, y)) return;
	placeSquare(x, y);
});

document.addEventListener("pointermove", handleMove);
document.addEventListener("pointerup", finishDrag);
document.addEventListener("pointercancel", finishDrag);
actionMenu.addEventListener("click", (event) => {
	const button = event.target.closest("button");
	if (!button) return;
	const action = button.dataset.action;
	if (action === "delete") deleteSelected();
});
document.addEventListener("click", (event) => {
	if (event.target.closest(".action-menu")) return;
	if (event.target.closest(".placed-square")) return;
	hideMenu();
});
