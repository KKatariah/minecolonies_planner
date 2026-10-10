// World Viewer: upload region files (.mca) from a world save and browse a
// biome map of them, to pick a colony site against real terrain. Parsing
// and painting live in lib/world-terrain.js (shared with the planner's world
// background); this is the page around it - upload, zoom/pan, tooltip,
// legend, go-to.

import { initNavBar } from "../lib/nav.js";
import { escapeHtml } from "../lib/dom.js";
import { trackPointerGesture } from "../lib/pointer-gesture.js";
import {
	buildTerrainImage,
	collectFilesFromEntry,
	colorForBiome,
	filterMcaFiles,
	formatBiomeName,
} from "../lib/world-terrain.js";

initNavBar("world-viewer");

const root = document.getElementById("world-viewer-root");

root.innerHTML = `
	<div class="inspector-intro">
		<h1 class="inspector-intro__title">World Viewer</h1>
		<p class="inspector-intro__subtitle">Upload region files from a world save to see real terrain biomes — proof of concept</p>
	</div>
	<section class="inspector-upload" data-dropzone>
		<div class="inspector-upload__zone" data-dropzone-target>
			<p class="inspector-upload__prompt">Drop one or more <code>.mca</code> region files (or a whole <code>region</code> folder) here, or</p>
			<div class="world-viewer-upload-buttons">
				<button type="button" class="inspector-upload__button" data-file-trigger>Choose files</button>
				<button type="button" class="inspector-upload__button" data-folder-trigger>Choose folder</button>
			</div>
			<input type="file" accept=".mca" multiple hidden data-file-input />
			<input type="file" webkitdirectory multiple hidden data-folder-input />
			<p class="inspector-upload__status" data-status></p>
			<button type="button" class="inspector-upload__link-button" data-load-sample>Don't have a save file handy? Try an example area</button>
		</div>
		<details class="inspector-help">
			<summary>Where do I find these files?</summary>
			<div class="inspector-help__body">
				<p>In your world save folder, look under <code>region/</code> — e.g.
				<code>saves/MyWorld/region/</code>. "Choose folder" picks up every
				<code>.mca</code> file in a folder (and its subfolders) automatically,
				so just point it at <code>region/</code> directly, or even the whole
				world save folder - no need to figure out which individual file
				covers which coordinates first. "Choose files" is there if you'd
				rather pick specific <code>.mca</code> files by hand instead.</p>
				<p>Only chunks you've actually explored have data — unexplored areas
				show as blank. This tool does not upload your files anywhere —
				everything is parsed entirely in your browser.</p>
				<p>Uploading multiple files works best when they're next to each
				other (adjacent region coordinates), covering one general area you
				want to build in. Files from opposite sides of the world won't
				render together — the map would have to cover the whole empty gap
				between them.</p>
			</div>
		</details>
	</section>
	<section class="world-viewer-results" data-results hidden>
		<div class="world-viewer-canvas-wrap" data-viewport>
			<div class="world-viewer-canvas-inner" data-canvas-inner>
				<canvas data-canvas></canvas>
			</div>
			<div class="world-viewer-tooltip" data-tooltip hidden></div>
			<form class="world-viewer-goto" data-goto-form>
				<label>X <input type="number" step="1" inputmode="numeric" data-goto-x /></label>
				<label>Z <input type="number" step="1" inputmode="numeric" data-goto-z /></label>
				<button type="submit">Go</button>
			</form>
			<div class="world-viewer-zoom-controls">
				<button type="button" data-zoom-in title="Zoom in">+</button>
				<button type="button" data-zoom-out title="Zoom out">&minus;</button>
				<button type="button" data-zoom-reset title="Fit to view">⤢</button>
			</div>
		</div>
		<div class="world-viewer-legend" data-legend></div>
	</section>
`;

const dropzoneTarget = root.querySelector("[data-dropzone-target]");
const fileInput = root.querySelector("[data-file-input]");
const folderInput = root.querySelector("[data-folder-input]");
const fileTriggerButton = root.querySelector("[data-file-trigger]");
const folderTriggerButton = root.querySelector("[data-folder-trigger]");
const statusEl = root.querySelector("[data-status]");
const resultsEl = root.querySelector("[data-results]");
const viewport = root.querySelector("[data-viewport]");
const canvasInner = root.querySelector("[data-canvas-inner]");
const canvas = root.querySelector("[data-canvas]");
const tooltip = root.querySelector("[data-tooltip]");
const legendEl = root.querySelector("[data-legend]");
const zoomInButton = root.querySelector("[data-zoom-in]");
const zoomOutButton = root.querySelector("[data-zoom-out]");
const zoomResetButton = root.querySelector("[data-zoom-reset]");
const gotoForm = root.querySelector("[data-goto-form]");
const gotoXInput = root.querySelector("[data-goto-x]");
const gotoZInput = root.querySelector("[data-goto-z]");

fileTriggerButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
	if (fileInput.files && fileInput.files.length) handleFiles(filterMcaFiles([...fileInput.files]));
});

folderTriggerButton.addEventListener("click", () => folderInput.click());
folderInput.addEventListener("change", () => {
	const files = filterMcaFiles([...(folderInput.files || [])]);
	if (files.length) handleFiles(files);
	else statusEl.textContent = "No .mca region files found in that folder.";
});

const loadSampleButton = root.querySelector("[data-load-sample]");
loadSampleButton.addEventListener("click", async () => {
	statusEl.textContent = "Loading example area…";
	try {
		const response = await fetch("sample-data/r.0.0.mca");
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const buffer = await response.arrayBuffer();
		await handleFiles([new File([buffer], "r.0.0.mca")]);
	} catch (err) {
		statusEl.textContent = `Couldn't load the example area: ${err.message}`;
	}
});

["dragenter", "dragover"].forEach((eventName) => {
	dropzoneTarget.addEventListener(eventName, (event) => {
		event.preventDefault();
		dropzoneTarget.classList.add("is-dragover");
	});
});
["dragleave", "drop"].forEach((eventName) => {
	dropzoneTarget.addEventListener(eventName, (event) => {
		event.preventDefault();
		dropzoneTarget.classList.remove("is-dragover");
	});
});

dropzoneTarget.addEventListener("drop", async (event) => {
	const items = event.dataTransfer.items;
	const hasDirectorySupport = items && [...items].some((i) => i.webkitGetAsEntry?.());
	if (hasDirectorySupport) {
		// Handles dropped folders and dropped files alike.
		const entries = [...items].map((i) => i.webkitGetAsEntry()).filter(Boolean);
		const collected = [];
		for (const entry of entries) await collectFilesFromEntry(entry, collected);
		const files = filterMcaFiles(collected);
		if (files.length) handleFiles(files);
		else statusEl.textContent = "No .mca region files found in what was dropped.";
		return;
	}
	// Browsers without directory drop support.
	const files = filterMcaFiles([...(event.dataTransfer.files || [])]);
	if (files.length) handleFiles(files);
});

// ---------- zoom / pan ----------
// The transform is on canvasInner, a wrapper, so drawing never deals with it.
// The canvas's getBoundingClientRect() already reflects the transform, which
// the tooltip math relies on.
let viewZoom = 1;
let viewPanX = 0;
let viewPanY = 0;
// Low enough to fit even a maximum-size map (16384 blocks) in a small viewport.
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 32;
let isPanning = false;

function applyViewTransform() {
	canvasInner.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`;
	// Below 1:1, smooth the downscale (see .is-downscaled in styles.css).
	canvas.classList.toggle("is-downscaled", viewZoom < 1);
}

// Fits the whole map in the viewport, anchored at its top-left. Not clamped
// to MIN_ZOOM: fitting must work however large the map is.
function fitToView() {
	if (!canvas.width || !canvas.height) return;
	const vw = viewport.clientWidth;
	const vh = viewport.clientHeight;
	viewZoom = Math.min(vw / canvas.width, vh / canvas.height, MAX_ZOOM);
	viewPanX = 0;
	viewPanY = 0;
	applyViewTransform();
}

// Zooms keeping the content under (pointX, pointY) - viewport-local - fixed.
function zoomTowardPoint(factor, pointX, pointY) {
	const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewZoom * factor));
	const contentX = (pointX - viewPanX) / viewZoom;
	const contentY = (pointY - viewPanY) / viewZoom;
	viewZoom = newZoom;
	viewPanX = pointX - contentX * viewZoom;
	viewPanY = pointY - contentY * viewZoom;
	applyViewTransform();
}

viewport.addEventListener(
	"wheel",
	(event) => {
		event.preventDefault();
		const rect = viewport.getBoundingClientRect();
		const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
		zoomTowardPoint(factor, event.clientX - rect.left, event.clientY - rect.top);
	},
	{ passive: false },
);

zoomInButton.addEventListener("click", () => {
	zoomTowardPoint(1.25, viewport.clientWidth / 2, viewport.clientHeight / 2);
});
zoomOutButton.addEventListener("click", () => {
	zoomTowardPoint(1 / 1.25, viewport.clientWidth / 2, viewport.clientHeight / 2);
});
zoomResetButton.addEventListener("click", fitToView);

// Drag to pan. The tooltip is hidden while dragging.
viewport.addEventListener("pointerdown", (event) => {
	if (!canvas.width) return;
	// The zoom buttons and go-to form sit inside the viewport; capturing the
	// pointer would steal their clicks and focus.
	if (event.target.closest("button, input, label")) return;
	const startPanX = viewPanX;
	const startPanY = viewPanY;
	isPanning = true;
	viewport.classList.add("is-panning");
	tooltip.hidden = true;
	trackPointerGesture(event, {
		captureTarget: viewport,
		onMove: (move) => {
			viewPanX = startPanX + (move.clientX - event.clientX);
			viewPanY = startPanY + (move.clientY - event.clientY);
			applyViewTransform();
		},
		onEnd: () => {
			isPanning = false;
			viewport.classList.remove("is-panning");
		},
	});
});

// A newer upload supersedes one still being parsed: each run captures the
// generation it started in and gives up once a newer one begins.
let uploadGeneration = 0;
let loadedResult = null; // the current map, for the go-to form

async function handleFiles(files) {
	const myGeneration = ++uploadGeneration;
	const isStale = () => myGeneration !== uploadGeneration;

	resultsEl.hidden = true;
	statusEl.textContent = "";

	const result = await buildTerrainImage(files, {
		onStatus: (text) => {
			if (!isStale()) statusEl.textContent = text;
		},
		isStale,
	});
	if (isStale() || result.stale) return;

	if (!result.ok) {
		statusEl.textContent = result.message;
		return;
	}

	loadedResult = result;
	canvas.width = result.gridW;
	canvas.height = result.gridH;
	canvas.getContext("2d").drawImage(result.canvas, 0, 0);

	canvas.onmousemove = (event) => {
		if (isPanning) return;
		// Block coordinates come from the (transformed) canvas rect; the
		// tooltip is positioned within the viewport, its containing block.
		const canvasRect = canvas.getBoundingClientRect();
		const viewportRect = viewport.getBoundingClientRect();
		const scaleX = canvas.width / canvasRect.width;
		const scaleY = canvas.height / canvasRect.height;
		const gx = Math.floor((event.clientX - canvasRect.left) * scaleX);
		const gz = Math.floor((event.clientY - canvasRect.top) * scaleY);
		if (gx < 0 || gx >= result.gridW || gz < 0 || gz >= result.gridH) {
			tooltip.hidden = true;
			return;
		}
		const worldX = result.minCx * 16 + gx;
		const worldZ = result.minCz * 16 + gz;
		const info = result.biomeAt(worldX, worldZ);
		if (!info || !info.biome) {
			tooltip.hidden = true;
			return;
		}
		tooltip.hidden = false;
		tooltip.style.left = `${event.clientX - viewportRect.left + 12}px`;
		tooltip.style.top = `${event.clientY - viewportRect.top + 12}px`;
		tooltip.innerHTML = `<strong>${escapeHtml(formatBiomeName(info.biome))}</strong><br>block (${worldX}, ${worldZ}) · y=${info.height}`;
	};
	canvas.onmouseleave = () => {
		tooltip.hidden = true;
	};

	legendEl.innerHTML = [...result.biomesSeen]
		.sort()
		.map(
			(b) =>
				`<span class="world-viewer-legend__item"><span class="world-viewer-legend__swatch" style="background:${colorForBiome(b)}"></span>${escapeHtml(formatBiomeName(b))}</span>`,
		)
		.join("");

	const loadedCount = files.length - result.fileErrors.length;
	const successMsg = `Loaded ${result.totalChunks.toLocaleString()} chunks from ${loadedCount} file${loadedCount === 1 ? "" : "s"}.`;
	statusEl.textContent = result.fileErrors.length ? `${successMsg} Skipped ${result.fileErrors.length}: ${result.fileErrors.join("; ")}` : successMsg;
	resultsEl.hidden = false;
	fitToView(); // needs resultsEl visible first - viewport.clientWidth/Height are 0 while [hidden]
}

// ---------- go to coordinates ----------
// Pans (at the current zoom) so map block (gx, gz) is centered.
function centerViewOn(gx, gz) {
	const vw = viewport.clientWidth;
	const vh = viewport.clientHeight;
	viewPanX = vw / 2 - gx * viewZoom;
	viewPanY = vh / 2 - gz * viewZoom;
	applyViewTransform();
}

gotoForm.addEventListener("submit", (event) => {
	event.preventDefault();
	if (!loadedResult) return;
	const worldX = Number(gotoXInput.value);
	const worldZ = Number(gotoZInput.value);
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return;
	centerViewOn(worldX - loadedResult.minCx * 16, worldZ - loadedResult.minCz * 16);
	const info = loadedResult.biomeAt(worldX, worldZ);
	statusEl.textContent =
		info && info.biome
			? `Centered on (${worldX}, ${worldZ}).`
			: `Centered on (${worldX}, ${worldZ}) - no data there (outside the uploaded area, or not yet explored in-game).`;
});

// Read-only view state for the e2e tests.
window.__worldViewer = {
	get viewZoom() {
		return viewZoom;
	},
	get viewPanX() {
		return viewPanX;
	},
	get viewPanY() {
		return viewPanY;
	},
};
