// "Export PNG": a flat image of the plan - chunk lines, painted paths and
// each building as its category color with its name. (No world background
// or top-down renders.)

import { CATEGORY_IDS } from "./catalog.js";
import { cellSize, chunkSize } from "./config.js";
import { cols, rows } from "./grid-view.js";
import { getBadgeFontSize, placedSquares } from "./buildings.js";
import { paths } from "./paths.js";
import { roadTypeColor } from "./road-types.js";

// Category colors are CSS variables set by each .category-* class; an
// invisible element per category lets them be read from the stylesheet.
let categorySwatches = null;
function getCategoryColors(category) {
	if (!categorySwatches) {
		categorySwatches = {};
		for (const id of CATEGORY_IDS) {
			const swatch = document.createElement("div");
			swatch.className = `category-${id}`;
			Object.assign(swatch.style, {
				position: "absolute",
				width: "0",
				height: "0",
				overflow: "hidden",
				opacity: "0",
				pointerEvents: "none",
			});
			document.body.appendChild(swatch);
			categorySwatches[id] = swatch;
		}
	}
	const style = getComputedStyle(categorySwatches[category] || categorySwatches.farming);
	return {
		fill: style.getPropertyValue("--category-color").trim() || "#d8c4a8",
		border: style.getPropertyValue("--category-border").trim() || "#b59a7a",
	};
}

function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	// Revoked later: some browsers haven't started the download yet when
	// click() returns.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportPlanAsPNG() {
	const width = cols * cellSize;
	const height = rows * cellSize;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");

	const rootStyle = getComputedStyle(document.documentElement);
	const read = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;
	const pathBg = read("--path-cell-bg", "rgba(100,180,220,0.4)");
	const badgeInk = read("--badge-ink", "#0f1115");

	ctx.fillStyle = read("--grid-bg", "#1e1e1e");
	ctx.fillRect(0, 0, width, height);

	ctx.strokeStyle = read("--grid-line", "#3a3a3a");
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

	for (const path of paths) {
		ctx.fillStyle = roadTypeColor(path.type) || pathBg;
		for (const cell of path.cells) ctx.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
	}

	for (const placed of placedSquares) {
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

		ctx.fillStyle = badgeInk;
		ctx.font = `700 ${getBadgeFontSize(placed.w, placed.h)}px "Segoe UI", sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(placed.label, x + w / 2, y + h / 2, Math.max(w - 8, 4));
	}

	canvas.toBlob((blob) => {
		// null when the canvas is beyond the browser's size limit (a grid
		// grown by a large world background).
		if (!blob) {
			window.alert(`The plan is too large to export as a PNG (${width}×${height} pixels).`);
			return;
		}
		downloadBlob(blob, `minecolonies-plan-${Date.now()}.png`);
	}, "image/png");
}
