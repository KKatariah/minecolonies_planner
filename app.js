let rows = 8 * 16;
let cols = 10 * 16;
const cellSize = 5;
const chunkSize = 16;
const STYLE_FILES = [
	{ id: "caledonia", label: "Caledonia", file: "styles/caledonia.json" },
];

const root = document.getElementById("root");
const gridShell = document.createElement("div");
gridShell.className = "grid-shell";
const grid = document.createElement("div");
grid.className = "grid";
gridShell.appendChild(grid);
root.appendChild(gridShell);

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
}

function addChunkRowTop() {
	rows += chunkSize;
	updateGridSize();
	shiftPlacedSquares(0, chunkSize);
	renderGridCells();
}

function removeChunkRowBottom() {
	if (rows <= chunkSize) return;
	rows -= chunkSize;
	updateGridSize();
	pruneOutOfBounds();
	renderGridCells();
}

function removeChunkRowTop() {
	if (rows <= chunkSize) return;
	rows -= chunkSize;
	updateGridSize();
	shiftPlacedSquares(0, -chunkSize);
	pruneOutOfBounds();
	renderGridCells();
}

function addChunkColumnRight() {
	cols += chunkSize;
	updateGridSize();
	renderGridCells();
}

function addChunkColumnLeft() {
	cols += chunkSize;
	updateGridSize();
	shiftPlacedSquares(chunkSize, 0);
	renderGridCells();
}

function removeChunkColumnRight() {
	if (cols <= chunkSize) return;
	cols -= chunkSize;
	updateGridSize();
	pruneOutOfBounds();
	renderGridCells();
}

function removeChunkColumnLeft() {
	if (cols <= chunkSize) return;
	cols -= chunkSize;
	updateGridSize();
	shiftPlacedSquares(-chunkSize, 0);
	pruneOutOfBounds();
	renderGridCells();
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

document.addEventListener("keydown", (event) => {
	if (event.key === "Shift") updateExpandLabels(true);
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
let shapes = [];
let activeTab = "farming";
let activeSubcategory = "all";

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
		const previewWidth = shape.w * cellSize;
		const previewHeight = shape.h * cellSize;
		const badgeSize = getBadgeFontSize(shape.w, shape.h);
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
	const toDelete = Array.from(selectedPlaced);
	for (let i = placedSquares.length - 1; i >= 0; i -= 1) {
		if (selectedPlaced.has(placedSquares[i].el)) {
			placedSquares.splice(i, 1);
		}
	}
	toDelete.forEach((el) => el.remove());
	clearSelection();
	duplicateMode = false;
	duplicateSource = null;
	hideMenu();
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
	item.w = nextW;
	item.h = nextH;
	item.x = clamped.x;
	item.y = clamped.y;
	item.el.style.width = `${cellSize * item.w}px`;
	item.el.style.height = `${cellSize * item.h}px`;
	item.el.style.left = `${item.x * cellSize}px`;
	item.el.style.top = `${item.y * cellSize}px`;
	showMenuFor(item.el);
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
	if (event.target.closest(".action-menu")) return;
	if (!event.target.closest(".placed-square") && !duplicateMode) hideMenu();
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
	const cell = event.target.closest(".grid-cell");
	if (!cell) return;
	const x = Number(cell.dataset.x);
	const y = Number(cell.dataset.y);
	const step = event.ctrlKey ? chunkSize : 1;
	const snap = snapToGrid(x, y, selectedShape.w, selectedShape.h, step);
	if (!snap) return;
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

applyStyle(STYLE_FILES[0].file);
