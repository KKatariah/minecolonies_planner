// World Viewer — upload real Minecraft region files (region/*.mca from a
// world save) and render a solid-color biome overview map, like chunkbase's
// seed map, so a colony's site can be picked against real terrain instead of
// a blank grid. Nothing is uploaded anywhere; parsing happens entirely in
// the browser via nbt.js plus the native DecompressionStream API for the
// region file's per-chunk zlib payloads.
//
// The actual region-file parsing and biome-map rendering live in
// world-terrain.js, shared with app.js's "upload a world as a background"
// feature on the planner grid - this file is just the page-specific UI
// (upload widget, zoom/pan, tooltip, legend) built on top of it.
//
// Format details (region file layout, chunk NBT schema, bit-packing for
// heightmaps/biomes) were confirmed against a real 1.20.1 world save this
// session — see "Feasibility notes for uploading a world save" in
// FEASIBILITY_NOTES.md for the full writeup and the bugs that came up along
// the way (heightmaps AND block_states/biomes use padded per-long packing,
// not the newer no-waste packing originally assumed for the latter two).

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

const dropzone = root.querySelector("[data-dropzone]");
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

const { filterMcaFiles, collectFilesFromEntry, colorForBiome, formatBiomeName, escapeHtml } = window.WorldTerrain;

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
		// covers both a dropped folder and plain dropped files - entries for
		// files are just leaves, no recursion needed for those
		const entries = [...items].map((i) => i.webkitGetAsEntry()).filter(Boolean);
		const collected = [];
		for (const entry of entries) await collectFilesFromEntry(entry, collected);
		const files = filterMcaFiles(collected);
		if (files.length) handleFiles(files);
		else statusEl.textContent = "No .mca region files found in what was dropped.";
		return;
	}
	// fallback for browsers without drag-and-drop directory support
	const files = filterMcaFiles([...(event.dataTransfer.files || [])]);
	if (files.length) handleFiles(files);
});

// ---------- zoom / pan ----------
// The transform lives on canvasInner (a plain wrapper div), not the canvas
// itself, purely so the pixel-drawing code above never has to think about
// it. getBoundingClientRect() on the canvas already reports its POST-
// transform position and size (CSS transforms affect descendants' rendered
// boxes too), so the existing tooltip math (scaleX = canvas.width /
// rect.width) keeps working completely unchanged - it already divides out
// whatever the current zoom is, without needing to know the zoom value at
// all.
let viewZoom = 1;
let viewPanX = 0;
let viewPanY = 0;
// Low enough that even a max-sized upload (MAX_GRID_DIMENSION, 16384 blocks
// on an axis) can still reach a fully-zoomed-out fit in a small viewport -
// the old 0.05 floor was only good down to a ~800px-wide viewport before it
// started clamping the fit zoom upward and cropping part of the map.
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 32;

function applyViewTransform() {
	canvasInner.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`;
	// Below 1:1 the canvas is being shrunk - switch off nearest-neighbor so
	// thin contour lines get blended into the downscale instead of skipped
	// over (see the .is-downscaled rule in styles.css for the full story).
	canvas.classList.toggle("is-downscaled", viewZoom < 1);
}

// Picks a zoom level that fits the whole rendered map inside the visible
// viewport, anchored at the map's own origin (world block 0,0 - top-left of
// the canvas) rather than centered - the sane starting point after loading
// new data, and what the "fit to view" button returns to. Deliberately NOT
// clamped to MIN_ZOOM here (unlike interactive zoom below): the fit must
// always be able to show the entire loaded area regardless of how large it
// is, even if that needs a smaller zoom than manual zoom-out normally allows.
function fitToView() {
	if (!canvas.width || !canvas.height) return;
	const vw = viewport.clientWidth;
	const vh = viewport.clientHeight;
	viewZoom = Math.min(vw / canvas.width, vh / canvas.height, MAX_ZOOM);
	viewPanX = 0;
	viewPanY = 0;
	applyViewTransform();
}

// Zooms toward a specific point in viewport-local coordinates (the cursor
// for wheel-zoom, the viewport center for the +/- buttons), keeping
// whatever block was under that point still under it after the zoom
// changes - the standard "zoom toward cursor" trick: find the point in
// content-space first, change the zoom, then solve for the pan that puts
// that same content-space point back under the same screen-space point.
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

// Click-and-drag panning. Dragging shouldn't also spam the hover tooltip
// with whatever block happens to pass under the cursor mid-drag, so it's
// explicitly hidden for the duration.
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;

viewport.addEventListener("pointerdown", (event) => {
	if (!canvas.width) return;
	// The zoom controls and the goto-coordinates form both live inside the
	// viewport (positioned over the map), so interacting with them also
	// bubbles a pointerdown up to this handler. Without this check,
	// setPointerCapture() below hijacks the interaction as a drag before a
	// button's click can fire cleanly - or, for the form's number inputs,
	// before the browser can even focus them to place a text cursor.
	if (event.target.closest("button, input, label")) return;
	isDragging = true;
	dragStartX = event.clientX;
	dragStartY = event.clientY;
	dragStartPanX = viewPanX;
	dragStartPanY = viewPanY;
	viewport.setPointerCapture(event.pointerId);
	viewport.classList.add("is-panning");
	tooltip.hidden = true;
});
viewport.addEventListener("pointermove", (event) => {
	if (!isDragging) return;
	viewPanX = dragStartPanX + (event.clientX - dragStartX);
	viewPanY = dragStartPanY + (event.clientY - dragStartY);
	applyViewTransform();
});
function endDrag(event) {
	if (!isDragging) return;
	isDragging = false;
	viewport.classList.remove("is-panning");
	try {
		viewport.releasePointerCapture(event.pointerId);
	} catch {
		// already released (e.g. pointer left the window) - fine to ignore
	}
}
viewport.addEventListener("pointerup", endDrag);
viewport.addEventListener("pointercancel", endDrag);

// Selecting a new batch of files while a previous batch is still being
// parsed (e.g. changing your mind partway through a large upload) used to
// silently corrupt the display - both async handleFiles() calls run
// concurrently and write to the same shared status/canvas/legend elements,
// so whichever one happens to finish LAST wins, regardless of which the
// user actually intended to see last. A simple generation token fixes it:
// each call captures the generation counter at the start, and bails out
// before touching the DOM if a newer call has since started.
let uploadGeneration = 0;
// The "go to coordinates" form needs minCx/minCz/biomeAt after handleFiles()
// has already returned (it only runs later, on user submit) - result itself
// is otherwise just a handleFiles()-local closure variable (captured by
// canvas.onmousemove below), so it doesn't survive past this function
// without being stashed somewhere outside it.
let loadedResult = null;

async function handleFiles(files) {
	const myGeneration = ++uploadGeneration;
	const isStale = () => myGeneration !== uploadGeneration;

	resultsEl.hidden = true;
	statusEl.textContent = "";

	const result = await window.WorldTerrain.buildTerrainImage(files, {
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
		if (isDragging) return; // avoid fighting the drag with tooltip flicker
		// Block-index math needs the CANVAS's own rect - it's the thing
		// actually being scaled/panned, so its post-transform size/position
		// is what correctly divides zoom back out. The tooltip's on-screen
		// position needs the VIEWPORT's rect instead: the tooltip is a
		// sibling of canvasInner (not a descendant), so its CSS positioned
		// ancestor is the viewport, not the canvas.
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
// Same screen = pan + content*zoom relationship zoomTowardPoint() below
// uses, solved for pan with the viewport's own center as the target screen
// point instead of the cursor - keeps whatever zoom level is already set
// rather than forcing a specific one.
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
