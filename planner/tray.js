// The bottom bar: style picker, search, category tabs and sub-tabs, and the
// tray of shapes. Clicking a shape "arms" it - the next grid click places
// it (see grid-pointer.js) - and R rotates it before placing.

import { escapeHtml } from "../lib/dom.js";
import {
	SUBCATEGORIES,
	TABS,
	formatSubcategoryLabel,
	getCategory,
	getFrontImageCandidates,
	getSubcategory,
	setActiveStyleFile,
	shapes,
} from "./catalog.js";
import { emit, on } from "./events.js";
import { pathControls, shapeSearchInput, shapeTray, styleSelect, subTabBar, tabBar } from "./layout.js";
import { pathToolActive, renderPathControls, setPathToolActive } from "./path-tool.js";

export let activeTab = "farming";
let activeSubcategory = "all";
let searchQuery = "";
// The armed shape's id, and whether it's turned a quarter.
export let selectedShapeId = null;
export let pendingRotated = false;

export function getSelectedShape() {
	return shapes.find((shape) => shape.id === selectedShapeId) || null;
}

// The armed shape's footprint, rotation applied.
export function getSelectedShapeDimensions(shape) {
	return pendingRotated ? { w: shape.h, h: shape.w } : { w: shape.w, h: shape.h };
}

function armShape(id) {
	selectedShapeId = id;
	pendingRotated = false;
}

// After placing, the tray goes back to nothing armed.
export function disarmShape() {
	armShape(null);
	renderShapeTray();
	emit("selection-changed", {});
}

export function toggleShapeRotation() {
	if (!selectedShapeId || pathToolActive) return;
	pendingRotated = !pendingRotated;
	renderShapeTray();
}

function selectShape(id) {
	// A search result can be clicked from the Roads & Rivers tab; leave the
	// road tool for the shape's own tab first.
	if (pathToolActive) {
		const shape = shapes.find((s) => s.id === id);
		setActiveTab(shape ? getCategory(shape) : "farming");
	}
	armShape(selectedShapeId === id ? null : id);
	renderShapeTray();
	emit("selection-changed", { shapeSelected: true });
}

// Opens the tab holding shape `id`, arms it, and scrolls it into view, as
// if it had been clicked in the tray (the Plan Check's warnings use this).
// A search is cleared first, since it could be hiding the shape.
export function showShapeInTray(id) {
	const shape = shapes.find((s) => s.id === id);
	if (!shape) return;
	if (searchQuery) {
		searchQuery = "";
		shapeSearchInput.value = "";
	}
	setActiveTab(getCategory(shape));
	armShape(id);
	renderShapeTray();
	emit("selection-changed", { shapeSelected: true });
	shapeTray.querySelector(`.shape-option[data-shape-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateShapeSelectionClasses() {
	for (const button of shapeTray.querySelectorAll(".shape-option")) {
		button.classList.toggle("is-selected", button.dataset.shapeId === selectedShapeId);
	}
}

function tabButton(className, label, active, onClick) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = className;
	button.textContent = label;
	button.classList.toggle("is-active", active);
	button.addEventListener("click", onClick);
	return button;
}

function renderTabs() {
	tabBar.replaceChildren(
		...TABS.map((tab) => {
			const button = tabButton("tab", tab.label, tab.id === activeTab, () => setActiveTab(tab.id));
			button.dataset.tabId = tab.id;
			return button;
		}),
	);
}

// The "Roads & Rivers" tab is the road tool's on/off switch.
function setActiveTab(tabId) {
	activeTab = tabId;
	activeSubcategory = "all";
	armShape(null);
	setPathToolActive(tabId === "roads");
	renderTabs();
	renderSubTabs();
	renderShapeTray();
	emit("selection-changed", {});
}

// Sub-tabs show only when the tab has shapes in more than one subcategory.
function renderSubTabs() {
	const inTab = shapes.filter((shape) => getCategory(shape) === activeTab);
	const subcategories = (SUBCATEGORIES[activeTab] || []).filter((sub) =>
		inTab.some((shape) => getSubcategory(shape) === sub),
	);
	if (subcategories.length <= 1) {
		subTabBar.replaceChildren();
		subTabBar.classList.add("is-hidden");
		activeSubcategory = "all";
		return;
	}
	if (!subcategories.includes(activeSubcategory)) activeSubcategory = "all";
	subTabBar.classList.remove("is-hidden");
	subTabBar.replaceChildren(
		...["all", ...subcategories].map((sub) => {
			const label = sub === "all" ? "All" : formatSubcategoryLabel(sub);
			const button = tabButton("subtab", label, sub === activeSubcategory, () => setActiveSubcategory(sub));
			button.dataset.subtabId = sub;
			return button;
		}),
	);
}

function setActiveSubcategory(sub) {
	activeSubcategory = sub;
	armShape(null);
	renderSubTabs();
	renderShapeTray();
	emit("selection-changed", {});
}

// Shows the shape's front photo as its thumbnail, trying each candidate
// name in turn; with no photo the flat category color and label stay.
function loadThumbnail(img, badge, shape) {
	const candidates = getFrontImageCandidates(shape);
	let index = 0;
	const tryNext = () => {
		if (index < candidates.length) img.src = candidates[index++];
	};
	img.onload = () => {
		img.hidden = false;
		badge.hidden = true;
	};
	img.onerror = tryNext;
	tryNext();
}

// A search query looks across every category (that's the point of it),
// even from the Roads & Rivers tab, which otherwise shows the brush
// controls. Every slot is the same size; the footprint is shown as text.
export function renderShapeTray() {
	shapeTray.replaceChildren();
	if (activeTab === "roads" && !searchQuery) {
		renderPathControls();
		shapeTray.appendChild(pathControls);
		return;
	}
	const visible = shapes.filter((shape) => {
		if (searchQuery) return (shape.label || "").toLowerCase().includes(searchQuery);
		if (getCategory(shape) !== activeTab) return false;
		return activeSubcategory === "all" || getSubcategory(shape) === activeSubcategory;
	});
	for (const shape of visible) {
		const rotated = shape.id === selectedShapeId && pendingRotated;
		const { w, h } = rotated ? { w: shape.h, h: shape.w } : shape;
		const label = escapeHtml(shape.label);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "shape-option";
		button.dataset.shapeId = shape.id;
		button.title = shape.label;
		button.innerHTML = `
			<div class="shape-preview category-${escapeHtml(getCategory(shape))}">
				<img class="shape-preview__image" alt="" hidden />
				<div class="preview-badge">${label}</div>
			</div>
			<div class="shape-label">${label}</div>
			<div class="shape-dimensions">${w}×${h}${rotated ? " ↻" : ""}</div>
		`;
		button.addEventListener("click", () => selectShape(shape.id));
		shapeTray.appendChild(button);
		loadThumbnail(button.querySelector(".shape-preview__image"), button.querySelector(".preview-badge"), shape);
	}
	updateShapeSelectionClasses();
}

// Switches the tray to another style. Buildings already placed keep their
// own style.
export async function applyStyle(file) {
	await setActiveStyleFile(file);
	styleSelect.value = file;
	// Keep the current tab if the new style has it ("roads" always exists).
	const categories = new Set(shapes.map(getCategory));
	if (activeTab !== "roads" && !categories.has(activeTab)) {
		activeTab = categories.values().next().value || "farming";
	}
	armShape(null);
	renderTabs();
	renderSubTabs();
	renderShapeTray();
	emit("selection-changed", {});
}

export function initTray() {
	styleSelect.addEventListener("change", () => applyStyle(styleSelect.value));
	shapeSearchInput.addEventListener("input", () => {
		searchQuery = shapeSearchInput.value.trim().toLowerCase();
		renderShapeTray();
	});
	// Selecting a building on the grid takes over the preview pane, so the
	// armed shape is dropped (or the next click would place a copy of it).
	on("selection-changed", ({ buildingSelected } = {}) => {
		if (buildingSelected && selectedShapeId) {
			armShape(null);
			renderShapeTray();
		} else {
			updateShapeSelectionClasses();
		}
	});
}
