// The right pane's Building Preview (front photo or top-down render) and
// the cost panel (materials per level). It follows the selected building on
// the grid, or else the shape armed in the tray.

import { escapeHtml } from "../lib/dom.js";
import { renderGrid } from "../lib/rooftop-render.js";
import { getFrontImageCandidates, getStyleShapes } from "./catalog.js";
import { settings } from "./display-settings.js";
import { on } from "./events.js";
import {
	costBodyEl,
	costCard,
	costLevelsEl,
	previewCanvas,
	previewEmpty,
	previewImage,
	previewName,
	previewTopDownLabel,
	previewViewToggle,
} from "./layout.js";
import { formatMaterialName, getMaterialBaseId, getMaterialShapeClass } from "./materials.js";
import { fetchRooftopData, getRooftopDataPath } from "./rooftop.js";
import { selectedPrimary } from "./selection.js";
import { getSelectedShape } from "./tray.js";

let materialIcons = {}; // block id -> icon path
let viewMode = "front"; // "front" | "top"
let selectedCostLevel = 1;
// Bumped per preview; async loads for an older preview are dropped.
let previewRequestId = 0;

// A selected building wins over the tray. It's resolved against the style it
// was placed from, which may not be the one the tray shows.
export function getPreviewedShape() {
	const entry = selectedPrimary;
	if (entry) {
		const found = getStyleShapes(entry.styleFile).find((s) => s.id === entry.id);
		if (found) return { ...found, styleFile: entry.styleFile };
		const { id, label, w, h, category, emoji, styleFile } = entry;
		return { id, label, w, h, category, emoji, styleFile };
	}
	return getSelectedShape();
}

function setViewButtons(mode) {
	for (const button of previewViewToggle.querySelectorAll("[data-preview-view]")) {
		button.classList.toggle("is-active", button.dataset.previewView === mode);
	}
}

// Shows the front photo, trying each candidate filename in turn.
function updatePreviewSidebar() {
	const shape = getPreviewedShape();
	const requestId = ++previewRequestId;
	previewCanvas.hidden = true;
	previewTopDownLabel.hidden = true;
	viewMode = "front";

	if (!shape) {
		previewName.textContent = "Select a building";
		previewImage.removeAttribute("src");
		previewImage.style.display = "none";
		previewViewToggle.hidden = true;
		previewEmpty.textContent = "Select a building from the tray to see its front view.";
		previewEmpty.style.display = "flex";
		return;
	}

	previewName.textContent = shape.label || "Selected Building";
	previewImage.style.display = "none";
	previewEmpty.style.display = "flex";
	previewEmpty.textContent = "Loading preview...";
	const hasRooftopData = Boolean(getRooftopDataPath(shape));
	previewViewToggle.hidden = !hasRooftopData;
	if (hasRooftopData) setViewButtons("front");

	const candidates = getFrontImageCandidates(shape);
	let index = 0;
	const tryNext = () => {
		if (requestId !== previewRequestId) return;
		if (index >= candidates.length) {
			previewImage.removeAttribute("src");
			previewImage.style.display = "none";
			previewEmpty.style.display = "flex";
			previewEmpty.textContent = "No preview image found. Expected: images/<building>_front.jpg";
			return;
		}
		previewImage.src = candidates[index++];
	};
	previewImage.onload = () => {
		if (requestId !== previewRequestId) return;
		previewEmpty.style.display = "none";
		previewImage.style.display = "block";
	};
	previewImage.onerror = tryNext;
	tryNext();
}

async function showPreviewView(mode) {
	viewMode = mode;
	setViewButtons(mode);
	if (mode === "front") {
		previewCanvas.hidden = true;
		previewTopDownLabel.hidden = true;
		if (previewImage.getAttribute("src")) previewImage.style.display = "block";
		return;
	}
	const shape = getPreviewedShape();
	const dataPath = getRooftopDataPath(shape);
	if (!dataPath) return;
	const requestId = previewRequestId;
	const stillCurrent = () => requestId === previewRequestId && viewMode === "top";
	previewImage.style.display = "none";
	previewTopDownLabel.hidden = true;
	try {
		const gridData = await fetchRooftopData(dataPath);
		if (!stillCurrent()) return;
		await renderGrid(gridData, previewCanvas, { showDoors: settings.doorLabels.get() });
		if (!stillCurrent()) return;
		previewCanvas.hidden = false;
		previewEmpty.style.display = "none";
		previewTopDownLabel.textContent = shape.label || "";
		previewTopDownLabel.className = `preview-card__topdown-label category-${shape.category || "farming"}`;
		previewTopDownLabel.hidden = false;
	} catch {
		// Leave whatever was showing.
	}
}

// ---------- cost panel ----------

function renderMaterialsList(materials) {
	const entries = Object.entries(materials || {}).sort((a, b) => b[1] - a[1]);
	if (!entries.length) return `<div class="cost-card__empty">Nothing needed.</div>`;
	const items = entries.map(([id, count]) => {
		const iconPath = materialIcons[getMaterialBaseId(id)];
		const icon = iconPath
			? `<img class="cost-card__material-icon ${getMaterialShapeClass(id)}" src="${escapeHtml(iconPath)}" alt="" loading="lazy" />`
			: `<span class="cost-card__material-icon cost-card__material-icon--placeholder" aria-hidden="true"></span>`;
		return `
			<li class="cost-card__material">
				<span class="cost-card__material-label">
					${icon}
					<span class="cost-card__material-name">${escapeHtml(formatMaterialName(id))}</span>
				</span>
				<span class="cost-card__material-count">${count.toLocaleString()}</span>
			</li>
		`;
	});
	return `<ul class="cost-card__materials">${items.join("")}</ul>`;
}

// Level buttons, then the total materials to reach the chosen level and the
// cost of the next upgrade. Hidden for shapes without level data.
function updateCostPanel() {
	const levels = getPreviewedShape()?.levels;
	if (!Array.isArray(levels) || !levels.length) {
		costCard.hidden = true;
		costLevelsEl.replaceChildren();
		costBodyEl.replaceChildren();
		return;
	}
	costCard.hidden = false;
	selectedCostLevel = Math.max(1, Math.min(levels.length, selectedCostLevel));

	costLevelsEl.replaceChildren(
		...levels.map((levelData) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "cost-card__level-button";
			button.textContent = `Lvl ${levelData.level}`;
			button.classList.toggle("is-active", levelData.level === selectedCostLevel);
			button.addEventListener("click", () => {
				selectedCostLevel = levelData.level;
				updateCostPanel();
			});
			return button;
		}),
	);

	const current = levels.find((l) => l.level === selectedCostLevel);
	const next = levels.find((l) => l.level === selectedCostLevel + 1);
	costBodyEl.innerHTML = `
		<div class="cost-card__section">
			<h4 class="cost-card__section-title">Total to reach Level ${selectedCostLevel}</h4>
			${renderMaterialsList(current?.materials)}
		</div>
		<div class="cost-card__section">
			<h4 class="cost-card__section-title">${next ? `Upgrade cost to Level ${next.level}` : "Max level reached"}</h4>
			${next ? renderMaterialsList(next.upgradeCost) : ""}
		</div>
	`;
}

async function loadMaterialIcons() {
	try {
		const response = await fetch("images/material-icons.json");
		if (!response.ok) return;
		materialIcons = await response.json();
		updateCostPanel();
	} catch {
		// Without the manifest every material gets the placeholder swatch.
	}
}

export function initPreview() {
	previewViewToggle.addEventListener("click", (event) => {
		const button = event.target.closest("[data-preview-view]");
		if (button) showPreviewView(button.dataset.previewView);
	});
	on("selection-changed", ({ buildingSelected, shapeSelected } = {}) => {
		if (buildingSelected || shapeSelected) selectedCostLevel = 1;
		updatePreviewSidebar();
		updateCostPanel();
	});
	on("display-changed", (setting) => {
		if (setting === "doorLabels" && viewMode === "top") showPreviewView("top");
	});
	updatePreviewSidebar();
	loadMaterialIcons();
}
