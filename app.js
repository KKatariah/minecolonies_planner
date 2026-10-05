// Sized to comfortably cover one whole uploaded region file (512x512
// blocks = 32x32 chunks) by default, since the grid is a fixed-but-
// generous canvas you scroll around in (see #root's CSS) - auto-grown
// further in handleBackgroundFiles() if an uploaded background needs more.
let rows = 32 * 16;
let cols = 32 * 16;
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

// A colony can genuinely mix styles per-building in-game, so every style's
// shape list is kept loaded at once (not just whichever one the tray/dropdown
// currently shows) — a placed building remembers which style it came from
// and always resolves against that one, so switching the dropdown later (to
// place more buildings from a different style) can never corrupt or
// mislabel buildings already on the grid.
const styleCache = new Map(); // file -> { id, shapes }

async function loadAllStyles() {
	await Promise.all(
		STYLE_FILES.map(async (entry) => {
			try {
				const data = await loadStyle(entry.file);
				styleCache.set(entry.file, {
					id: entry.id,
					shapes: Array.isArray(data.shapes) ? data.shapes : [],
				});
			} catch (error) {
				console.error(`Failed to load style ${entry.file}`, error);
				styleCache.set(entry.file, { id: entry.id, shapes: [] });
			}
		}),
	);
}

function getStyleShapes(file) {
	return styleCache.get(file)?.shapes || [];
}

function getStyleIdForFile(file) {
	return (
		styleCache.get(file)?.id ||
		STYLE_FILES.find((entry) => entry.file === file)?.id ||
		activeStyleId
	);
}

let materialIcons = {};
fetch("images/material-icons.json")
	.then((response) => (response.ok ? response.json() : {}))
	.then((data) => {
		materialIcons = data;
		updateCostPanel();
	})
	.catch(() => {
		// Icons are a cosmetic enhancement; missing the manifest just means
		// every material row falls back to the generic placeholder swatch.
	});

initNavBar("planner", [
	{
		title: "General",
		items: [
			{ combo: ["Ctrl", "Z"], description: "Undo (⌘Z on Mac)" },
			{ combo: ["Ctrl", "Shift", "Z"], description: "Redo (also Ctrl+Y)" },
			{ combo: ["Delete"], description: "Delete the selected building(s) or road/river segment (also Backspace)" },
			{ combo: ["Ctrl", "Scroll"], description: "Zoom in/out" },
		],
	},
	{
		title: "Placing & moving buildings",
		items: [
			{ combo: ["Arrow keys"], description: "Nudge the selected building(s) by 1 block" },
			{ combo: ["R"], description: "Rotate the armed building before placing it" },
			{ combo: ["Shift", "Click"], description: "Add/remove a building from the selection" },
			{ combo: ["Ctrl", "Drag"], description: "Snap to 16-block chunk boundaries while placing, moving, or duplicating" },
			{ combo: ["Ctrl", "C"], description: "Copy the selected building(s)" },
			{ combo: ["Ctrl", "V"], description: "Arm a placement cursor for the last copy - click the grid to stamp it down, repeatably" },
		],
	},
	{
		title: "Roads & Rivers",
		items: [
			{ combo: ["Shift", "Drag"], description: "Constrain the current brush stroke to a straight line" },
			{ combo: ["Right-click", "Drag"], description: "Pan the map without leaving the tool" },
		],
	},
	{
		title: "Top-down renders",
		items: [
			{ combo: ["Left Ctrl"], description: "Toggle name tags and category borders for a clean view" },
		],
	},
]);

const root = document.getElementById("root");
// #root does the native scrolling (overflow:auto) directly on this sizer -
// its width/height are set in JS to the ZOOMED pixel size of the grid, so
// the scrollbars/scroll extent correctly reflect the current zoom level.
// .grid-shell itself stays at its natural, unzoomed size and gets
// transform: scale() applied - CSS transforms don't change layout/scroll
// size on their own (they're a paint-time effect), which is exactly why the
// sizer needs to track the zoomed size explicitly rather than just scaling
// .grid-shell and expecting the scrollable area to follow.
const gridZoomSizer = document.createElement("div");
gridZoomSizer.className = "grid-zoom-sizer";
root.appendChild(gridZoomSizer);

const gridShell = document.createElement("div");
gridShell.className = "grid-shell";
// Sits behind .grid (inserted first, so plain DOM order stacks it below -
// .grid's own background becomes transparent via the has-world-bg modifier
// class once a background is loaded, letting this show through the gaps
// between gridlines). Has its own overflow:hidden sized to match the grid
// exactly, so a background image bigger than the grid (the normal case - a
// single uploaded region file already covers 512x512 blocks, far more than
// the default 160x128 grid) gets cropped to the visible planning area
// instead of spilling out over the rest of the page.
const worldBgLayer = document.createElement("div");
worldBgLayer.className = "world-bg-layer";
worldBgLayer.hidden = true;
const worldBgCanvas = document.createElement("canvas");
worldBgLayer.appendChild(worldBgCanvas);
gridShell.appendChild(worldBgLayer);
const grid = document.createElement("div");
grid.className = "grid";
gridShell.appendChild(grid);
gridZoomSizer.appendChild(gridShell);

const zoomControls = document.createElement("div");
zoomControls.className = "grid-zoom-controls";
zoomControls.innerHTML = `
	<button type="button" data-zoom-in title="Zoom in">+</button>
	<button type="button" data-zoom-out title="Zoom out">&minus;</button>
	<button type="button" data-zoom-reset title="Reset zoom">⤢</button>
`;
document.body.appendChild(zoomControls);

// One map-wide compass instead of a badge on every single placed building's
// top-down render (see the showCompass: false passed to renderGrid below) -
// the grid's row/column convention is always north-up, so a single fixed
// indicator says that once for the whole map instead of repeating it on
// every tile.
const mapCompassEl = document.createElement("div");
mapCompassEl.className = "map-compass";
mapCompassEl.title = "North is up";
mapCompassEl.innerHTML = `<span class="map-compass__arrow">&#9650;</span><span class="map-compass__label">N</span>`;
document.body.appendChild(mapCompassEl);

const leftSidebar = document.createElement("aside");
leftSidebar.className = "left-sidebar";
leftSidebar.innerHTML = `
	<div class="left-sidebar__header">
		<h2 class="left-sidebar__title">Left Pane</h2>
		<button type="button" class="left-sidebar__toggle" data-left-toggle aria-expanded="true" aria-label="Collapse left pane">Collapse</button>
	</div>
	<div class="left-sidebar__content">
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">Edit History</h3>
			<div class="left-sidebar__button-row">
				<button type="button" class="left-sidebar__button" data-undo disabled>Undo</button>
				<button type="button" class="left-sidebar__button" data-redo disabled>Redo</button>
			</div>
			<button type="button" class="left-sidebar__button left-sidebar__button--danger" data-clear-board>Clear board</button>
		</div>
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">Building Display</h3>
			<label class="world-bg-controls__row">
				<input type="checkbox" data-rooftop-toggle />
				Show top-down renders
			</label>
			<p class="left-sidebar__hint">Where available, placed buildings show their real top-down render instead of a flat color block.</p>
			<label class="world-bg-controls__row">
				<input type="checkbox" data-door-toggle />
				Show doors
			</label>
			<p class="left-sidebar__hint">Marks exterior door locations on top-down renders (Building Preview and the planner grid).</p>
			<label class="world-bg-controls__row">
				<input type="checkbox" data-names-toggle checked />
				Show name tags & borders
			</label>
			<p class="left-sidebar__hint">Uncheck for a clean, unobstructed view of top-down renders - same as holding Left Ctrl, but sticky.</p>
			<label class="world-bg-controls__row">
				<input type="checkbox" data-grid-lines-toggle checked />
				Show grid lines
			</label>
			<p class="left-sidebar__hint">Hides the per-cell grid lines on the planner map.</p>
		</div>
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">Plan Check</h3>
			<div class="plan-check" data-plan-check></div>
		</div>
		<div class="left-sidebar__section">
			<h3 class="left-sidebar__section-title">World Background</h3>
			<p class="left-sidebar__hint">Upload region files (<code>.mca</code>) from a world save to see real terrain behind the grid.</p>
			<div class="left-sidebar__button-row">
				<button type="button" class="left-sidebar__button" data-bg-file-trigger>Choose files</button>
				<button type="button" class="left-sidebar__button" data-bg-folder-trigger>Choose folder</button>
			</div>
			<input type="file" accept=".mca" multiple hidden data-bg-file-input />
			<input type="file" webkitdirectory multiple hidden data-bg-folder-input />
			<p class="left-sidebar__hint" data-bg-status></p>
			<div class="world-bg-controls" data-bg-controls hidden>
				<label class="world-bg-controls__row">
					<input type="checkbox" data-bg-visible checked />
					Show background
				</label>
				<button type="button" class="left-sidebar__button" data-bg-remove>Remove background</button>
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
const clearBoardButton = leftSidebar.querySelector("[data-clear-board]");
const rooftopToggleCheckbox = leftSidebar.querySelector("[data-rooftop-toggle]");
const doorToggleCheckbox = leftSidebar.querySelector("[data-door-toggle]");
const namesToggleCheckbox = leftSidebar.querySelector("[data-names-toggle]");
const gridLinesToggleCheckbox = leftSidebar.querySelector("[data-grid-lines-toggle]");
const planCheckEl = leftSidebar.querySelector("[data-plan-check]");
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

// ---------- World background (upload a world save, show it behind the grid) ----------
// Reuses the same region-file parsing + biome-map rendering World Viewer
// uses (see world-terrain.js) - the only new part here is positioning that
// rendered map as a layer behind the placement grid instead of showing it on
// its own page. The planner's tile grid has no inherent relationship to real
// Minecraft coordinates (arbitrary origin), so alignment is a manual nudge
// (X/Z offset in blocks) rather than anything automatic - see the "Place
// buildings on the real-terrain map" item in TODO.md for the fuller design
// notes on why exact reconciliation is its own, bigger effort.
const bgFileTriggerButton = leftSidebar.querySelector("[data-bg-file-trigger]");
const bgFolderTriggerButton = leftSidebar.querySelector(
	"[data-bg-folder-trigger]",
);
const bgFileInput = leftSidebar.querySelector("[data-bg-file-input]");
const bgFolderInput = leftSidebar.querySelector("[data-bg-folder-input]");
const bgStatusEl = leftSidebar.querySelector("[data-bg-status]");
const bgControlsEl = leftSidebar.querySelector("[data-bg-controls]");
const bgVisibleCheckbox = leftSidebar.querySelector("[data-bg-visible]");
const bgRemoveButton = leftSidebar.querySelector("[data-bg-remove]");

let worldBackground = null; // { gridW, gridH, minCx, minCz, biomeAt }, set once a background is loaded - always anchored at grid origin (0, 0), no manual alignment
let bgUploadGeneration = 0; // same stale-response guard pattern as World Viewer's handleFiles

// A freshly-uploaded background's biomeAt() (from buildTerrainImage) is an
// in-memory closure over its full parse - gone after a reload, so it can't
// be saved directly. This compacts it down to one biome ID per 4x4-block
// cell (biomes never vary at finer resolution than that anyway) so hovering
// still shows a biome after loading a saved plan, not just right after an
// upload. ~32KB for a 512x512 area (128x128 cells) vs. ~700KB+ if the full
// per-block grid were serialized instead.
function buildCompactBiomeGrid(result) {
	const cellsX = Math.ceil(result.gridW / 4);
	const cellsZ = Math.ceil(result.gridH / 4);
	const names = [null];
	const ids = new Map();
	const grid = new Array(cellsX * cellsZ).fill(0);
	for (let cz = 0; cz < cellsZ; cz++) {
		for (let cx = 0; cx < cellsX; cx++) {
			const worldX = result.minCx * 16 + cx * 4 + 2;
			const worldZ = result.minCz * 16 + cz * 4 + 2;
			const info = result.biomeAt(worldX, worldZ);
			if (!info || !info.biome) continue;
			let id = ids.get(info.biome);
			if (id === undefined) {
				id = names.length;
				names.push(info.biome);
				ids.set(info.biome, id);
			}
			grid[cz * cellsX + cx] = id;
		}
	}
	return { cellsX, cellsZ, names, grid };
}

function biomeAtFromCompact(compact, minCx, minCz, worldX, worldZ) {
	const cx = Math.floor((worldX - minCx * 16) / 4);
	const cz = Math.floor((worldZ - minCz * 16) / 4);
	if (cx < 0 || cx >= compact.cellsX || cz < 0 || cz >= compact.cellsZ)
		return null;
	const id = compact.grid[cz * compact.cellsX + cx];
	return id ? { biome: compact.names[id] } : null;
}

function applyWorldBgVisibility() {
	const visible = bgVisibleCheckbox.checked;
	worldBgLayer.hidden = !worldBackground || !visible;
	grid.classList.toggle("has-world-bg", Boolean(worldBackground) && visible);
}

function removeWorldBackground() {
	worldBackground = null;
	bgUploadGeneration++; // invalidate any in-flight parse
	worldBgLayer.hidden = true;
	grid.classList.remove("has-world-bg");
	bgControlsEl.hidden = true;
	bgStatusEl.textContent = "";
	bgFileInput.value = "";
	bgFolderInput.value = "";
}

// How much grid the currently-placed buildings/roads actually need - used
// so loading a background can size the grid EXACTLY to the uploaded area
// (no leftover empty space, no manual resize) without ever cutting off
// something already placed outside that area.
function computeContentExtent() {
	let maxX = 0;
	let maxY = 0;
	for (const placed of placedSquares) {
		maxX = Math.max(maxX, placed.x + placed.w);
		maxY = Math.max(maxY, placed.y + placed.h);
	}
	for (const path of paths) {
		for (const cell of path.cells) {
			maxX = Math.max(maxX, cell.x + 1);
			maxY = Math.max(maxY, cell.y + 1);
		}
	}
	return { maxX, maxY };
}

function drawWorldBgCanvas(source, gridW, gridH) {
	worldBgCanvas.width = gridW;
	worldBgCanvas.height = gridH;
	worldBgCanvas.getContext("2d").drawImage(source, 0, 0);
	// Displayed at cellSize px/block (matching the placement grid exactly -
	// 1 cell = 1 block), scaled up from the canvas's native 1px/block via
	// CSS width/height rather than redrawing, keeping the "pixelated" crisp
	// look instead of a blurred resample. Always anchored at (0, 0) - no
	// offset controls, since the grid is sized to match the background
	// exactly (see computeContentExtent above) rather than needing manual
	// alignment nudges.
	worldBgCanvas.style.width = `${gridW * cellSize}px`;
	worldBgCanvas.style.height = `${gridH * cellSize}px`;
	worldBgCanvas.style.left = "0px";
	worldBgCanvas.style.top = "0px";
}

async function handleBackgroundFiles(files) {
	const myGeneration = ++bgUploadGeneration;
	const isStale = () => myGeneration !== bgUploadGeneration;
	// No background yet this session (nothing restored from autosave/a named
	// plan either) - jump the view to real-world (0, 0) once this upload
	// lands, so the user isn't left staring at wherever the grid happened to
	// be scrolled instead of the terrain they just loaded. A later re-upload
	// (worldBackground already set) leaves the view alone - the user is
	// presumably already looking at the area they care about by then.
	const shouldJumpToOrigin = !worldBackground;

	bgStatusEl.textContent = `Parsing ${files.length} region file${files.length === 1 ? "" : "s"}…`;

	const result = await window.WorldTerrain.buildTerrainImage(files, {
		onStatus: (text) => {
			if (!isStale()) bgStatusEl.textContent = text;
		},
		isStale,
	});
	if (isStale() || result.stale) return;

	if (!result.ok) {
		bgStatusEl.textContent = result.message;
		return;
	}

	drawWorldBgCanvas(result.canvas, result.gridW, result.gridH);

	// The grid matches the uploaded area exactly - not "at least as big",
	// so there's no leftover dead space you'd otherwise have to scroll past
	// - except it still won't shrink below whatever's already placed, so
	// swapping to a smaller background never strands existing buildings.
	const extent = computeContentExtent();
	cols = Math.max(result.gridW, extent.maxX);
	rows = Math.max(result.gridH, extent.maxY);
	updateGridSize();

	worldBackground = {
		gridW: result.gridW,
		gridH: result.gridH,
		minCx: result.minCx,
		minCz: result.minCz,
		biomeAt: result.biomeAt,
		biomeCompact: buildCompactBiomeGrid(result),
	};
	bgControlsEl.hidden = false;
	applyWorldBgVisibility();
	scheduleAutoSave();

	if (shouldJumpToOrigin) {
		centerGridOn(-worldBackground.minCx * 16, -worldBackground.minCz * 16);
	}

	const loadedCount = files.length - result.fileErrors.length;
	const successMsg = `Loaded ${result.totalChunks.toLocaleString()} chunks from ${loadedCount} file${loadedCount === 1 ? "" : "s"} (${result.gridW}×${result.gridH} blocks).`;
	bgStatusEl.textContent = result.fileErrors.length
		? `${successMsg} Skipped ${result.fileErrors.length}: ${result.fileErrors.join("; ")}`
		: successMsg;
}

// Background persistence (autosave/JSON export/named plans - NOT undo
// history, see serializePlan's includeBackground option) stores the
// rendered map as a PNG data URL rather than the original .mca files, so a
// saved/reloaded plan doesn't depend on re-uploading anything. Restoring is
// async (Image loading), unlike everything else applyPlanData() does.
function getWorldBackgroundSaveData() {
	if (!worldBackground) return null;
	return {
		dataUrl: worldBgCanvas.toDataURL("image/png"),
		gridW: worldBackground.gridW,
		gridH: worldBackground.gridH,
		minCx: worldBackground.minCx,
		minCz: worldBackground.minCz,
		biomeCompact: worldBackground.biomeCompact,
	};
}

// ----- Background image storage (IndexedDB) -----
// getWorldBackgroundSaveData() above embeds the map PNG directly as a data
// URL - fine for a one-off JSON export/share (the whole point there is one
// self-contained portable file), but wrong for autosave/named plans: those
// live in localStorage, which shares a single small quota (~5-10MB
// depending on browser) across EVERY key on the origin - the plan data
// itself is a few KB, but a background from even a handful of uploaded
// region files can be a multi-MB base64 PNG, so it was the thing actually
// blowing the budget. The previous behavior (still kept below as a
// fallback) caught the write failing and told the user to re-upload after
// reload - correct, but avoidable: IndexedDB has no comparable shared-quota
// problem (browsers grant it a share of available disk space, normally
// orders of magnitude more room), so storing the image there instead means
// the background just survives a refresh like everything else does.
const BG_IDB_NAME = "minecolonies-planner";
const BG_IDB_STORE = "backgrounds";
const AUTOSAVE_BG_IDB_KEY = "autosave";
let bgIdbPromise = null;

function openBgIdb() {
	if (!bgIdbPromise) {
		bgIdbPromise = new Promise((resolve, reject) => {
			if (!window.indexedDB) {
				reject(new Error("IndexedDB unavailable"));
				return;
			}
			const request = window.indexedDB.open(BG_IDB_NAME, 1);
			request.onupgradeneeded = () =>
				request.result.createObjectStore(BG_IDB_STORE);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	return bgIdbPromise;
}

async function idbPutBackground(key, dataUrl) {
	const db = await openBgIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(BG_IDB_STORE, "readwrite");
		tx.objectStore(BG_IDB_STORE).put(dataUrl, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

async function idbGetBackground(key) {
	const db = await openBgIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(BG_IDB_STORE, "readonly");
		const request = tx.objectStore(BG_IDB_STORE).get(key);
		request.onsuccess = () => resolve(request.result ?? null);
		request.onerror = () => reject(request.error);
	});
}

async function idbDeleteBackground(key) {
	const db = await openBgIdb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(BG_IDB_STORE, "readwrite");
		tx.objectStore(BG_IDB_STORE).delete(key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

// Deliberately just the 4 fixed-size fields - constant regardless of how
// much area was uploaded. biomeCompact used to live here too, which was
// still wrong even after moving dataUrl out below: it's one entry per
// 4x4-block cell (see buildCompactBiomeGrid's own comment - "~32KB for a
// 512x512 area... vs 700KB+ unc compacted"), so it scales with upload size
// exactly like the image does. A big-enough multi-file upload (a dozen-plus
// region files) grows it past what's left of localStorage's quota on its
// own, image or no image - which is exactly "uploads a lot of files, then
// the background doesn't survive a reload" with no size-related message to
// explain why, since the quota error was being thrown from a JSON.stringify
// of what looked like "just metadata."
function getWorldBackgroundMetadata() {
	if (!worldBackground) return null;
	return {
		gridW: worldBackground.gridW,
		gridH: worldBackground.gridH,
		minCx: worldBackground.minCx,
		minCz: worldBackground.minCz,
	};
}

// The local-persistence counterpart to getWorldBackgroundSaveData(): writes
// the image AND the biome grid (the two fields that actually scale with
// upload size) to IndexedDB together under idbKey, returning only the small
// fixed-size metadata for localStorage. Falls back to the old fully-inline
// shape if IndexedDB itself isn't available (e.g. some private-browsing
// modes) - worse odds of fitting under quota, same as before this change,
// but never worse than before.
async function getWorldBackgroundSaveDataLocal(idbKey) {
	if (!worldBackground) return null;
	const meta = getWorldBackgroundMetadata();
	const payload = {
		dataUrl: worldBgCanvas.toDataURL("image/png"),
		biomeCompact: worldBackground.biomeCompact,
	};
	try {
		await idbPutBackground(idbKey, payload);
		return meta;
	} catch {
		return { ...meta, ...payload };
	}
}

// Restore-side counterpart: bg.dataUrl already being present means either an
// imported/exported JSON file (always self-contained) or the IndexedDB-
// unavailable fallback above - either way, nothing more to fetch. Otherwise
// look the image+biome payload up in IndexedDB by idbKey; a miss (nothing
// stored, or the entry was cleaned up) just means no background to restore,
// not an error.
async function resolveBackgroundForRestore(bg, idbKey) {
	if (!bg) return null;
	if (bg.dataUrl) return bg;
	if (!idbKey) return null;
	try {
		const payload = await idbGetBackground(idbKey);
		return payload ? { ...bg, ...payload } : null;
	} catch {
		return null;
	}
}

function namedPlanBgIdbKey(name) {
	return `plan:${name}`;
}

async function restoreWorldBackgroundFromSaved(bg) {
	if (!bg || !bg.dataUrl) {
		removeWorldBackground();
		return;
	}
	// bg comes straight from an imported plan's JSON - dataUrl is only ever
	// meant to be what getWorldBackgroundSaveData() itself wrote
	// (canvas.toDataURL, always "data:image/..."), but a hand-edited or
	// maliciously shared plan file could set it to an arbitrary URL instead
	// (e.g. "https://attacker.example/beacon.png"). Assigning that straight
	// to img.src would make the browser silently fetch it - a real network
	// request leaking the viewer's IP/User-Agent to whoever crafted the file,
	// contradicting this app's whole "nothing is uploaded anywhere, parsing
	// happens entirely in the browser" design. Reject anything that isn't
	// actually a data: URI before it ever reaches an <img>.
	if (typeof bg.dataUrl !== "string" || !/^data:image\//.test(bg.dataUrl)) {
		removeWorldBackground();
		return;
	}
	const img = new Image();
	try {
		await new Promise((resolve, reject) => {
			img.onload = resolve;
			img.onerror = () => reject(new Error("image decode failed"));
			img.src = bg.dataUrl;
		});
	} catch {
		removeWorldBackground();
		return;
	}
	drawWorldBgCanvas(img, bg.gridW, bg.gridH);
	worldBackground = {
		gridW: bg.gridW,
		gridH: bg.gridH,
		minCx: bg.minCx,
		minCz: bg.minCz,
		biomeAt:
			bg.biomeCompact && Number.isFinite(bg.minCx)
				? (worldX, worldZ) =>
						biomeAtFromCompact(
							bg.biomeCompact,
							bg.minCx,
							bg.minCz,
							worldX,
							worldZ,
						)
				: null,
		biomeCompact: bg.biomeCompact || null,
	};
	bgControlsEl.hidden = false;
	applyWorldBgVisibility();
}

bgFileTriggerButton.addEventListener("click", () => bgFileInput.click());
bgFileInput.addEventListener("change", () => {
	if (bgFileInput.files && bgFileInput.files.length) {
		handleBackgroundFiles(
			window.WorldTerrain.filterMcaFiles([...bgFileInput.files]),
		);
	}
});

bgFolderTriggerButton.addEventListener("click", () => bgFolderInput.click());
bgFolderInput.addEventListener("change", () => {
	const files = window.WorldTerrain.filterMcaFiles([
		...(bgFolderInput.files || []),
	]);
	if (files.length) handleBackgroundFiles(files);
	else bgStatusEl.textContent = "No .mca region files found in that folder.";
});

bgVisibleCheckbox.addEventListener("change", applyWorldBgVisibility);

worldBgLayer.style.opacity = "1";

bgRemoveButton.addEventListener("click", () => {
	removeWorldBackground();
	scheduleAutoSave();
});

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

const previewSidebar = document.createElement("aside");
previewSidebar.className = "preview-sidebar";
previewSidebar.innerHTML = `
	<div class="preview-sidebar__header">
		<h2 class="preview-sidebar__title">Building Preview</h2>
		<button type="button" class="preview-sidebar__toggle" data-preview-toggle aria-expanded="true" aria-label="Collapse preview pane">Collapse</button>
	</div>
	<form class="grid-goto-controls" data-goto-form>
		<label>X <input type="number" step="1" inputmode="numeric" data-goto-x /></label>
		<label>Z <input type="number" step="1" inputmode="numeric" data-goto-z /></label>
		<button type="submit">Go</button>
	</form>
	<div class="hover-coords" data-hover-coords hidden>
		<span data-hover-coords-pos></span>
		<span class="hover-coords__biome" data-hover-coords-biome></span>
	</div>
	<div class="preview-card">
		<div class="preview-card__name" data-preview-name>Select a building</div>
		<div class="preview-card__view-toggle" data-preview-view-toggle hidden>
			<button type="button" class="preview-card__view-btn is-active" data-preview-view="front">Front</button>
			<button type="button" class="preview-card__view-btn" data-preview-view="top">Top-down</button>
		</div>
		<div class="preview-card__image-wrap">
			<img class="preview-card__image" data-preview-image alt="Selected building preview" />
			<canvas class="preview-card__canvas" data-preview-canvas hidden></canvas>
			<div class="preview-card__topdown-label" data-preview-topdown-label hidden></div>
			<div class="preview-card__empty" data-preview-empty>
				Select a building from the tray to see its front view.
			</div>
		</div>
	</div>
	<div class="cost-card" data-cost-card hidden>
		<div class="cost-card__levels" data-cost-levels></div>
		<div class="cost-card__body" data-cost-body></div>
	</div>
`;
document.body.appendChild(previewSidebar);

// Same "type a coordinate, jump there" tool as World Viewer's goto form -
// if a world background is loaded, X/Z are interpreted as real in-game
// coordinates (converted through its minCx/minCz, same math as the hover
// tooltip); otherwise there's no "world" reference point to convert
// against, so they're just plain grid cell coordinates.
const gotoControls = previewSidebar.querySelector("[data-goto-form]");
const gotoXInput = gotoControls.querySelector("[data-goto-x]");
const gotoZInput = gotoControls.querySelector("[data-goto-z]");

const previewName = previewSidebar.querySelector("[data-preview-name]");
const previewImage = previewSidebar.querySelector("[data-preview-image]");
const previewCanvas = previewSidebar.querySelector("[data-preview-canvas]");
const previewTopDownLabel = previewSidebar.querySelector("[data-preview-topdown-label]");
const previewViewToggle = previewSidebar.querySelector("[data-preview-view-toggle]");
const previewEmpty = previewSidebar.querySelector("[data-preview-empty]");
const hoverCoordsEl = previewSidebar.querySelector("[data-hover-coords]");
const hoverCoordsPosEl = previewSidebar.querySelector(
	"[data-hover-coords-pos]",
);
const hoverCoordsBiomeEl = previewSidebar.querySelector(
	"[data-hover-coords-biome]",
);
const previewToggleButton = previewSidebar.querySelector(
	"[data-preview-toggle]",
);
const costCard = previewSidebar.querySelector("[data-cost-card]");
const costLevelsEl = previewSidebar.querySelector("[data-cost-levels]");
const costBodyEl = previewSidebar.querySelector("[data-cost-body]");
let selectedCostLevel = 1;
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
	grid.style.width = `${gridWidth}px`;
	grid.style.height = `${gridHeight}px`;
	// Crop window always matches the grid's current size exactly, whether or
	// not a background is loaded yet - cheap to keep in sync here rather
	// than re-deriving it wherever the grid can grow (several "+ Row"/"+
	// Column" handlers, JSON import, ...).
	worldBgLayer.style.width = `${gridWidth}px`;
	worldBgLayer.style.height = `${gridHeight}px`;
	applyGridZoom();
}

// ----- Grid zoom -----
// .grid-shell is visually scaled via CSS transform; the sizer's own
// width/height (what #root actually scrolls) are kept in step so native
// scrollbars reflect the zoomed size. Pointer-to-block math (getCellFromPoint
// etc.) divides by cellSize * gridZoom instead of bare cellSize so clicks
// still land on the right cell at any zoom level - everything else (element
// positions, menu placement) stays in the grid's natural/unzoomed pixel
// space and rides along with the transform automatically.
let gridZoom = 1;
const MIN_GRID_ZOOM = 0.5;
const MAX_GRID_ZOOM = 4;

function applyGridZoom() {
	gridShell.style.transform = `scale(${gridZoom})`;
	gridZoomSizer.style.width = `${gridWidth * gridZoom}px`;
	gridZoomSizer.style.height = `${gridHeight * gridZoom}px`;
}

function setGridZoom(nextZoom, anchorClientX, anchorClientY) {
	const clamped = Math.max(MIN_GRID_ZOOM, Math.min(MAX_GRID_ZOOM, nextZoom));
	if (clamped === gridZoom) return;
	// Keep whatever content point was under the anchor (cursor, or viewport
	// center for the +/- buttons) still under it after the zoom changes -
	// otherwise every zoom click recenters on the grid's origin instead of
	// where you're actually looking, which reads as the view "jumping".
	const rootRect = root.getBoundingClientRect();
	const beforeX = anchorClientX - rootRect.left + root.scrollLeft;
	const beforeY = anchorClientY - rootRect.top + root.scrollTop;
	const contentX = beforeX / gridZoom;
	const contentY = beforeY / gridZoom;
	gridZoom = clamped;
	applyGridZoom();
	root.scrollLeft = contentX * gridZoom - (anchorClientX - rootRect.left);
	root.scrollTop = contentY * gridZoom - (anchorClientY - rootRect.top);
}

const zoomInButton = zoomControls.querySelector("[data-zoom-in]");
const zoomOutButton = zoomControls.querySelector("[data-zoom-out]");
const zoomResetButton = zoomControls.querySelector("[data-zoom-reset]");

function zoomAtViewportCenter(factor) {
	const rect = root.getBoundingClientRect();
	setGridZoom(
		gridZoom * factor,
		rect.left + rect.width / 2,
		rect.top + rect.height / 2,
	);
}

zoomInButton.addEventListener("click", () => zoomAtViewportCenter(1.25));
zoomOutButton.addEventListener("click", () => zoomAtViewportCenter(1 / 1.25));
zoomResetButton.addEventListener("click", () =>
	zoomAtViewportCenter(1 / gridZoom),
);

// cellX/cellY are in the grid's own unzoomed cell space (1 cell = 1 block) -
// scrolls #root (the native scroll container, same one setGridZoom reads/
// writes) so that point ends up centered in the visible viewport at
// whatever zoom is already set.
function centerGridOn(cellX, cellY) {
	const rect = root.getBoundingClientRect();
	root.scrollLeft = cellX * cellSize * gridZoom - rect.width / 2;
	root.scrollTop = cellY * cellSize * gridZoom - rect.height / 2;
}

gotoControls.addEventListener("submit", (event) => {
	event.preventDefault();
	const x = Number(gotoXInput.value);
	const z = Number(gotoZInput.value);
	if (!Number.isFinite(x) || !Number.isFinite(z)) return;
	const cellX = worldBackground ? x - worldBackground.minCx * 16 : x;
	const cellY = worldBackground ? z - worldBackground.minCz * 16 : z;
	centerGridOn(cellX, cellY);
});

// ----- Remember scroll/zoom position across a reload -----
// Small and self-contained (zoom + two scroll offsets), so no need for the
// IndexedDB treatment the world background needed - this easily fits
// localStorage's quota on its own regardless of grid size.
const GRID_VIEW_STORAGE_KEY = "minecolonies.gridView.v1";
let gridViewSaveTimer = null;

function saveGridView() {
	if (gridViewSaveTimer) clearTimeout(gridViewSaveTimer);
	gridViewSaveTimer = setTimeout(() => {
		gridViewSaveTimer = null;
		try {
			window.localStorage.setItem(
				GRID_VIEW_STORAGE_KEY,
				JSON.stringify({
					zoom: gridZoom,
					scrollLeft: root.scrollLeft,
					scrollTop: root.scrollTop,
				}),
			);
		} catch {
			// localStorage may be unavailable - view position just won't
			// survive a reload, not worth surfacing as a user-facing error.
		}
	}, 300);
}

// Scroll fires for BOTH user-driven scrolling and the programmatic
// scrollLeft/scrollTop writes setGridZoom() and centerGridOn() already make,
// so this one listener alone covers panning, zooming, and the goto-
// coordinates tool without needing to call saveGridView() from each of them
// separately.
root.addEventListener("scroll", saveGridView);

// Needs the grid already sized to its final dimensions (rows/cols from a
// restored plan can resize it) - otherwise the browser clamps scrollLeft/Top
// against whatever smaller scrollable area existed at that point, and the
// saved position is silently lost. Called from the bottom of the initial
// load chain below, after any autosaved plan has finished restoring.
function restoreGridView() {
	try {
		const raw = window.localStorage.getItem(GRID_VIEW_STORAGE_KEY);
		if (!raw) return;
		const saved = JSON.parse(raw);
		if (Number.isFinite(saved.zoom)) {
			gridZoom = Math.max(MIN_GRID_ZOOM, Math.min(MAX_GRID_ZOOM, saved.zoom));
			applyGridZoom();
		}
		if (Number.isFinite(saved.scrollLeft)) root.scrollLeft = saved.scrollLeft;
		if (Number.isFinite(saved.scrollTop)) root.scrollTop = saved.scrollTop;
	} catch {
		// corrupt/missing saved view - just start at the default (0,0) origin.
	}
}

// Ctrl/Cmd+wheel to zoom (matches the Figma/Google-Maps convention, and
// what browsers report a trackpad pinch gesture as) - plain wheel/trackpad
// scroll is left alone entirely so #root's native scrolling keeps working
// unmodified for panning.
root.addEventListener(
	"wheel",
	(event) => {
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
		setGridZoom(gridZoom * factor, event.clientX, event.clientY);
	},
	{ passive: false },
);

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

// Eraser hover preview - a square outline showing exactly which cells a
// click would erase (mirrors stampBrush's own footprint math), shown
// whenever the eraser is armed so the width can be judged before clicking.
const eraserHoverEl = document.createElement("div");
eraserHoverEl.className = "eraser-hover-preview";
grid.appendChild(eraserHoverEl);

// Marquee (rubber-band) select - left-drag on empty grid space draws this
// (Shift adds to the existing selection instead of replacing it),
// live-selecting every placed building whose footprint overlaps it.
const marqueeEl = document.createElement("div");
marqueeEl.className = "marquee-select";
grid.appendChild(marqueeEl);

// Wall-draw preview - shown while right-click-dragging a "walls" run,
// before the real schematic pieces get placed on release (see
// WALL_KITS/placeWallRun).
const wallDrawPreviewEl = document.createElement("div");
wallDrawPreviewEl.className = "wall-draw-preview";
grid.appendChild(wallDrawPreviewEl);

// Grid size is fixed generously large (see `rows`/`cols` above, auto-grown
// further to fit an uploaded world background) rather than incrementally
// expandable via +Row/+Col buttons - the grid is meant to be big enough to
// scroll around in #root's native scroll viewport instead, so buildings can
// go anywhere without a resize step first.

const ARROW_KEY_DELTAS = {
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
};

document.addEventListener("keydown", (event) => {
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
		if (key === "c") {
			if (selectedPlaced.size) {
				event.preventDefault();
				copySelection();
			}
			return;
		}
		if (key === "v") {
			if (clipboard) {
				event.preventDefault();
				pasteClipboard();
			}
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

// Typing here searches shape labels across EVERY category at once (not just
// the active tab) - the whole point is skipping the category/subcategory
// digging, not just narrowing whatever tab happens to be open already. See
// renderShapeTray()'s visibleShapes computation for how a non-empty query
// takes over from the normal tab/subcategory filter.
const shapeSearchInput = document.createElement("input");
shapeSearchInput.type = "search";
shapeSearchInput.className = "shape-search-input";
shapeSearchInput.placeholder = "Search buildings...";
let shapeSearchQuery = "";
shapeSearchInput.addEventListener("input", () => {
	shapeSearchQuery = shapeSearchInput.value.trim().toLowerCase();
	renderShapeTray();
});

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
	// Not a shape category like the others (shapes never have category:
	// "roads") - a fixed extra tab for the road/river paintbrush tool.
	// setActiveTab() special-cases this id to arm/disarm pathToolActive, and
	// renderShapeTray() swaps in pathControls instead of building shapes.
	{ id: "roads", label: "Roads & Rivers" },
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
bottomTop.appendChild(shapeSearchInput);

// The road/river paintbrush's controls - NOT appended into bottomTop here.
// Instead renderShapeTray() moves this whole block into the shape tray
// itself whenever the "Roads & Rivers" tab is active (see below), the same
// place building shapes normally show, rather than living as a separate
// always-visible bar. Created once up front (not rebuilt per render) so its
// event listeners and current values survive being detached/reattached.
const pathControls = document.createElement("div");
pathControls.className = "path-controls";
pathControls.innerHTML = `
	<p class="path-controls__hint" data-path-controls-hint></p>
	<div class="path-type-picker" data-path-type-picker></div>
	<div class="path-controls__row">
		<label class="path-controls__field" data-path-width-field>
			Width
			<input type="number" min="1" max="10" step="1" data-path-width-input />
		</label>
		<button type="button" class="path-controls__erase-toggle" data-path-erase-toggle>Eraser</button>
	</div>
`;
const pathTypePicker = pathControls.querySelector("[data-path-type-picker]");
const pathWidthInput = pathControls.querySelector("[data-path-width-input]");
const pathWidthField = pathControls.querySelector("[data-path-width-field]");
const pathEraseToggleButton = pathControls.querySelector("[data-path-erase-toggle]");
const pathControlsHintEl = pathControls.querySelector("[data-path-controls-hint]");

// "walls" places real schematic buildings on a straight drag (see
// WALL_KITS/placeWallRun) instead of painting cells with an adjustable
// brush width, so the Width field and Eraser toggle don't apply to it -
// hidden rather than left active-but-meaningless. Turns the eraser back
// off on the way in/out too, since "erase" has no effect on walls mode
// (they're not painted path cells) and leaving it toggled on would be
// confusing next time a paintable type gets picked again.
function updatePathControlsForType() {
	const isWalls = pathType === "walls";
	pathWidthField.hidden = isWalls;
	pathEraseToggleButton.hidden = isWalls;
	if (isWalls && pathEraseMode) setPathEraseMode(false);
	pathControlsHintEl.textContent = isWalls
		? "Click and drag a straight run to place real wall pieces (segments auto-tiled, corners merged where two runs meet). Right-click drag to pan the map."
		: "Click and drag on the grid to paint (or erase). Hold Shift for a straight line. Right-click drag to pan the map.";
}

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
let pendingPan = null; // click-and-drag panning on empty grid space - same pending/threshold pattern as pendingDrag above
let isPanning = false;
let pendingMarquee = null; // Left-drag rubber-band select on empty grid space (Shift adds to selection) - same pending/threshold pattern as pendingPan
let isMarqueeSelecting = false;
const selectedPlaced = new Set();
let selectedPrimary = null;
let duplicateMode = false;
let duplicateGroup = null;
// Ctrl+C snapshot of the selection at copy time (plain shape data, not live
// placedSquares/DOM references, so it survives the originals being deleted
// or moved) - Ctrl+V re-arms duplicateMode/duplicateGroup from this on every
// press, same "click to stamp" placement flow the Duplicate button already
// uses, so it can be pasted repeatedly instead of being consumed by one paste.
let clipboard = null;
let selectedShapeId = null;
let pendingRotated = false;
let shapes = [];
let activeTab = "farming";
let activeSubcategory = "all";

// Path tool state
let pathWidth = 5; // in blocks, 1-10, adjustable via pathWidthInput
let pathType = "default"; // one of ROAD_TYPE_COLORS' keys, or "default"
let pathToolActive = false;
let pathEraseMode = false; // paint (add) vs erase (remove) - toggled by pathEraseToggleButton
let pathErasing = false; // actively dragging an erase stroke (mirrors pathPainting for paint strokes)
let nextPathId = 1;
const paths = []; // {id, type, width, cells: [{x,y}], elements}
let pathPainting = false; // actively dragging a brush stroke
let paintPathId = null; // the path being built by the in-progress stroke
let paintLastCell = null; // last stamped cell, to interpolate across sparse pointermove samples - shared by both paint and erase strokes, which never run at the same time
let paintCellSet = null; // Set<"x,y"> of the in-progress stroke's cells, mirrors paintPathId's path.cells
// Hold-Shift-to-snap-straight state. shiftLineAnchor is the cell the current
// straight segment started from (wherever the brush was when Shift first
// went down, not necessarily the whole stroke's start) - null whenever
// Shift isn't currently constraining the stroke. shiftLineBaseline is a
// snapshot of paintCellSet taken at that same moment, so the live preview
// while Shift is held can be recomputed fresh on every move (baseline plus
// just the current straight segment) without old candidate endpoints from
// earlier in the drag leaving stray cells behind.
let shiftLineAnchor = null;
let shiftLineBaseline = null;
let selectedPathId = null; // tracks selected path for menu
let pathDragPending = null; // {pointerId, startCell, pathId, origCells}
let pathDragging = false;
let suppressPathClick = false;
let wallDrawPending = null; // {pointerId, startCell} - "walls" type draws real schematic pieces, not painted cells (see WALL_KITS/placeWallRun)
let wallDrawing = false;
let wallDrawAxis = null; // locked to "horizontal" or "vertical" once the drag moves enough to tell

// Repopulated whenever the active style changes (called from applyStyle) -
// different styles expose different road families, so the option list
// itself is style-dependent, not just the colors behind it.
// A click-to-arm swatch picker (like an old paint program's tool palette)
// instead of a <select> dropdown - each button shows the type's actual
// paint color (falling back to the theme's default path color for
// "default", which has no entry in ROAD_TYPE_COLORS) so the type can be
// recognized at a glance, the same way the color itself already identifies
// a painted road/river/wall on the grid.
function renderPathTypeOptions() {
	const types = getAvailableRoadTypes();
	if (!types.includes(pathType)) pathType = "default";
	pathTypePicker.innerHTML = types
		.map((t) => {
			const color = Object.hasOwn(ROAD_TYPE_COLORS, t)
				? ROAD_TYPE_COLORS[t]
				: "var(--path-cell-bg)";
			// "walls" is the one type here that doesn't paint a flat color at
			// all - it drags out real schematic buildings instead (see
			// getAvailableRoadTypes' comment on why it's always last) - a
			// leading divider plus a squared-off "building", not a color dot,
			// swatch flags that difference before the click, not just in the
			// hint text below the row.
			const isWalls = t === "walls";
			return `
				<button
					type="button"
					class="path-type-swatch${t === pathType ? " is-active" : ""}${isWalls ? " path-type-swatch--building" : ""}"
					data-path-type-option="${t}"
					title="${roadTypeLabel(t)}${isWalls ? " (places real buildings, not a paint color)" : ""}"
				>
					<span class="path-type-swatch__color" style="background:${color};"></span>
					<span class="path-type-swatch__label">${roadTypeLabel(t)}</span>
				</button>
			`;
		})
		.join("");
	updatePathControlsForType();
}

pathTypePicker.addEventListener("click", (event) => {
	const button = event.target.closest("[data-path-type-option]");
	if (!button) return;
	pathType = button.dataset.pathTypeOption;
	pathTypePicker
		.querySelectorAll(".path-type-swatch")
		.forEach((el) =>
			el.classList.toggle("is-active", el === button),
		);
	updatePathControlsForType();
});

pathWidthInput.value = pathWidth;
pathWidthInput.addEventListener("change", () => {
	const next = Math.round(Number(pathWidthInput.value));
	pathWidth = Number.isFinite(next)
		? Math.max(1, Math.min(10, next))
		: pathWidth;
	pathWidthInput.value = pathWidth;
});

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
	walls: [
		"corners",
		"gates",
		"misc",
		"stairs",
		"walls",
		"corner",
		"gate",
		"segment",
		"tower",
	],
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
	// The "Roads & Rivers" tab IS the path tool's on/off switch now (no more
	// separate always-visible toggle button) - entering it arms painting,
	// leaving it disarms painting and resets back to paint (not erase) mode
	// for next time, so it doesn't silently stay in erase mode across visits.
	pathToolActive = tabId === "roads";
	if (!pathToolActive) setPathEraseMode(false);
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

// Flat colors for the road paintbrush tool below, one per "infrastructure"
// road family a style might define (roads/alleys/avenues/birail/monorail/
// canal - the same subcategory keys subcategoryMap.infrastructure already
// uses for the shape tray). NOT the family's real structural pieces - those
// stay individually placeable shapes with real footprints/junctions, same as
// any other building. Painting doesn't need to pick a specific corner/tee/
// straight piece per cell since overlapping same-colored cells already
// reads fine visually with no auto-tiling needed, so this just gives each
// family a distinct, recognizable color when a style defines more than one.
// "default" (no color here) always exists as a fallback for a style with no
// road-family shapes at all (medievalspruce only has real infrastructure
// shapes for "canal") and reads from the --path-cell-bg/-border theme
// variables the tool always used. canal itself is always offered regardless
// of style even so - see getAvailableRoadTypes below.
const ROAD_TYPE_COLORS = {
	roads: "rgba(185, 167, 137, 0.55)",
	alleys: "rgba(120, 120, 120, 0.5)",
	avenues: "rgba(201, 160, 106, 0.55)",
	birail: "rgba(90, 75, 60, 0.6)",
	monorail: "rgba(110, 140, 165, 0.55)",
	// Was BIOME_COLORS["minecraft:river"]'s exact #2941a0 (a muddy, quite
	// dark navy on its own) - switched to BIOME_KEYWORD_COLORS' river/lake/
	// lagoon reference blue (#3355DD, also in world-terrain.js) instead,
	// noticeably brighter/more saturated, since a canal painted next to a
	// real river on an uploaded world background should read as the same
	// kind of water, not a visibly darker one. Fully opaque (no alpha),
	// unlike every other type here - see ROAD_TYPE_SOLID below.
	canal: "#3355DD",
	// Not an infrastructure subcategory like the rest of these - "walls" is
	// its own top-level shape category (the real corner/gate/tower/segment
	// pieces, still individually placeable same as ever). This is just a
	// quick freehand sketch of a wall line/boundary, stone-grey to read as
	// distinct from every road/path color above. See getAvailableRoadTypes
	// below for how it's gated on the style actually having wall shapes.
	walls: "rgba(150, 150, 156, 0.6)",
};

// Road types painted fully solid with no per-cell grid lines, instead of the
// shared semi-transparent-with-borders look every other type uses - a canal
// should read as one continuous body of water, not a grid of bordered water
// tiles.
const ROAD_TYPE_SOLID = new Set(["canal"]);

function getAvailableRoadTypes() {
	const found = new Set();
	let hasWalls = false;
	for (const shape of shapes) {
		if (shape.category === "walls") {
			hasWalls = true;
			continue;
		}
		if (shape.category !== "infrastructure") continue;
		const sub = getSubcategory(shape);
		if (Object.hasOwn(ROAD_TYPE_COLORS, sub)) found.add(sub);
	}
	// Unlike every other type here, canal never places a real schematic
	// piece - it's a flat paint color only (see the module comment above),
	// so it doesn't need the active style to define any actual canal_*
	// shapes to be usable. Caledonia has none (only medievalspruce does),
	// which used to hide the option entirely for no functional reason.
	found.add("canal");
	// "walls" pinned last (not sorted in with the rest) rather than landing
	// wherever it happens to fall alphabetically - it's the one type here
	// that behaves completely differently from a paint color (drags out
	// real schematic buildings instead, see the comment below), so keeping
	// it in a stable, separated spot at the end of the row makes that
	// easier to notice than if it could shuffle in among the paint swatches
	// depending on which other types a style happens to define.
	found.delete("walls");
	const sorted = [...found].sort();
	if (hasWalls) sorted.push("walls");
	return ["default", ...sorted];
}

// Unlike every other road/river type, "walls" doesn't paint flat-colored
// path cells at all - drawing one places the style's REAL wall schematic
// buildings (segment + corner pieces), auto-tiled along the drawn line,
// the same individually-selectable/movable/deletable placedSquares
// entries as anything placed from the shape tray. There's no generic way
// to derive "which piece is the straight segment" or "which axis is the
// run vs the thickness" from the style JSON alone (nothing in a shape's
// own fields says that), so this is a small per-style hand-authored kit -
// confirmed against the real shape catalog for each style:
//   medievalspruce has exactly one segment size (walls_segment, 6x9) - the
//   larger of its two dimensions (9) is assumed to be the run axis, since
//   there's no sibling of a different size to compare against and confirm.
//   caledonia has a short/medium/long segment family (5/13/19 wide, all
//   7 deep) - the dimension that VARIES across that family unambiguously
//   marks which axis is the run.
// `segments` lists every available run-axis size for the style, longest
// first - tileWallSegments below greedily reaches for the longest piece
// that still fits the remaining span, only falling back to the shortest
// (sliding it back to overlap its neighbor) for whatever's left over once
// nothing longer fits, so a run uses as few pieces as possible instead of
// tiling in the shortest unit throughout.
// Gates are deliberately excluded (user call: a gate's position is a
// design decision, not something to infer from a drawn line), and only
// simple 2-way corners are auto-merged - a 3-way/4-way junction (no tee/
// cross piece exists in either style's kit here, and detecting them
// correctly is a lot more bookkeeping) is left as two overlapping straight
// segments rather than guessing wrong.
const WALL_KITS = {
	"styles/medievalspruce.json": {
		segments: [{ id: "walls_segment", length: 9 }],
		segmentThickness: 6,
		cornerId: "walls_corner",
		cornerSize: 7,
	},
	"styles/caledonia.json": {
		segments: [
			{ id: "walls_long", length: 19 },
			{ id: "walls_medium", length: 13 },
			{ id: "walls_short", length: 5 },
		],
		segmentThickness: 7,
		cornerId: "walls_corners_corner_a",
		cornerSize: 6,
	},
};

// Auto-drawn wall runs, tracked separately from `paths` (these are real
// placedSquares buildings, not painted path cells) purely so a later run
// can detect it shares an endpoint with an earlier one and merge a corner
// piece in - NOT persisted (a fresh session/reload just sees plain
// buildings with no run/corner relationships, which is fine - the pieces
// themselves are already placed correctly, this bookkeeping only matters
// while actively drawing).
let wallRuns = [];

function cellKey(x, y) {
	return `${x},${y}`;
}

// One merged corner per junction cell (cellKey -> its placedSquares entry) -
// tracked separately from wallRuns purely so a corner already placed at a
// junction never gets placed a second time if more runs later touch it.
let wallCorners = new Map();

function wallRunBounds(run) {
	return {
		runMin:
			run.axis === "horizontal"
				? Math.min(run.start.x, run.end.x)
				: Math.min(run.start.y, run.end.y),
		runMax:
			run.axis === "horizontal"
				? Math.max(run.start.x, run.end.x)
				: Math.max(run.start.y, run.end.y),
	};
}

function wallEndpointCell(run, isMax) {
	const { runMin, runMax } = wallRunBounds(run);
	const coord = isMax ? runMax : runMin;
	return run.axis === "horizontal"
		? { x: coord, y: run.perpCoord }
		: { x: run.perpCoord, y: coord };
}

// Tiles kit.segments pieces end-to-end from `from` to `to` (inclusive,
// along `axis`, centered on `perpCoord` across the thickness axis).
// Greedily reaches for the longest piece (kit.segments is sorted longest
// first) that still fits the remaining span, so a run uses as few pieces
// as possible; once what's left is shorter than even the shortest piece,
// that shortest piece slides back to end exactly at `to`, overlapping its
// neighbor rather than leaving a gap - shared by a fresh run and by
// retileWallRun's "an end just got trimmed for a corner" repair below, so
// the actual tiling math only exists in one place.
function tileWallSegments(kit, axis, perpCoord, from, to) {
	const thicknessOrigin = perpCoord - Math.floor(kit.segmentThickness / 2);
	const segments = [];
	if (to < from) return segments;
	const shortest = kit.segments[kit.segments.length - 1];
	let pos = from;
	while (pos <= to) {
		const remaining = to - pos + 1;
		const piece = kit.segments.find((s) => s.length <= remaining) || shortest;
		let segStart = pos;
		if (segStart + piece.length - 1 > to) {
			segStart = to - piece.length + 1;
		}
		const x = axis === "horizontal" ? segStart : thicknessOrigin;
		const y = axis === "horizontal" ? thicknessOrigin : segStart;
		const w = axis === "horizontal" ? piece.length : kit.segmentThickness;
		const h = axis === "horizontal" ? kit.segmentThickness : piece.length;
		placeSquare(x, y, {
			id: piece.id,
			styleFile: styleSelect.value,
			w,
			h,
		});
		segments.push(placedSquares[placedSquares.length - 1]);
		if (segStart + piece.length - 1 >= to) break;
		pos = segStart + piece.length;
	}
	return segments;
}

// The one OTHER run (perpendicular axis) whose endpoint sits at atCell, if
// exactly one exists - see the module comment above for why 3+ way
// junctions (more than one match) are deliberately left alone.
function findPerpendicularRun(run, atCell) {
	const matches = wallRuns.filter((other) => {
		if (other === run || other.axis === run.axis) return false;
		const start = wallEndpointCell(other, false);
		const end = wallEndpointCell(other, true);
		return (
			(start.x === atCell.x && start.y === atCell.y) ||
			(end.x === atCell.x && end.y === atCell.y)
		);
	});
	return matches.length === 1 ? matches[0] : null;
}

// Hand-dragged strokes essentially never land on the exact same cell as an
// earlier stroke's endpoint, even when the user is clearly trying to
// connect to it (drawing a second straight run to form a corner, or
// continuing a run in the same direction) - findPerpendicularRun's
// bit-exact match would silently miss almost every real attempt, leaving
// neither a merged corner nor touching segments, just a gap. This finds
// the closest existing endpoint (any axis) within a generous cell
// tolerance so placeWallRun can snap the drawn point onto it before doing
// anything else.
function findNearbyRunEndpoint(kit, cell) {
	const tolerance = Math.max(kit.segmentThickness, kit.cornerSize) + 2;
	let best = null;
	let bestDist = Infinity;
	for (const run of wallRuns) {
		for (const isMax of [false, true]) {
			const ep = wallEndpointCell(run, isMax);
			const dist = Math.abs(ep.x - cell.x) + Math.abs(ep.y - cell.y);
			if (dist <= tolerance && dist < bestDist) {
				bestDist = dist;
				best = { run, cell: ep };
			}
		}
	}
	return best;
}

// Removes a run's current segments and re-tiles it from scratch, trimmed
// back at whichever end(s) now have a merged corner so segments always
// butt cleanly against the corner's own edge instead of leaving a gap
// where a same-size-deleted segment used to reach further than the
// (usually smaller) corner piece does.
function retileWallRun(kit, run) {
	for (const seg of run.segments) {
		seg.el.remove();
		const idx = placedSquares.indexOf(seg);
		if (idx !== -1) placedSquares.splice(idx, 1);
	}
	const { runMin, runMax } = wallRunBounds(run);
	const half = Math.floor(kit.cornerSize / 2);
	const minCell = wallEndpointCell(run, false);
	const maxCell = wallEndpointCell(run, true);
	const tileMin = findPerpendicularRun(run, minCell)
		? runMin - half + kit.cornerSize
		: runMin;
	const tileMax = findPerpendicularRun(run, maxCell)
		? runMax - half - 1
		: runMax;
	run.segments = tileWallSegments(kit, run.axis, run.perpCoord, tileMin, tileMax);
}

function ensureWallCorner(kit, atCell) {
	const key = cellKey(atCell.x, atCell.y);
	if (wallCorners.has(key)) return;
	const half = Math.floor(kit.cornerSize / 2);
	placeSquare(atCell.x - half, atCell.y - half, {
		id: kit.cornerId,
		styleFile: styleSelect.value,
		w: kit.cornerSize,
		h: kit.cornerSize,
	});
	wallCorners.set(key, placedSquares[placedSquares.length - 1]);
}

// Re-checks both of a run's endpoints for a perpendicular match and merges
// a corner in wherever one's found - shared by a fresh run and by
// extendWallRun below, since growing an existing run can newly bring one
// of its endpoints into range of a corner too.
function mergeCornersAtEndpoints(kit, run) {
	const minCell = wallEndpointCell(run, false);
	const maxCell = wallEndpointCell(run, true);
	const minMatch = findPerpendicularRun(run, minCell);
	const maxMatch = findPerpendicularRun(run, maxCell);
	if (minMatch) {
		retileWallRun(kit, minMatch);
		ensureWallCorner(kit, minCell);
	}
	if (maxMatch) {
		retileWallRun(kit, maxMatch);
		ensureWallCorner(kit, maxCell);
	}
}

// A same-axis nearby match means the new stroke is continuing an existing
// straight run, not connecting to it at an angle - grows that run to cover
// the new far point (rather than creating a second, separately-tiled run
// sitting right next to the first) and retiles the whole thing as one
// continuous span, so there's no seam at all where the two strokes met.
function extendWallRun(kit, run, farCell) {
	const cells = [run.start, run.end, farCell];
	if (run.axis === "horizontal") {
		const xs = cells.map((c) => c.x);
		run.start = { x: Math.min(...xs), y: run.perpCoord };
		run.end = { x: Math.max(...xs), y: run.perpCoord };
	} else {
		const ys = cells.map((c) => c.y);
		run.start = { x: run.perpCoord, y: Math.min(...ys) };
		run.end = { x: run.perpCoord, y: Math.max(...ys) };
	}
	retileWallRun(kit, run);
	mergeCornersAtEndpoints(kit, run);
}

// Places one straight wall run between two axis-aligned cells. Each drawn
// endpoint first snaps onto any existing run's endpoint within a forgiving
// tolerance (see findNearbyRunEndpoint) - a same-axis snap extends that
// run in place (see extendWallRun) rather than creating an adjacent one;
// a perpendicular snap proceeds as a new run whose matching end(s) get
// retiled and merged into a shared corner piece.
function placeWallRun(axis, startCell, endCell) {
	const kit = WALL_KITS[styleSelect.value];
	if (!kit) return;

	const startSnap = findNearbyRunEndpoint(kit, startCell);
	if (startSnap) startCell = startSnap.cell;
	const endSnap = findNearbyRunEndpoint(kit, endCell);
	if (endSnap) endCell = endSnap.cell;

	if (startSnap && startSnap.run.axis === axis) {
		extendWallRun(kit, startSnap.run, endCell);
		return;
	}
	if (endSnap && endSnap.run.axis === axis) {
		extendWallRun(kit, endSnap.run, startCell);
		return;
	}

	const perpCoord = axis === "horizontal" ? startCell.y : startCell.x;
	const run = { axis, start: startCell, end: endCell, perpCoord, segments: [] };
	wallRuns.push(run);
	retileWallRun(kit, run);
	mergeCornersAtEndpoints(kit, run);
}

function roadTypeLabel(type) {
	return type === "default" ? "Path" : formatSubcategoryLabel(type);
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

	// A search query bypasses the category/subcategory tabs entirely (the
	// whole point is skipping the digging) - including the "Roads & Rivers"
	// tab's path controls, which have no shapes of their own to search, so
	// searching while that tab's active still needs to fall through to the
	// normal shape grid below instead of returning early into pathControls.
	if (activeTab === "roads" && !shapeSearchQuery) {
		renderPathTypeOptions();
		pathWidthInput.value = pathWidth;
		setPathEraseMode(pathEraseMode);
		shapeTray.appendChild(pathControls);
		return;
	}

	const maxPreviewHeight = 110;
	const visibleShapes = shapes.filter((shape) => {
		if (shapeSearchQuery) {
			return (shape.label || "").toLowerCase().includes(shapeSearchQuery);
		}
		const category = shape.category || "farming";
		if (category !== activeTab) return false;
		if (activeSubcategory === "all") return true;
		return getSubcategory(shape) === activeSubcategory;
	});
	visibleShapes.forEach((shape) => {
		const category = shape.category || "farming";
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
					<img class="shape-preview__image" alt="" hidden />
					<div class="preview-badge" style="font-size:${badgeSize}px;">${shape.label}</div>
				</div>
			</div>
		`;
		button.style.width = `${scaledWidth + 12}px`;
		button.addEventListener("click", () => selectShape(shape.id));
		shapeTray.appendChild(button);
		loadShapeTrayThumbnail(
			button.querySelector(".shape-preview__image"),
			button.querySelector(".preview-badge"),
			shape,
		);
	});
	updateShapeSelectionUI();
}

function selectShape(shapeId) {
	// Normally unreachable while the road tool's armed (the tray shows
	// pathControls instead of shape buttons then) - EXCEPT a search query
	// now renders real shape results even on the "Roads & Rivers" tab (see
	// renderShapeTray), so clicking one here first has to back out of the
	// road tool and into that shape's own tab before selecting it.
	if (pathToolActive) {
		const shape = shapes.find((s) => s.id === shapeId);
		setActiveTab((shape && shape.category) || "farming");
	}
	selectedShapeId = selectedShapeId === shapeId ? null : shapeId;
	pendingRotated = false;
	selectedCostLevel = 1;
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
	updateCostPanel();
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
	// A placed building carries its own styleFile (see getPreviewedShape) —
	// its preview photo must come from *that* style's folder, not whichever
	// style the tray/dropdown currently happens to show.
	const styleId = shape.styleFile
		? getStyleIdForFile(shape.styleFile)
		: activeStyleId;
	return uniqueNames.map((name) => `images/${styleId}/${name}_front.jpg`);
}

// Shows the same front-view photo the Building Preview sidebar uses
// (getPreviewImageCandidates), scaled down as a thumbnail inside a shape
// tray card, instead of just the flat category-color block. Tries each
// candidate filename in turn on error, same fallback chain as the sidebar -
// unlike the sidebar's single shared <img> (which needs a request-id guard
// against a stale load landing after the user moved on), each tray card
// gets its OWN <img>/badge pair captured by this call's own closure, so a
// later renderShapeTray() call simply orphans the old elements rather than
// racing with them. Leaves the existing flat-color-plus-badge look
// untouched when no photo exists for a shape (most of the catalog, still) -
// this only hides the badge and reveals the image once a candidate
// actually loads.
function loadShapeTrayThumbnail(img, badge, shape) {
	const candidates = getPreviewImageCandidates(shape);
	let index = 0;
	const tryNext = () => {
		if (index >= candidates.length) return;
		img.src = candidates[index];
		index += 1;
	};
	img.onload = () => {
		img.hidden = false;
		badge.hidden = true;
	};
	img.onerror = tryNext;
	tryNext();
}

// ----- Rooftop (top-down) preview -----
// scripts/generate_rooftop_renders.js produces one JSON file per building it
// covers, keyed in manifest.json by "<styleFile>::<shapeId>" - only a
// fraction of the catalog has data (whatever's been generated so far), so
// every lookup here is "does this exist" before showing anything, not an
// assumption that it does.
let rooftopManifest = {};
fetch("rooftop-data/manifest.json")
	.then((response) => (response.ok ? response.json() : {}))
	.then((manifest) => {
		rooftopManifest = manifest;
	})
	.catch(() => {
		// Missing entirely is fine (e.g. the generator hasn't been run yet in
		// this checkout) - the toggle just never appears, same as any shape
		// with no rooftop data.
	});

const rooftopDataCache = new Map(); // dataPath -> Promise<gridData>
// A blueprint only ever needs rendering ONCE, unrotated, at its native
// orientation - every placed instance of the same building (and both its
// rotated/unrotated states) reuses this single offscreen render as a plain
// image, rotated in canvas-space at blit time (see applyBuildingVisualMode)
// instead of re-running the whole tile-by-tile async draw loop per
// instance. Keyed on showDoorLabels too since that changes the pixels.
const rooftopImageCache = new Map(); // `${dataPath}|${showDoorLabels}` -> Promise<HTMLCanvasElement>
function getRenderedRooftopImage(gridData, dataPath) {
	const key = `${dataPath}|${showDoorLabels}`;
	if (!rooftopImageCache.has(key)) {
		const offscreen = document.createElement("canvas");
		rooftopImageCache.set(
			key,
			window.RooftopRender.renderGrid(gridData, offscreen, {
				cellSize,
				showDoors: showDoorLabels,
				showCompass: false,
			}).then(() => offscreen),
		);
	}
	return rooftopImageCache.get(key);
}
let previewViewMode = "front"; // "front" | "top"
const DOOR_TOGGLE_STORAGE_KEY = "minecolonies.rooftopDoors.v1";
let showDoorLabels = true;
try {
	const savedDoors = window.localStorage.getItem(DOOR_TOGGLE_STORAGE_KEY);
	if (savedDoors !== null) showDoorLabels = savedDoors === "1";
} catch {
	// localStorage may be unavailable in some contexts.
}
doorToggleCheckbox.checked = showDoorLabels;
doorToggleCheckbox.addEventListener("change", () => {
	showDoorLabels = doorToggleCheckbox.checked;
	try {
		window.localStorage.setItem(DOOR_TOGGLE_STORAGE_KEY, showDoorLabels ? "1" : "0");
	} catch {
		// localStorage may be unavailable in some contexts.
	}
	if (previewViewMode === "top") showPreviewView("top");
	applyTopDownRenderMode();
});

function getRooftopDataPath(shape) {
	if (!shape) return null;
	const styleFilePath = shape.styleFile || styleSelect.value;
	return rooftopManifest[`${styleFilePath}::${shape.id}`] || null;
}

async function showPreviewView(mode) {
	previewViewMode = mode;
	previewViewToggle.querySelectorAll("[data-preview-view]").forEach((btn) => {
		btn.classList.toggle("is-active", btn.dataset.previewView === mode);
	});
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
	previewImage.style.display = "none";
	previewTopDownLabel.hidden = true;
	if (!rooftopDataCache.has(dataPath)) {
		rooftopDataCache.set(dataPath, fetch(dataPath).then((response) => response.json()));
	}
	try {
		const gridData = await rooftopDataCache.get(dataPath);
		if (requestId !== previewRequestId || previewViewMode !== "top") return; // preview moved on while this was loading
		await window.RooftopRender.renderGrid(gridData, previewCanvas, { showDoors: showDoorLabels });
		if (requestId !== previewRequestId || previewViewMode !== "top") return;
		previewCanvas.hidden = false;
		previewEmpty.style.display = "none";
		previewTopDownLabel.textContent = shape.label || "";
		previewTopDownLabel.className = `preview-card__topdown-label category-${shape.category || "farming"}`;
		previewTopDownLabel.hidden = false;
	} catch {
		// A broken/missing rooftop-data fetch shouldn't take down the rest of
		// the preview panel - leave whatever was showing before.
	}
}

previewViewToggle.addEventListener("click", (event) => {
	const button = event.target.closest("[data-preview-view]");
	if (!button) return;
	showPreviewView(button.dataset.previewView);
});

// ----- Top-down rendering on the main grid -----
// Same rooftopManifest/rooftopDataCache/RooftopRender used by the Building
// Preview panel above, applied to buildings already placed on the board.
const ROOFTOP_TOGGLE_STORAGE_KEY = "minecolonies.rooftopRenders.v1";
let useTopDownRenders = false;

// .has-topdown marks a placed building as currently showing its rooftop
// render (vs the flat category-color fallback) - CSS uses it to shrink the
// badge down to a small name tag instead of the full-square flat label, and
// to let the hold-Ctrl "clean view" toggle (see the Control key listener
// below) hide that tag plus the category border/fill in one place, rather
// than each render call having to know about the Ctrl state itself.
// Flat mode's badge font-size is set inline (computed per-shape by
// getBadgeFontSize so long labels still fit the square) - the small
// top-down name tag uses a fixed size from CSS instead, so switching modes
// means explicitly handing control back and forth rather than letting one
// declaration silently lose to the other's higher inline-style specificity.
function setBuildingTopDownMode(entry, on) {
	entry.el.classList.toggle("has-topdown", on);
	const badge = entry.el.querySelector(".placed-badge");
	if (!badge) return;
	badge.style.fontSize = on ? "" : `${getBadgeFontSize(entry.w, entry.h)}px`;
}

async function applyBuildingVisualMode(entry) {
	if (!entry.rooftopCanvas) return;
	if (!useTopDownRenders) {
		entry.rooftopCanvas.hidden = true;
		setBuildingTopDownMode(entry, false);
		return;
	}
	const dataPath = getRooftopDataPath({ styleFile: entry.styleFile, id: entry.id });
	if (!dataPath) {
		entry.rooftopCanvas.hidden = true;
		setBuildingTopDownMode(entry, false);
		return;
	}
	if (!rooftopDataCache.has(dataPath)) {
		rooftopDataCache.set(dataPath, fetch(dataPath).then((response) => response.json()));
	}
	try {
		const gridData = await rooftopDataCache.get(dataPath);
		// The building may have been un-toggled, rotated, or removed while
		// this fetch was in flight - re-check before touching the DOM.
		if (!useTopDownRenders || !placedSquares.includes(entry)) return;
		// entry.rotated (set at placement time and toggled by rotateSelected,
		// see placeSquare) says WHICH way this instance is turned relative to
		// the blueprint's own native orientation - trusted over comparing
		// entry.w/h directly against gridData.size_x/size_z, since a square
		// footprint can't be told rotated from not just by comparing
		// dimensions (both come out equal either way). Still cross-checked
		// against the expected dimensions for that rotation as a sanity guard
		// (catches corrupt/pre-rotation-field saved data) before rendering.
		const expectedW = entry.rotated ? gridData.size_z : gridData.size_x;
		const expectedH = entry.rotated ? gridData.size_x : gridData.size_z;
		if (entry.w !== expectedW || entry.h !== expectedH) {
			entry.rooftopCanvas.hidden = true;
			setBuildingTopDownMode(entry, false);
			return;
		}
		const sourceCanvas = await getRenderedRooftopImage(gridData, dataPath);
		if (!useTopDownRenders || !placedSquares.includes(entry)) return;
		entry.rooftopCanvas.width = entry.w * cellSize;
		entry.rooftopCanvas.height = entry.h * cellSize;
		const ctx = entry.rooftopCanvas.getContext("2d");
		ctx.imageSmoothingEnabled = false;
		if (entry.rotated) {
			// Rotate the single shared unrotated render 90° clockwise around
			// its own center at blit time, rather than needing a second,
			// differently-oriented render of the same blueprint - its
			// rotated bounding box (size_z x size_x) then exactly fills this
			// canvas (sized to entry.w/h above), no separate CSS transform
			// needed.
			ctx.save();
			ctx.translate(entry.rooftopCanvas.width / 2, entry.rooftopCanvas.height / 2);
			ctx.rotate(Math.PI / 2);
			ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
			ctx.restore();
		} else {
			ctx.drawImage(sourceCanvas, 0, 0);
		}
		entry.rooftopCanvas.hidden = false;
		setBuildingTopDownMode(entry, true);
	} catch {
		// Leave the flat-color fallback showing on a failed fetch/render.
	}
}

function applyTopDownRenderMode() {
	placedSquares.forEach((entry) => applyBuildingVisualMode(entry));
}

rooftopToggleCheckbox.addEventListener("change", () => {
	useTopDownRenders = rooftopToggleCheckbox.checked;
	try {
		window.localStorage.setItem(
			ROOFTOP_TOGGLE_STORAGE_KEY,
			useTopDownRenders ? "1" : "0",
		);
	} catch {
		// localStorage may be unavailable in some contexts.
	}
	applyTopDownRenderMode();
});

try {
	useTopDownRenders =
		window.localStorage.getItem(ROOFTOP_TOGGLE_STORAGE_KEY) === "1";
} catch {
	useTopDownRenders = false;
}
rooftopToggleCheckbox.checked = useTopDownRenders;

// Left Ctrl toggles the name tag + colored border/fill overlay on every
// top-down-rendered building, for a clean unobstructed look at the renders
// themselves - a sticky toggle (not a hold) so it stays out of the way
// without needing a finger kept on the key, and it's mirrored by the
// "Show name tags & borders" checkbox below so it's reachable without a
// keyboard too. event.repeat guards against the key's own OS auto-repeat
// re-firing keydown (and re-toggling back and forth) while actually held.
const NAMES_TOGGLE_STORAGE_KEY = "minecolonies.showNames.v1";
let showBuildingOverlay = true;
try {
	const savedNames = window.localStorage.getItem(NAMES_TOGGLE_STORAGE_KEY);
	if (savedNames !== null) showBuildingOverlay = savedNames === "1";
} catch {
	// localStorage may be unavailable in some contexts.
}
function setShowBuildingOverlay(on) {
	showBuildingOverlay = on;
	document.body.classList.toggle("hide-topdown-overlay", !on);
	namesToggleCheckbox.checked = on;
	try {
		window.localStorage.setItem(NAMES_TOGGLE_STORAGE_KEY, on ? "1" : "0");
	} catch {
		// localStorage may be unavailable in some contexts.
	}
}
setShowBuildingOverlay(showBuildingOverlay);
window.addEventListener("keydown", (event) => {
	if (event.code !== "ControlLeft" || event.repeat) return;
	setShowBuildingOverlay(!showBuildingOverlay);
});
namesToggleCheckbox.addEventListener("change", () => {
	setShowBuildingOverlay(namesToggleCheckbox.checked);
});

// Show/hide the planner grid's per-cell line pattern - purely cosmetic
// (placement/collision logic never reads this), so it's just a class swap
// over the existing background-image rule.
const GRID_LINES_TOGGLE_STORAGE_KEY = "minecolonies.showGridLines.v1";
let showGridLines = true;
try {
	const savedGridLines = window.localStorage.getItem(GRID_LINES_TOGGLE_STORAGE_KEY);
	if (savedGridLines !== null) showGridLines = savedGridLines === "1";
} catch {
	// localStorage may be unavailable in some contexts.
}
function setShowGridLines(on) {
	showGridLines = on;
	grid.classList.toggle("hide-grid-lines", !on);
	gridLinesToggleCheckbox.checked = on;
	try {
		window.localStorage.setItem(GRID_LINES_TOGGLE_STORAGE_KEY, on ? "1" : "0");
	} catch {
		// localStorage may be unavailable in some contexts.
	}
}
setShowGridLines(showGridLines);
gridLinesToggleCheckbox.addEventListener("change", () => {
	setShowGridLines(gridLinesToggleCheckbox.checked);
});

function updatePreviewSidebar() {
	const shape = getPreviewedShape();
	previewRequestId += 1;
	const requestId = previewRequestId;
	previewCanvas.hidden = true;
	previewTopDownLabel.hidden = true;
	previewViewMode = "front";

	if (!shape) {
		previewName.textContent = "Select a building";
		previewImage.removeAttribute("src");
		previewImage.style.display = "none";
		previewViewToggle.hidden = true;
		previewEmpty.textContent =
			"Select a building from the tray to see its front view.";
		previewEmpty.style.display = "flex";
		return;
	}

	previewName.textContent = shape.label || "Selected Building";
	previewImage.style.display = "none";
	previewEmpty.style.display = "flex";
	previewEmpty.textContent = "Loading preview...";

	const hasRooftopData = Boolean(getRooftopDataPath(shape));
	previewViewToggle.hidden = !hasRooftopData;
	if (hasRooftopData) {
		previewViewToggle.querySelectorAll("[data-preview-view]").forEach((btn) => {
			btn.classList.toggle("is-active", btn.dataset.previewView === "front");
		});
	}

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

// What the right-pane preview/cost panel should show: a selected placed
// building takes priority over the tray selection, so clicking something
// already on the grid surfaces its preview/costs without needing to also
// reselect it in the tray. Deliberately separate from getSelectedShape(),
// which is also used to decide what the next grid click *places* — that
// must stay tray-only, or selecting a placed building would make the next
// grid click try to place another copy of it.
function getPreviewedShape() {
	if (selectedPrimary) {
		const entry = placedSquares.find((p) => p.el === selectedPrimary);
		if (entry) {
			// Resolve against the STYLE THIS BUILDING WAS PLACED FROM, not
			// whatever the dropdown currently shows — otherwise a Caledonia
			// building selected while the tray is showing Medieval Spruce
			// would look up the wrong style's shape list (wrong dimensions,
			// wrong/missing levels data) or fail to resolve at all.
			const styleFile = entry.styleFile || styleSelect.value;
			const found = getStyleShapes(styleFile).find((s) => s.id === entry.id);
			if (found) return { ...found, styleFile };
			return {
				id: entry.id,
				label: entry.label,
				w: entry.w,
				h: entry.h,
				category: entry.category,
				emoji: entry.emoji,
				styleFile,
			};
		}
	}
	return getSelectedShape();
}

// A block's texture alone can't convey it's a thin/partial shape rather than
// a full cube (a fence and its own planks are textured identically). These
// suffixes get a CSS shape mask (see .material-shape--* in styles.css) that
// crops the real texture into a recognizable silhouette instead.
const SHAPE_SUFFIXES = [
	["_fence_gate", "fence"],
	["_fence", "fence"],
	["_wall", "wall"],
	["_stairs", "stairs"],
	["_slab", "slab"],
	["_pressure_plate", "plate"],
	["_button", "button"],
];

// Domum Ornamentum "shape" materials are keyed as "<baseId>@@<ingredient
// list>" (see regenerate_costs_ingredients.js) so the cost list can show
// what each one is actually made of - strip that back off wherever the
// underlying base block id is what's actually needed (icon lookup, shape
// silhouette).
function getMaterialBaseId(materialId) {
	const at = materialId.indexOf("@@");
	return at === -1 ? materialId : materialId.slice(0, at);
}

function getMaterialShapeClass(materialId) {
	const baseId = getMaterialBaseId(materialId);
	const name = baseId.includes(":")
		? baseId.slice(baseId.indexOf(":") + 1)
		: baseId;
	for (const [suffix, shape] of SHAPE_SUFFIXES) {
		if (name.endsWith(suffix)) return `material-shape--${shape}`;
	}
	return "";
}

// Two separate problems, both mostly in domum_ornamentum: (1) some block IDs
// have no underscores at all ("blockpaperwall", "squarepillar"), so the
// automatic split below can't break them into words and just title-cases the
// whole thing as one garbled word; (2) domum_ornamentum's "timber frame"
// family (plain/framed/side_framed/one_crossed_lr/etc.) DOES split cleanly,
// but the result ("Plain", "Framed") is a bare adjective with no noun,
// meaningless out of context - these are all pattern-variant names for the
// same underlying "timber frame" block family, confirmed against the mod's
// own assets/domum_ornamentum/lang/en_us.json (the game's actual in-block
// name is built from a "Framed %s"/type-substitution format string, and
// every one of these IDs corresponds to a `timber.frame.type.*` entry
// there), so appending "Timber Frame" is what the game itself is doing,
// just without the runtime %s-material substitution we don't have data for.
// Everything else here (Architect's Cutter, Laying/Standing Barrel, the
// pillar/paperwall formats) is also taken directly from that lang file
// rather than guessed.
const MATERIAL_NAME_OVERRIDES = {
	"domum_ornamentum:architectscutter": "Architect's Cutter",
	"domum_ornamentum:blockpaperwall": "Framed Pane",
	"domum_ornamentum:blockpillar": "Round Pillar",
	"domum_ornamentum:blockypillar": "Voxel Pillar",
	"domum_ornamentum:squarepillar": "Square Pillar",
	"domum_ornamentum:blockbarreldeco_onside": "Laying Barrel",
	"domum_ornamentum:blockbarreldeco_standing": "Standing Barrel",
	"domum_ornamentum:plain": "Plain Timber Frame",
	"domum_ornamentum:framed": "Framed Timber Frame",
	"domum_ornamentum:side_framed": "Side Timber Frame",
	"domum_ornamentum:side_framed_horizontal": "Side Horizontal Timber Frame",
	"domum_ornamentum:horizontal_plain": "Plain Horizontal Timber Frame",
	"domum_ornamentum:one_crossed_lr": "Left-Right Crossed Timber Frame",
	"domum_ornamentum:one_crossed_rl": "Right-Left Crossed Timber Frame",
	"domum_ornamentum:double_crossed": "Double Crossed Timber Frame",
	"domum_ornamentum:up_gated": "Up Gate Timber Frame",
	"domum_ornamentum:down_gated": "Down Gate Timber Frame",
	"domum_ornamentum:shingle": "Shingles",
	"domum_ornamentum:shingle_flat": "Flat Shingles",
	"domum_ornamentum:shingle_flat_lower": "Flat Lower Shingles",
	"domum_ornamentum:shingle_slab": "Shingle Slab",
	"minecolonies:blockminecoloniesnamedgrave": "Named Grave",
	"minecolonies:blockminecoloniesrack": "Rack",
	"minecolonies:blockstash": "Stash",
	"minecolonies:blockwaypoint": "Waypoint",
	"minecolonies:decorationcontroller": "Decoration Controller",
};

function formatMaterialName(materialId) {
	// "<baseId>@@<ingredient1,ingredient2>" - list what it's actually made of
	// (a domum_ornamentum shape's real materials, stored per-instance in the
	// blueprint's tile-entity data, not the block name — see
	// regenerate_costs_ingredients.js) ahead of the shape name itself, e.g.
	// "Cobblestone and Spruce Planks Plain Timber Frame" rather than just
	// "Plain Timber Frame", which could be any of a dozen different material
	// combinations across different buildings.
	const at = materialId.indexOf("@@");
	if (at !== -1) {
		const baseId = materialId.slice(0, at);
		const ingredients = materialId
			.slice(at + 2)
			.split(",")
			.filter(Boolean)
			.map(formatMaterialName);
		const ingredientList =
			ingredients.length <= 2
				? ingredients.join(" and ")
				: `${ingredients.slice(0, -1).join(", ")}, and ${ingredients[ingredients.length - 1]}`;
		return `${ingredientList} ${formatMaterialName(baseId)}`;
	}
	if (MATERIAL_NAME_OVERRIDES[materialId])
		return MATERIAL_NAME_OVERRIDES[materialId];
	const withoutNamespace = materialId.includes(":")
		? materialId.slice(materialId.indexOf(":") + 1)
		: materialId;
	return withoutNamespace
		.split("_")
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}

function renderMaterialsList(materials) {
	const entries = Object.entries(materials || {}).sort((a, b) => b[1] - a[1]);
	if (!entries.length) {
		return `<div class="cost-card__empty">Nothing needed.</div>`;
	}
	return `
		<ul class="cost-card__materials">
			${entries
				.map(([id, count]) => {
					const iconPath = materialIcons[getMaterialBaseId(id)];
					const shapeClass = getMaterialShapeClass(id);
					const icon = iconPath
						? `<img class="cost-card__material-icon ${shapeClass}" src="${iconPath}" alt="" loading="lazy" />`
						: `<span class="cost-card__material-icon cost-card__material-icon--placeholder" aria-hidden="true"></span>`;
					return `
				<li class="cost-card__material">
					<span class="cost-card__material-label">
						${icon}
						<span class="cost-card__material-name">${formatMaterialName(id)}</span>
					</span>
					<span class="cost-card__material-count">${count.toLocaleString()}</span>
				</li>
			`;
				})
				.join("")}
		</ul>
	`;
}

function updateCostPanel() {
	const shape = getPreviewedShape();
	const levels = shape?.levels;

	if (!shape || !Array.isArray(levels) || !levels.length) {
		costCard.hidden = true;
		costLevelsEl.innerHTML = "";
		costBodyEl.innerHTML = "";
		return;
	}

	costCard.hidden = false;
	const maxLevel = levels.length;
	if (selectedCostLevel > maxLevel) selectedCostLevel = maxLevel;
	if (selectedCostLevel < 1) selectedCostLevel = 1;

	costLevelsEl.innerHTML = "";
	levels.forEach((levelData) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "cost-card__level-button";
		button.textContent = `Lvl ${levelData.level}`;
		button.classList.toggle("is-active", levelData.level === selectedCostLevel);
		button.addEventListener("click", () => {
			selectedCostLevel = levelData.level;
			updateCostPanel();
		});
		costLevelsEl.appendChild(button);
	});

	const currentLevelData = levels.find((l) => l.level === selectedCostLevel);
	const nextLevelData = levels.find((l) => l.level === selectedCostLevel + 1);

	costBodyEl.innerHTML = `
		<div class="cost-card__section">
			<h4 class="cost-card__section-title">Total to reach Level ${selectedCostLevel}</h4>
			${renderMaterialsList(currentLevelData?.materials)}
		</div>
		<div class="cost-card__section">
			<h4 class="cost-card__section-title">
				${nextLevelData ? `Upgrade cost to Level ${nextLevelData.level}` : "Max level reached"}
			</h4>
			${nextLevelData ? renderMaterialsList(nextLevelData.upgradeCost) : ""}
		</div>
	`;
}

function resolveShapeData(shape) {
	if (!shape) return null;
	// A newly-placed building (from the tray) has no styleFile of its own
	// yet — it's whatever style is currently active. A restored/duplicated
	// building already carries its own, which must win so it keeps resolving
	// against the style it was actually placed from, not whatever the
	// dropdown happens to show right now.
	const styleFile = shape.styleFile || styleSelect.value;
	const styleShapes = getStyleShapes(styleFile);
	const base = shape.id
		? styleShapes.find((item) => item.id === shape.id)
		: null;
	return {
		id: shape.id || base?.id,
		label: shape.label || base?.label || "Unknown",
		w: shape.w ?? base?.w ?? 1,
		h: shape.h ?? base?.h ?? 1,
		category: shape.category || base?.category || "farming",
		emoji: shape.emoji || base?.emoji,
		styleFile,
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
	badge.textContent = resolved.label;
	badge.style.fontSize = `${getBadgeFontSize(resolved.w, resolved.h)}px`;
	placed.appendChild(badge);
	const rooftopCanvas = document.createElement("canvas");
	rooftopCanvas.className = "placed-square__rooftop-canvas";
	rooftopCanvas.hidden = true;
	placed.appendChild(rooftopCanvas);
	placed.addEventListener("pointerdown", startDrag);
	placed.addEventListener("click", (event) => {
		// Left-click here must yield to the road/river/canal brush - it's the
		// tool's own paint/erase button while armed (see the grid's own
		// pointerdown listener), so a left-click landing on a building
		// shouldn't also select it on top of whatever drawing just happened
		// underneath it. "walls" mode is the one exception: it only ever
		// draws on a real DRAG (a plain click starting on an existing wall
		// piece doesn't paint anything - see the grid's wall-draw pointerdown
		// branch), so there's nothing for a plain click to conflict with,
		// and leaving it disabled would make a just-placed wall segment
		// permanently unselectable without switching tabs first.
		if (
			suppressClick ||
			isDragging ||
			(pathToolActive && pathType !== "walls")
		)
			return;
		event.stopPropagation();
		selectPlaced(placed, event.shiftKey);
	});
	placed.addEventListener("contextmenu", (event) => {
		event.preventDefault();
		// Right-click always opens the action menu normally, road tool armed
		// or not - panning (which right-click doubles as while the tool is
		// armed, see the grid's own pointerdown listener) can only ever start
		// from empty grid space anyway, never from on top of a building, so
		// there's nothing for this to conflict with.
		if (suppressClick || isDragging) return;
		event.stopPropagation();
		if (!selectedPlaced.has(placed)) {
			selectPlaced(placed, event.shiftKey);
		} else if (!selectedPrimary) {
			selectedPrimary = placed;
		}
		showMenuFor(selectedPrimary || placed);
	});
	grid.appendChild(placed);
	const entry = {
		el: placed,
		x,
		y,
		w: resolved.w,
		h: resolved.h,
		id: resolved.id,
		label: resolved.label,
		category,
		emoji: resolved.emoji,
		styleFile: resolved.styleFile,
		// Whether this placement is a quarter-turn from the blueprint's native
		// orientation (w/h already reflect that - this is purely metadata for
		// applyBuildingVisualMode to know WHICH way to rotate the one shared
		// top-down render, since a square footprint can't tell rotated from
		// not just by comparing w/h). Defaults false for anything that didn't
		// explicitly pass it through (fresh placements from an unrotated
		// tray selection, wall segments, older saved plans from before this
		// field existed, etc).
		rotated: !!shape.rotated,
		rooftopCanvas,
	};
	placedSquares.push(entry);
	applyBuildingVisualMode(entry);
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
	const onScreenCellSize = cellSize * gridZoom;
	const x = Math.floor((clientX - rect.left) / onScreenCellSize);
	const y = Math.floor((clientY - rect.top) / onScreenCellSize);
	if (x < 0 || y < 0 || x + w > cols || y + h > rows) return null;
	return snapToGrid(x, y, w, h, step);
}

function getCenteredSnapPoint(clientX, clientY, w, h, step) {
	const rect = grid.getBoundingClientRect();
	const onScreenCellSize = cellSize * gridZoom;
	const centeredX = (clientX - rect.left) / onScreenCellSize - w / 2;
	const centeredY = (clientY - rect.top) / onScreenCellSize - h / 2;
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
	if (event.button !== 0) return;
	// Attached directly to each .placed-square, so it fires before the
	// grid's own pointerdown listener (which is where painting/erasing
	// actually happens) even gets a chance to run - without this check, a
	// left-click that starts on top of a building while the Roads & Rivers
	// tool (paint OR erase OR walls) is armed would hijack into picking up
	// and dragging that building instead of drawing under it, since
	// left-click is that tool's own paint/erase button while it's active.
	if (pathToolActive) return;
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
	if (selectedPrimary && isMenuOpen()) showMenuFor(selectedPrimary);
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
	updateShapeSelectionUI();
}

function selectPlaced(element, additive = false) {
	if (!additive) {
		clearSelection();
		selectedPlaced.add(element);
		selectedPrimary = element;
		element.classList.add("is-selected");
		hideMenu(true);
		selectedCostLevel = 1;
		// Selecting a placed building takes over the right-pane preview —
		// drop any armed tray selection so the tray doesn't keep showing an
		// unrelated item as "selected", and so the next grid click doesn't
		// unexpectedly place a copy of it instead of just inspecting.
		selectedShapeId = null;
		pendingRotated = false;
		updateShapeSelectionUI();
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
		selectedCostLevel = 1;
		selectedShapeId = null;
		pendingRotated = false;
	}
	if (selectedPrimary && isMenuOpen()) {
		showMenuFor(selectedPrimary);
	} else if (!selectedPrimary) {
		hideMenu(true);
	}
	updateShapeSelectionUI();
}

// Continuous (non-floored) grid-cell-space coordinates for a client point,
// clamped to the grid's own bounds - unlike getCellFromPoint (which floors
// to a whole cell and returns null outside the grid), the marquee rectangle
// needs fractional positions so it tracks the cursor exactly, and needs to
// keep extending even if the drag momentarily leaves the grid area.
function getGridPointFromClient(clientX, clientY) {
	const rect = grid.getBoundingClientRect();
	const onScreenCellSize = cellSize * gridZoom;
	const x = (clientX - rect.left) / onScreenCellSize;
	const y = (clientY - rect.top) / onScreenCellSize;
	return {
		x: Math.max(0, Math.min(cols, x)),
		y: Math.max(0, Math.min(rows, y)),
	};
}

// Applies the live marquee rectangle to the selection: every building whose
// footprint overlaps the box gets added, on top of whatever was already
// selected before this drag started (pendingMarquee.preservedSelection) -
// same "drag adds to the existing selection" semantics as Shift+click on a
// single building, just for a whole box of them at once. Buildings the box
// no longer covers (and weren't part of the preserved selection) drop back
// out as the box moves, matching standard rubber-band-select behavior.
function updateMarqueeSelection(rect) {
	const next = new Set(pendingMarquee.preservedSelection);
	for (const entry of placedSquares) {
		if (
			rectanglesOverlap(rect.x, rect.y, rect.w, rect.h, entry.x, entry.y, entry.w, entry.h)
		) {
			next.add(entry.el);
		}
	}
	selectedPlaced.forEach((el) => {
		if (!next.has(el)) el.classList.remove("is-selected");
	});
	next.forEach((el) => {
		if (!selectedPlaced.has(el)) el.classList.add("is-selected");
	});
	selectedPlaced.clear();
	next.forEach((el) => selectedPlaced.add(el));
	selectedPrimary = selectedPlaced.size ? selectedPlaced.values().next().value : null;
}

function isMenuOpen() {
	return actionMenu.style.display === "flex";
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
	item.rotated = !item.rotated;
	item.el.style.width = `${cellSize * item.w}px`;
	item.el.style.height = `${cellSize * item.h}px`;
	item.el.style.left = `${item.x * cellSize}px`;
	item.el.style.top = `${item.y * cellSize}px`;
	applyBuildingVisualMode(item);
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
		if (
			nextX < 0 ||
			nextY < 0 ||
			nextX + item.w > cols ||
			nextY + item.h > rows
		)
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
	if (selectedPrimary && isMenuOpen()) showMenuFor(selectedPrimary);
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
	if (!styleCache.has(file)) {
		// Shouldn't normally happen — loadAllStyles() populates every known
		// style at startup — but fetch on demand rather than fail outright.
		try {
			const data = await loadStyle(file);
			styleCache.set(file, {
				id: activeStyleId,
				shapes: Array.isArray(data.shapes) ? data.shapes : [],
			});
		} catch (error) {
			console.error(error);
			styleCache.set(file, { id: activeStyleId, shapes: [] });
		}
	}
	shapes = getStyleShapes(file);
	const availableTabs = new Set(
		shapes.map((shape) => shape.category || "farming"),
	);
	// "roads" is the paintbrush tool's own fixed tab (see the `tabs` array
	// above), never a real shape category - no style's `shapes` ever
	// contains one, so availableTabs.has("roads") is always false and this
	// would otherwise always bounce back to another tab the instant you
	// switched styles while the Roads & Rivers tab was active.
	if (activeTab !== "roads" && !availableTabs.has(activeTab)) {
		activeTab = availableTabs.values().next().value || "farming";
	}
	renderTabs();
	renderSubTabs();
	renderShapeTray();
	renderPathTypeOptions();
	selectedShapeId = null;
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
	// suppressClick means a drag (pan, marquee-select, building-drag) just
	// ended on this same click event - the drag has already done whatever
	// it needed to (moved the view, built a selection, moved a building),
	// so hideMenu()'s clearSelection() must NOT also fire here, or a
	// completed marquee-select would be wiped out immediately after the
	// pointer that drew it comes back up.
	if (!event.target.closest(".placed-square") && !duplicateMode && !suppressClick) hideMenu();
	if (pathToolActive) return;
	if (duplicateMode) {
		const cell = getCellFromPoint(event.clientX, event.clientY);
		if (!cell) return;
		const { x, y } = cell;
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
	const cell = getCellFromPoint(event.clientX, event.clientY);
	if (!cell) return;
	const { x, y } = cell;
	const step = event.ctrlKey ? chunkSize : 1;
	const snap = snapToGrid(x, y, shapeW, shapeH, step);
	if (!snap) return;
	if (snap.x + shapeW > cols || snap.y + shapeH > rows) return;
	if (!canPlaceAt(snap.x, snap.y, shapeW, shapeH)) return;
	pushUndoState();
	placeSquare(snap.x, snap.y, { ...selectedShape, w: shapeW, h: shapeH, rotated: pendingRotated });
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

// Ctrl+C/Ctrl+V - a keybinding layer over the same "click to stamp" flow the
// Duplicate button above already arms (duplicateMode/duplicateGroup), except
// the copied data is snapshotted into plain objects up front rather than
// referencing the live placedSquares entries - copy and paste don't have to
// happen back-to-back like a duplicate does, so the clipboard needs to
// survive the originals later being moved, rotated (which mutates w/h in
// place - see rotateSelected), or deleted outright.
function copySelection() {
	if (!selectedPlaced.size) return;
	const selectedItems = Array.from(selectedPlaced)
		.map((el) => placedSquares.find((placed) => placed.el === el))
		.filter(Boolean);
	const anchor =
		placedSquares.find((placed) => placed.el === selectedPrimary) ||
		selectedItems[0];
	if (!anchor) return;
	clipboard = {
		anchorW: anchor.w,
		anchorH: anchor.h,
		items: selectedItems.map((item) => ({
			item: {
				id: item.id,
				label: item.label,
				w: item.w,
				h: item.h,
				category: item.category,
				emoji: item.emoji,
				styleFile: item.styleFile,
				rotated: item.rotated,
			},
			dx: item.x - anchor.x,
			dy: item.y - anchor.y,
		})),
	};
}

// Re-arms duplicateMode/duplicateGroup fresh from the clipboard snapshot on
// every call, rather than consuming it - unlike a duplicate (armed once from
// a live selection), the same copied selection can be pasted repeatedly.
function pasteClipboard() {
	if (!clipboard) return;
	duplicateMode = true;
	duplicateGroup = {
		anchor: { w: clipboard.anchorW, h: clipboard.anchorH },
		items: clipboard.items.map(({ item, dx, dy }) => ({ item, dx, dy })),
	};
	hideMenu(true);
}

document.addEventListener("click", (event) => {
	if (event.target.closest(".action-menu")) return;
	if (event.target.closest(".placed-square")) return;
	// Clicking controls in the right pane (e.g. the level selector) isn't
	// clicking "away" from the selected building — it's the whole reason
	// that building is selected. Don't drop the selection out from under it.
	// Uses composedPath() rather than event.target.closest(): the level
	// button's own click handler rebuilds the panel's innerHTML synchronously
	// (to redraw the material list), which detaches the clicked button from
	// the DOM before this listener runs during the bubble phase — at that
	// point .closest() on the now-disconnected target can't find any
	// ancestor at all. composedPath() is captured at dispatch time, before
	// that mutation happens, so it stays correct regardless.
	if (event.composedPath().includes(previewSidebar)) return;
	// A suppressed click follows a drag (pan, marquee-select, building-drag)
	// that already did whatever it needed to - must not also clear a
	// selection the drag itself just built (marquee-select) or clear
	// selection just because panning happened to end on a click.
	if (suppressClick) return;
	hideMenu();
});

// ----- Path tool helpers and handlers -----
function getCellFromPoint(clientX, clientY) {
	const rect = grid.getBoundingClientRect();
	const onScreenCellSize = cellSize * gridZoom;
	const x = Math.floor((clientX - rect.left) / onScreenCellSize);
	const y = Math.floor((clientY - rect.top) / onScreenCellSize);
	if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
	return { x, y };
}

// Kept ONLY for migrating pre-paintbrush saved plans (a straight line + one
// fixed width, see restorePathsFromSaved) - the live tool below paints
// freeform cell-by-cell instead and has no notion of a single line to draw.
function legacyOrthogonalLine(x0, y0, x1, y1) {
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

function legacyThickenLine(lineCells, width) {
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

// General (any-direction, not just axis-aligned) Bresenham line - used to
// interpolate between two consecutive pointermove samples while painting, so
// a fast drag doesn't leave gaps in the brush stroke between sparse samples.
function generalLine(x0, y0, x1, y1) {
	const cells = [];
	let x = x0;
	let y = y0;
	const dx = Math.abs(x1 - x0);
	const dyAbs = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dyAbs;
	for (;;) {
		cells.push({ x, y });
		if (x === x1 && y === y1) break;
		const e2 = 2 * err;
		if (e2 >= dyAbs) {
			err += dyAbs;
			x += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y += sy;
		}
	}
	return cells;
}

// Adds every cell in a width x width square centered on (cx, cy) into set,
// clamped to the grid bounds - the brush "stamp" applied at every point
// along a painted stroke (see generalLine above for how points in between
// pointermove samples get filled in too).
function stampBrush(set, cx, cy, width) {
	const r = Math.floor(width / 2);
	for (let dx = -r; dx <= r; dx++) {
		for (let dy = -r; dy <= r; dy++) {
			const nx = cx + dx;
			const ny = cy + dy;
			if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
			set.add(`${nx},${ny}`);
		}
	}
}

// Used by the hold-Shift-to-snap-straight brush behavior - picks whichever
// axis moved further from start to cell and locks the other one, the same
// "pick H or V, not both" rule the tool's pre-freeform version always used
// for its one straight segment.
function constrainToAxis(start, cell) {
	const dx = Math.abs(cell.x - start.x);
	const dy = Math.abs(cell.y - start.y);
	return dx >= dy ? { x: cell.x, y: start.y } : { x: start.x, y: cell.y };
}

function buildGlobalCellSet() {
	const set = new Set();
	for (const p of paths) {
		for (const c of p.cells) set.add(`${c.x},${c.y}`);
	}
	return set;
}

// Removes every cell in cellKeySet ("x,y") from every existing path,
// regardless of type - an eraser stroke doesn't care whether it's crossing
// a road, an alley, or a canal. A path emptied down to zero cells is
// deleted outright rather than left behind as a zero-cell husk.
function eraseCellsAt(cellKeySet) {
	for (let i = paths.length - 1; i >= 0; i--) {
		const path = paths[i];
		const filtered = path.cells.filter((c) => !cellKeySet.has(`${c.x},${c.y}`));
		if (filtered.length === path.cells.length) continue;
		if (filtered.length === 0) {
			path.elements.forEach((el) => el.remove());
			if (selectedPathId === path.id) selectedPathId = null;
			paths.splice(i, 1);
		} else {
			path.cells = filtered;
		}
	}
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

	// null (the "default" type, or an unrecognized one from an older/foreign
	// save) falls back to the theme's --path-cell-bg variable rather than a
	// fixed color, same as the tool always looked before road types existed.
	// Object.hasOwn, not a plain bracket-truthy check: path.type comes
	// straight from an imported plan's JSON on the restore path, and
	// ROAD_TYPE_COLORS is a plain object literal, so a crafted
	// type: "__proto__" would otherwise resolve via bracket access to the
	// object's actual prototype (a truthy object, not undefined) instead of
	// correctly falling through to the default color - confirmed this
	// without the hasOwn guard.
	const color = Object.hasOwn(ROAD_TYPE_COLORS, path.type)
		? ROAD_TYPE_COLORS[path.type]
		: null;

	const solid = ROAD_TYPE_SOLID.has(path.type);

	for (const cell of cells) {
		const relX = cell.x - minX;
		const relY = cell.y - minY;

		const cellEl = document.createElement("div");
		cellEl.style.position = "absolute";
		cellEl.style.left = `${relX * cellSize}px`;
		cellEl.style.top = `${relY * cellSize}px`;
		cellEl.style.width = `${cellSize}px`;
		cellEl.style.height = `${cellSize}px`;
		cellEl.style.pointerEvents = "none";
		cellEl.style.boxSizing = "border-box";

		if (solid) {
			// An opaque fill would otherwise completely hide the grid lines
			// underneath - redraw them on top instead, one tick per cell
			// (left/top edge each), the same technique .placed-square already
			// uses to show its own internal grid over a solid category color.
			// Self-aligning regardless of the shape's position: every cell is
			// exactly cellSize, so adjacent cells' lines abut seamlessly with
			// no absolute-position math needed.
			cellEl.style.backgroundColor = color || "var(--path-cell-bg)";
			cellEl.style.backgroundImage =
				"linear-gradient(to right, var(--grid-line-light) 1px, transparent 1px), " +
				"linear-gradient(to bottom, var(--grid-line-light) 1px, transparent 1px)";
		} else {
			cellEl.style.background = color || "var(--path-cell-bg)";
		}

		const hasLeft = globalCellSet.has(`${cell.x - 1},${cell.y}`);
		const hasRight = globalCellSet.has(`${cell.x + 1},${cell.y}`);
		const hasTop = globalCellSet.has(`${cell.x},${cell.y - 1}`);
		const hasBottom = globalCellSet.has(`${cell.x},${cell.y + 1}`);

		if (solid) {
			// A sunken-channel bevel instead of a flat, uniform border - dark
			// shadow on the top/left (the near wall of the carved channel,
			// where a top-left light source can't reach), light catching the
			// bottom/right (the far wall it grazes), the inverse of an
			// embossed/raised edge so it reads as indented rather than
			// bulging up. Only drawn on edges that actually border open
			// ground (not another canal cell), so adjacent canal cells still
			// read as one continuous channel.
			if (!hasTop) cellEl.style.borderTop = "1px solid var(--path-bevel-dark)";
			if (!hasLeft)
				cellEl.style.borderLeft = "1px solid var(--path-bevel-dark)";
			if (!hasBottom)
				cellEl.style.borderBottom = "1px solid var(--path-bevel-light)";
			if (!hasRight)
				cellEl.style.borderRight = "1px solid var(--path-bevel-light)";
		} else {
			const border = "1px solid var(--path-cell-border)";
			if (!hasTop) cellEl.style.borderTop = border;
			if (!hasBottom) cellEl.style.borderBottom = border;
			if (!hasLeft) cellEl.style.borderLeft = border;
			if (!hasRight) cellEl.style.borderRight = border;
		}

		container.appendChild(cellEl);
	}

	grid.appendChild(container);
	path.elements = [container];
}

function rerenderAllPathBorders() {
	const globalCellSet = buildGlobalCellSet();
	for (const path of paths) renderPathDOM(path, globalCellSet);
}

function setPathEraseMode(on) {
	pathEraseMode = on;
	pathEraseToggleButton.classList.toggle("is-active", pathEraseMode);
	pathEraseToggleButton.textContent = pathEraseMode ? "Eraser (on)" : "Eraser";
	if (!pathEraseMode) hideEraserHoverPreview();
}

pathEraseToggleButton.addEventListener("click", () => setPathEraseMode(!pathEraseMode));

// Same footprint math as stampBrush (r = floor(width/2), stamped from
// cx-r to cx+r inclusive on both axes) so the preview always matches what
// a click would actually erase, clamped to the grid same as stampBrush
// silently skips out-of-bounds cells.
function updateEraserHoverPreview(cell) {
	if (!pathToolActive || !pathEraseMode || !cell) {
		hideEraserHoverPreview();
		return;
	}
	const r = Math.floor(pathWidth / 2);
	const minX = Math.max(0, cell.x - r);
	const maxX = Math.min(cols - 1, cell.x + r);
	const minY = Math.max(0, cell.y - r);
	const maxY = Math.min(rows - 1, cell.y + r);
	eraserHoverEl.style.display = "block";
	eraserHoverEl.style.left = `${minX * cellSize}px`;
	eraserHoverEl.style.top = `${minY * cellSize}px`;
	eraserHoverEl.style.width = `${(maxX - minX + 1) * cellSize}px`;
	eraserHoverEl.style.height = `${(maxY - minY + 1) * cellSize}px`;
}

function hideEraserHoverPreview() {
	eraserHoverEl.style.display = "none";
}

// Right-click always pans (see the pointerdown listener below) - without
// this, the browser's native right-click menu would pop up over the grid
// every time, on top of whatever the pan just did. Buildings suppress their
// own contextmenu separately (see placeSquare) since this listener, being on
// .grid, only sees clicks that bubble up to it.
grid.addEventListener("contextmenu", (e) => {
	e.preventDefault();
});

// Pointer handlers for drawing and dragging
grid.addEventListener("pointerdown", (e) => {
	// Path drag: clicking a selected path while NOT in path-paint mode
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
				origCells: p.cells.map((c) => ({ ...c })),
			};
			grid.setPointerCapture(e.pointerId);
			e.preventDefault();
			return;
		}
	}

	// Left-click paints/erases while the Roads & Rivers tool is armed - the
	// normal, expected button for a drawing tool's primary action. Panning
	// moves to right-click for exactly as long as the tool stays armed (see
	// the panning block below), so the map is still fully navigable without
	// switching tools first.
	if (pathToolActive && pathEraseMode && e.button === 0) {
		const cell = getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;
		pushUndoState();
		pathErasing = true;
		paintLastCell = cell;
		const stampSet = new Set();
		stampBrush(stampSet, cell.x, cell.y, pathWidth);
		eraseCellsAt(stampSet);
		rerenderAllPathBorders();
		try {
			grid.setPointerCapture(e.pointerId);
		} catch {
			// Pointer capture may not be available in every context.
		}
		e.preventDefault();
		return;
	}

	// "walls" places real schematic buildings on release (see
	// WALL_KITS/placeWallRun) instead of painting cells live - it needs the
	// full drawn line up front, not a running brush stroke, so this only
	// tracks the drag here and does the actual placement in the pointerup
	// handler below.
	if (pathToolActive && !pathEraseMode && pathType === "walls" && e.button === 0) {
		const cell = getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;
		// Pointer capture below means the "click" event this pointerdown may
		// still produce (if it turns out to be a plain click, not a real
		// drag) routes to .grid, not whatever .placed-square is actually
		// under the cursor - so a plain click on an existing wall piece
		// can't rely on that building's own click listener firing at all.
		// Remembering the real target here lets the pointerup handler below
		// select it directly instead.
		wallDrawPending = {
			pointerId: e.pointerId,
			startCell: cell,
			downTarget: e.target,
		};
		try {
			grid.setPointerCapture(e.pointerId);
		} catch {
			// Pointer capture may not be available in every context.
		}
		e.preventDefault();
		return;
	}

	if (pathToolActive && pathType !== "walls" && e.button === 0) {
		const cell = getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;
		pushUndoState();
		const id = `path_${nextPathId++}`;
		const path = {
			id,
			type: pathType,
			width: pathWidth,
			cells: [],
			elements: [],
		};
		paths.push(path);
		paintPathId = id;
		paintCellSet = new Set();
		pathPainting = true;
		paintLastCell = cell;
		stampBrush(paintCellSet, cell.x, cell.y, path.width);
		path.cells = [...paintCellSet].map((s) => {
			const [x, y] = s.split(",").map(Number);
			return { x, y };
		});
		renderPathDOM(path, buildGlobalCellSet());
		try {
			grid.setPointerCapture(e.pointerId);
		} catch {
			// Pointer capture may not be available in every context.
		}
		e.preventDefault();
		return;
	}

	// Only when nothing else already claimed this pointerdown. Placed
	// buildings have their own pointerdown listener (startDrag, attached
	// per-element) which fires first during the target phase and sets
	// pendingDrag before this (bubbled, grid-level) listener runs, so
	// checking pendingDrag/isDragging here is enough to yield to a building
	// drag already in progress without needing to duplicate its
	// target-matching logic. Right-click always pans (regardless of tool),
	// leaving left-click free to always mean marquee-select on empty grid
	// space - even while the Roads & Rivers tool is armed, since that
	// tool's own paint/erase/wall handling above already claimed left-click
	// and returned before reaching here.
	if (e.button !== 0 && e.button !== 2) return;
	if (pendingDrag || isDragging) return;
	if (
		e.target.closest(
			".placed-square, .placed-path, .action-menu, .path-action-menu",
		)
	)
		return;

	// Right-click-and-drag panning of the grid itself.
	if (e.button === 2) {
		pendingPan = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			startScrollLeft: root.scrollLeft,
			startScrollTop: root.scrollTop,
		};
		// Captured immediately, not once the movement threshold trips in
		// pointermove below - a trackpad can report move events in coarser,
		// bigger jumps than a mouse, so the very first move after pointerdown
		// might already land outside .grid's bounds. Without capture that move
		// event (and every one after it) would go to whatever's now under the
		// cursor instead of .grid, and pendingPan would just sit there forever,
		// looking like the drag silently did nothing.
		try {
			grid.setPointerCapture(e.pointerId);
		} catch {
			// Pointer capture may not be available in every context.
		}
		return;
	}

	// Marquee (rubber-band) select - plain left-drag on empty grid space.
	// Shift preserves the existing selection (additive), otherwise the drag
	// starts a fresh selection. duplicateMode gets its own click-to-place
	// handling elsewhere and shouldn't also start a marquee mid-placement.
	if (!duplicateMode) {
		const point = getGridPointFromClient(e.clientX, e.clientY);
		pendingMarquee = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			startPoint: point,
			preservedSelection: e.shiftKey ? new Set(selectedPlaced) : new Set(),
		};
		try {
			grid.setPointerCapture(e.pointerId);
		} catch {
			// Pointer capture may not be available in every context.
		}
		e.preventDefault();
	}
});

grid.addEventListener("pointermove", (e) => {
	// Wall-draw preview - locked to whichever axis (horizontal/vertical) the
	// drag has moved further along, recomputed fresh every move (same
	// "can still slide" reasoning as the Shift-straight-line brush
	// constraint) rather than permanently locking on the first move.
	// Nothing is actually placed until release (see the pointerup handler) -
	// this only tracks where the run would land.
	if (wallDrawPending && e.pointerId === wallDrawPending.pointerId) {
		const cell = getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;
		if (!wallDrawing) {
			if (
				cell.x === wallDrawPending.startCell.x &&
				cell.y === wallDrawPending.startCell.y
			)
				return;
			wallDrawing = true;
			wallDrawPreviewEl.style.display = "block";
		}
		e.preventDefault();
		const constrained = constrainToAxis(wallDrawPending.startCell, cell);
		const axis =
			constrained.y === wallDrawPending.startCell.y
				? "horizontal"
				: "vertical";
		wallDrawAxis = axis;
		wallDrawPending.endCell = constrained;
		const kit = WALL_KITS[styleSelect.value];
		if (kit) {
			const perpCoord =
				axis === "horizontal"
					? wallDrawPending.startCell.y
					: wallDrawPending.startCell.x;
			const thicknessOrigin =
				perpCoord - Math.floor(kit.segmentThickness / 2);
			const runMin =
				axis === "horizontal"
					? Math.min(wallDrawPending.startCell.x, constrained.x)
					: Math.min(wallDrawPending.startCell.y, constrained.y);
			const runMax =
				axis === "horizontal"
					? Math.max(wallDrawPending.startCell.x, constrained.x)
					: Math.max(wallDrawPending.startCell.y, constrained.y);
			const runLength = runMax - runMin + 1;
			const x = axis === "horizontal" ? runMin : thicknessOrigin;
			const y = axis === "horizontal" ? thicknessOrigin : runMin;
			const w = axis === "horizontal" ? runLength : kit.segmentThickness;
			const h = axis === "horizontal" ? kit.segmentThickness : runLength;
			wallDrawPreviewEl.style.left = `${x * cellSize}px`;
			wallDrawPreviewEl.style.top = `${y * cellSize}px`;
			wallDrawPreviewEl.style.width = `${w * cellSize}px`;
			wallDrawPreviewEl.style.height = `${h * cellSize}px`;
		}
		return;
	}

	// Marquee select - same small-movement threshold as panning/building
	// drag, so a plain Shift+click (no real drag) doesn't draw a
	// zero-size box and can fall through to whatever a plain click does.
	if (pendingMarquee && e.pointerId === pendingMarquee.pointerId) {
		const dx = e.clientX - pendingMarquee.startX;
		const dy = e.clientY - pendingMarquee.startY;
		if (!isMarqueeSelecting && Math.hypot(dx, dy) >= 4) {
			isMarqueeSelecting = true;
			suppressClick = true;
			marqueeEl.style.display = "block";
		}
		if (isMarqueeSelecting) {
			e.preventDefault();
			const point = getGridPointFromClient(e.clientX, e.clientY);
			const rect = {
				x: Math.min(pendingMarquee.startPoint.x, point.x),
				y: Math.min(pendingMarquee.startPoint.y, point.y),
				w: Math.abs(point.x - pendingMarquee.startPoint.x),
				h: Math.abs(point.y - pendingMarquee.startPoint.y),
			};
			marqueeEl.style.left = `${rect.x * cellSize}px`;
			marqueeEl.style.top = `${rect.y * cellSize}px`;
			marqueeEl.style.width = `${rect.w * cellSize}px`;
			marqueeEl.style.height = `${rect.h * cellSize}px`;
			updateMarqueeSelection(rect);
		}
		return;
	}

	// Click-and-drag panning - same small-movement threshold as building
	// drag (pendingDrag/beginDrag above) so a plain click still places/
	// selects normally and only a deliberate drag pans.
	if (pendingPan && e.pointerId === pendingPan.pointerId) {
		const dx = e.clientX - pendingPan.startX;
		const dy = e.clientY - pendingPan.startY;
		if (!isPanning && Math.hypot(dx, dy) >= 4) {
			// Capture already happened at pointerdown, above.
			isPanning = true;
			suppressClick = true;
			grid.classList.add("is-panning");
		}
		if (isPanning) {
			e.preventDefault();
			root.scrollLeft = pendingPan.startScrollLeft - dx;
			root.scrollTop = pendingPan.startScrollTop - dy;
		}
		return;
	}

	// Path drag move (translate an already-placed, selected path)
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
					p.cells = pathDragPending.origCells.map((c) => ({
						x: c.x + dx,
						y: c.y + dy,
					}));
					rerenderAllPathBorders();
				}
			}
		}
		return;
	}

	// Eraser drag: same stamp-and-interpolate approach as painting, but
	// removing matching cells from every existing path instead of adding to
	// a new one.
	if (pathErasing) {
		const cell = getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;
		const stampSet = new Set();
		const points = paintLastCell
			? generalLine(paintLastCell.x, paintLastCell.y, cell.x, cell.y)
			: [cell];
		for (const point of points) stampBrush(stampSet, point.x, point.y, pathWidth);
		paintLastCell = cell;
		eraseCellsAt(stampSet);
		rerenderAllPathBorders();
		return;
	}

	// Brush painting: stamp a width x width square at every point along the
	// path from the last sampled cell to this one (generalLine fills the gap
	// between samples so a fast drag doesn't leave holes in the stroke).
	// Holding Shift constrains the CURRENT segment to a straight horizontal
	// or vertical line from wherever the brush was when Shift went down
	// (shiftLineAnchor) - recomputed fresh from shiftLineBaseline on every
	// move so the line can still slide as the cursor does, the same way the
	// old click-two-points tool's live preview worked.
	if (pathPainting) {
		const cell = getCellFromPoint(e.clientX, e.clientY);
		if (!cell) return;
		const path = paths.find((p) => p.id === paintPathId);
		if (!path) return;

		if (e.shiftKey) {
			if (!shiftLineAnchor) {
				shiftLineAnchor = paintLastCell;
				shiftLineBaseline = new Set(paintCellSet);
			}
			const constrained = constrainToAxis(shiftLineAnchor, cell);
			const preview = new Set(shiftLineBaseline);
			for (const point of generalLine(shiftLineAnchor.x, shiftLineAnchor.y, constrained.x, constrained.y)) {
				stampBrush(preview, point.x, point.y, path.width);
			}
			path.cells = [...preview].map((s) => {
				const [x, y] = s.split(",").map(Number);
				return { x, y };
			});
		} else {
			if (shiftLineAnchor) {
				// Shift just released - bake the straight segment in for good
				// and resume freeform from where it ended.
				paintCellSet = new Set(path.cells.map((c) => `${c.x},${c.y}`));
				paintLastCell = constrainToAxis(shiftLineAnchor, cell);
				shiftLineAnchor = null;
				shiftLineBaseline = null;
			}
			const points = paintLastCell
				? generalLine(paintLastCell.x, paintLastCell.y, cell.x, cell.y)
				: [cell];
			for (const point of points) stampBrush(paintCellSet, point.x, point.y, path.width);
			paintLastCell = cell;
			path.cells = [...paintCellSet].map((s) => {
				const [x, y] = s.split(",").map(Number);
				return { x, y };
			});
		}
		renderPathDOM(path, buildGlobalCellSet());
	}
});

grid.addEventListener("pointerup", (e) => {
	// Wall-draw end - actually places the schematic pieces now that the
	// full run is known (see placeWallRun).
	if (wallDrawPending && e.pointerId === wallDrawPending.pointerId) {
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {
			// Pointer capture may already be released.
		}
		if (wallDrawing && wallDrawPending.endCell) {
			pushUndoState();
			placeWallRun(wallDrawAxis, wallDrawPending.startCell, wallDrawPending.endCell);
			scheduleAutoSave();
		} else {
			// A plain click, not a drag - see the pointerdown comment above
			// for why this building's own click listener can't be relied on
			// to select it in walls mode.
			const clickedBuilding = wallDrawPending.downTarget?.closest?.(
				".placed-square",
			);
			if (clickedBuilding) {
				selectPlaced(clickedBuilding, e.shiftKey);
				// The "click" event this pointerup produces routes to .grid,
				// not the building (same pointer-capture reason as above) -
				// .grid's own click handler would otherwise read that as "a
				// click landed on empty space" and clear the selection this
				// just built, immediately undoing it.
				suppressClick = true;
				setTimeout(() => {
					suppressClick = false;
				}, 0);
			}
		}
		wallDrawPreviewEl.style.display = "none";
		wallDrawPending = null;
		wallDrawing = false;
		wallDrawAxis = null;
		return;
	}

	// Marquee select end
	if (pendingMarquee && e.pointerId === pendingMarquee.pointerId) {
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {
			// Pointer capture may already be released.
		}
		if (isMarqueeSelecting) {
			marqueeEl.style.display = "none";
			updateShapeSelectionUI();
			if (selectedPrimary && isMenuOpen()) showMenuFor(selectedPrimary);
			setTimeout(() => {
				suppressClick = false;
			}, 0);
		}
		pendingMarquee = null;
		isMarqueeSelecting = false;
		return;
	}

	// Pan end
	if (pendingPan && e.pointerId === pendingPan.pointerId) {
		// Capture happens unconditionally at pointerdown (see above), so it
		// needs releasing unconditionally here too, not just when the
		// movement threshold was actually crossed.
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {
			// Pointer capture may already be released.
		}
		if (isPanning) {
			grid.classList.remove("is-panning");
			// Deferred so the click event this pointerup may still trigger
			// (same trick beginDrag/finishDrag use above) sees suppressClick
			// still true and skips placing/selecting at the drag's end point.
			setTimeout(() => {
				suppressClick = false;
			}, 0);
		}
		pendingPan = null;
		isPanning = false;
		return;
	}

	// Path drag end
	if (pathDragPending && e.pointerId === pathDragPending.pointerId) {
		if (pathDragging) scheduleAutoSave();
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

	// Eraser drag end - already committed cell-by-cell (see pointermove
	// above), so this just releases capture and autosaves.
	if (pathErasing) {
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {}
		pathErasing = false;
		paintLastCell = null;
		scheduleAutoSave();
		return;
	}

	// Brush painting end - the stroke is already committed cell-by-cell as it
	// was painted (see pointermove above), so this just closes it out: a
	// full rerenderAllPathBorders() reconciles borders against every OTHER
	// path too (a stroke finishing right next to an existing road should
	// hide the seam between them, which only needs checking once here rather
	// than on every single stamp while painting).
	if (pathPainting) {
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {}
		pathPainting = false;
		paintPathId = null;
		paintCellSet = null;
		paintLastCell = null;
		shiftLineAnchor = null;
		shiftLineBaseline = null;
		rerenderAllPathBorders();
		scheduleAutoSave();
	}
});

grid.addEventListener("pointercancel", (e) => {
	// Wall-draw cancel - unlike the brush tools, nothing is placed until a
	// clean release (see pointerup above), so a cancel just discards the
	// in-progress preview rather than committing a possibly-incomplete run.
	if (wallDrawPending && e.pointerId === wallDrawPending.pointerId) {
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {
			// Pointer capture may already be released.
		}
		wallDrawPreviewEl.style.display = "none";
		wallDrawPending = null;
		wallDrawing = false;
		wallDrawAxis = null;
		return;
	}

	// Whatever the marquee had selected before the cancel (e.g. the pointer
	// left the window mid-drag) is kept, same as a normal pointerup.
	if (pendingMarquee && e.pointerId === pendingMarquee.pointerId) {
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {
			// Pointer capture may already be released.
		}
		if (isMarqueeSelecting) {
			marqueeEl.style.display = "none";
			updateShapeSelectionUI();
			setTimeout(() => {
				suppressClick = false;
			}, 0);
		}
		pendingMarquee = null;
		isMarqueeSelecting = false;
		return;
	}
	// Whatever got erased/painted before the cancel (e.g. the pointer left
	// the window mid-stroke) is kept, same as a normal pointerup - undo is
	// always there if that's not what was wanted.
	if (pathErasing) {
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {}
		pathErasing = false;
		paintLastCell = null;
		scheduleAutoSave();
		return;
	}
	if (pathPainting) {
		try {
			grid.releasePointerCapture(e.pointerId);
		} catch {}
		pathPainting = false;
		paintPathId = null;
		paintCellSet = null;
		paintLastCell = null;
		shiftLineAnchor = null;
		shiftLineBaseline = null;
		rerenderAllPathBorders();
		scheduleAutoSave();
		return;
	}
	if (!pendingPan || e.pointerId !== pendingPan.pointerId) return;
	try {
		grid.releasePointerCapture(e.pointerId);
	} catch {
		// Pointer capture may already be released.
	}
	grid.classList.remove("is-panning");
	pendingPan = null;
	isPanning = false;
	setTimeout(() => {
		suppressClick = false;
	}, 0);
});

// Hover readout at the top of the preview pane: block coordinates always,
// plus the real biome name when a world background is loaded (converting
// grid-space (x, y) to real Minecraft (worldX, worldZ) via the background's
// own minCx/minCz - the grid's origin has no relationship to real
// coordinates otherwise, see the World Background comment above).
grid.addEventListener("pointermove", (e) => {
	const cell = getCellFromPoint(e.clientX, e.clientY);
	updateEraserHoverPreview(cell);
	if (!cell) {
		hoverCoordsEl.hidden = true;
		return;
	}
	hoverCoordsEl.hidden = false;
	hoverCoordsPosEl.textContent = `Block (${cell.x}, ${cell.y})`;
	if (worldBackground && worldBackground.biomeAt) {
		const worldX = worldBackground.minCx * 16 + cell.x;
		const worldZ = worldBackground.minCz * 16 + cell.y;
		const info = worldBackground.biomeAt(worldX, worldZ);
		hoverCoordsBiomeEl.textContent =
			info && info.biome ? window.WorldTerrain.formatBiomeName(info.biome) : "";
	} else {
		hoverCoordsBiomeEl.textContent = "";
	}
});
grid.addEventListener("pointerleave", () => {
	hoverCoordsEl.hidden = true;
	hideEraserHoverPreview();
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
	// Anchored to the path's own logical (block) coordinates, same as
	// showMenuFor() does for buildings - NOT getBoundingClientRect(), which
	// reports post-zoom-transform screen pixels and would need the current
	// zoom divided back out before it could be used as a .grid-shell-local
	// style.left/top (a plain building placed via style.left = x*cellSize
	// rides along with the transform automatically; a menu positioned from
	// a screen-space rect would double up with it instead). A painted path
	// has no single "start" point like the old from/to line did, so this
	// anchors off its bounding box's top-right corner instead.
	const xs = path.cells.map((c) => c.x);
	const ys = path.cells.map((c) => c.y);
	const anchorX = Math.max(...xs);
	const anchorY = Math.min(...ys);
	let left = (anchorX + 1) * cellSize + 8;
	let top = anchorY * cellSize;
	if (left + menuWidth > gridWidth) {
		left = anchorX * cellSize - menuWidth - 8;
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

	paths.forEach((path) => {
		ctx.fillStyle = Object.hasOwn(ROAD_TYPE_COLORS, path.type)
			? ROAD_TYPE_COLORS[path.type]
			: pathBg;
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
		ctx.fillText(placed.label, x + w / 2, y + h / 2, Math.max(w - 8, 4));
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

// ----- Plan Check -----
// Flags missing essential buildings and gives rough guard/food-vs-housing
// guidance. The planner has no concept of building *level* (footprints don't
// change with level, and this app never asks for one), so real per-colonist
// numbers (bed capacity = level, guards needed = 2 per 3 citizens, etc. — see
// MINECOLONIES_MECHANICS.md) aren't computable here. These ratio checks are
// deliberately labeled as rule-of-thumb guidance based on building *counts*,
// not a citizen-count simulation — see FEASIBILITY_NOTES.md for why an exact
// version of this belongs in a separate calculator, not the layout tool.
const ESSENTIAL_BUILDING_CHECKS = [
	{
		keywords: ["town hall"],
		title: "Town Hall",
		detail: "Founds the colony and claims the surrounding chunks.",
	},
	{
		keywords: ["builder"],
		title: "Builder's Hut",
		detail: "Needed to construct or upgrade any other building.",
	},
	{
		keywords: ["warehouse"],
		title: "Warehouse",
		detail: "Needed for storage and Courier deliveries between buildings.",
	},
	{
		keywords: ["residence", "tavern"],
		title: "Housing",
		detail: "Colonists need a Residence or Tavern bed to live in the colony.",
	},
	{
		keywords: [
			"farmer",
			"fisherman",
			"shepherd",
			"baker",
			"cook",
			"cookery",
			"beekeeper",
			"chicken herder",
			"cowboy",
			"rabbit hutch",
			"swineherder",
			"plantation",
		],
		title: "Food production",
		detail: "At least one food building — colonists starve without one.",
	},
];
const GUARD_KEYWORDS = ["guard tower", "barracks"];
const HOUSING_KEYWORDS = ["residence", "tavern"];
const FOOD_KEYWORDS = ESSENTIAL_BUILDING_CHECKS.find(
	(check) => check.title === "Food production",
).keywords;

function countPlacedByKeywords(keywords) {
	return placedSquares.reduce((count, square) => {
		const label = (square.label || "").toLowerCase();
		return keywords.some((keyword) => label.includes(keyword))
			? count + 1
			: count;
	}, 0);
}

function computePlanChecks() {
	const essentials = ESSENTIAL_BUILDING_CHECKS.map((check) => ({
		status: countPlacedByKeywords(check.keywords) > 0 ? "ok" : "warn",
		title: check.title,
		detail: check.detail,
	}));

	const housingCount = countPlacedByKeywords(HOUSING_KEYWORDS);
	const guardCount = countPlacedByKeywords(GUARD_KEYWORDS);
	const foodCount = countPlacedByKeywords(FOOD_KEYWORDS);
	const ratios = [];

	if (housingCount > 0) {
		const recommendedGuards = Math.max(1, Math.ceil(housingCount / 3));
		if (guardCount === 0) {
			ratios.push({
				status: "warn",
				title: "No guard buildings yet",
				detail:
					"MineColonies targets roughly 2 guards per 3 citizens for security and happiness. Consider a Guard Tower or Barracks.",
			});
		} else if (guardCount < recommendedGuards) {
			ratios.push({
				status: "warn",
				title: `${guardCount} guard building${guardCount === 1 ? "" : "s"} for ${housingCount} housing building${housingCount === 1 ? "" : "s"}`,
				detail:
					"Rule of thumb: aim for roughly 1 guard building per 3 housing buildings.",
			});
		} else {
			ratios.push({
				status: "ok",
				title: `${guardCount} guard building${guardCount === 1 ? "" : "s"} for ${housingCount} housing building${housingCount === 1 ? "" : "s"}`,
				detail: "Guard coverage looks reasonable relative to housing.",
			});
		}

		if (foodCount > 0) {
			const recommendedFood = Math.max(1, Math.ceil(housingCount / 3));
			if (foodCount < recommendedFood) {
				ratios.push({
					status: "warn",
					title: `${foodCount} food building${foodCount === 1 ? "" : "s"} for ${housingCount} housing building${housingCount === 1 ? "" : "s"}`,
					detail:
						"Rule of thumb: aim for roughly 1 food building per 3 housing buildings. Actual throughput also depends on building level and worker skill.",
				});
			} else {
				ratios.push({
					status: "ok",
					title: `${foodCount} food building${foodCount === 1 ? "" : "s"} for ${housingCount} housing building${housingCount === 1 ? "" : "s"}`,
					detail: "Food production looks reasonable relative to housing.",
				});
			}
		}
	}

	return { essentials, ratios };
}

function renderPlanCheckGroup(title, items) {
	if (items.length === 0) return "";
	const rows = items
		.map(
			(item) => `
				<div class="plan-check__item plan-check__item--${item.status}">
					<span class="plan-check__icon">${window.MCIcons.getIconSvg(item.status === "ok" ? "✅" : "⚠️", { size: 15 })}</span>
					<span class="plan-check__text">
						<span class="plan-check__title">${escapeHtmlForPlanCheck(item.title)}</span>
						<span class="plan-check__detail">${escapeHtmlForPlanCheck(item.detail)}</span>
					</span>
				</div>
			`,
		)
		.join("");
	return `<div class="plan-check__group"><h4 class="plan-check__group-title">${title}</h4>${rows}</div>`;
}

function escapeHtmlForPlanCheck(str) {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function runPlanCheck() {
	if (placedSquares.length === 0) {
		planCheckEl.innerHTML = `<p class="plan-check__empty">Place some buildings to see plan health checks.</p>`;
		return;
	}
	const { essentials, ratios } = computePlanChecks();
	planCheckEl.innerHTML =
		renderPlanCheckGroup("Essentials", essentials) +
		renderPlanCheckGroup("Guards &amp; food", ratios);
}

// ----- Save / Load -----
const SAVE_FORMAT_VERSION = 1;
const AUTOSAVE_STORAGE_KEY = "minecolonies.autosave.v1";
let autoSaveTimer = null;
let autoSaveSuppressed = false;

function scheduleAutoSave() {
	if (autoSaveSuppressed) return;
	runPlanCheck();
	if (autoSaveTimer) clearTimeout(autoSaveTimer);
	autoSaveTimer = setTimeout(async () => {
		autoSaveTimer = null;
		try {
			const data = serializePlan();
			data.background =
				await getWorldBackgroundSaveDataLocal(AUTOSAVE_BG_IDB_KEY);
			window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(data));
		} catch {
			// localStorage may still be unavailable/full even for the small
			// (background-free) plan JSON itself, or IndexedDB could be
			// blocked entirely (e.g. some private-browsing modes) forcing
			// getWorldBackgroundSaveDataLocal's inline-dataUrl fallback back
			// into that same small localStorage write - surface that
			// specifically rather than silently dropping it with no clue why.
			if (worldBackground) {
				bgStatusEl.textContent =
					"Background couldn't be autosaved (browser storage is full) - buildings still save fine, but re-upload the world file after a reload.";
			}
		}
	}, 500);
}

// includeBackground is a separate opt-in, not just always-on, because
// pushUndoState() calls this on every single edit (up to MAX_UNDO_STATES
// snapshots kept at once) - a multi-megabyte background PNG data URL in
// EVERY one of those would balloon memory for no benefit, since undoing a
// building placement should never touch the background anyway. Only the
// paths that actually need the background to survive a reload (autosave,
// JSON export, named plans) opt in.
function serializePlan({ includeBackground = false } = {}) {
	const data = {
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
			label: placed.label,
			category: placed.category,
			emoji: placed.emoji,
			styleFile: placed.styleFile,
			rotated: placed.rotated,
		})),
		roads: {
			paths: paths.map((path) => ({
				id: path.id,
				type: path.type,
				width: path.width,
				cells: path.cells.map((c) => ({ x: c.x, y: c.y })),
			})),
		},
	};
	if (includeBackground) {
		data.background = getWorldBackgroundSaveData();
	}
	return data;
}

function downloadPlanAsJSON() {
	const json = JSON.stringify(
		serializePlan({ includeBackground: true }),
		null,
		2,
	);
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
			label: building.label,
			category: building.category,
			emoji: building.emoji,
			styleFile: building.styleFile,
			rotated: building.rotated,
		});
	});
}

function restorePathsFromSaved(savedPaths) {
	if (!Array.isArray(savedPaths)) return;
	let maxId = 0;
	savedPaths.forEach((saved) => {
		if (!saved) return;
		let cells;
		if (Array.isArray(saved.cells)) {
			cells = saved.cells
				.filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y))
				.map((c) => ({ x: c.x, y: c.y }));
		} else if (saved.from && saved.to) {
			// Pre-paintbrush save format: a straight line + one fixed width, no
			// type. One-time migration to the new cell-set shape - it becomes a
			// normal static painted blob after this (no more drag-to-resize an
			// endpoint, since there's no single endpoint anymore), same as any
			// other loaded path.
			const line = legacyOrthogonalLine(
				saved.from.x,
				saved.from.y,
				saved.to.x,
				saved.to.y,
			);
			cells = legacyThickenLine(line, 5);
		} else {
			return;
		}
		if (cells.length === 0) return;
		const path = {
			id: saved.id || `path_${nextPathId++}`,
			type:
				saved.type === "default" || Object.hasOwn(ROAD_TYPE_COLORS, saved.type)
					? saved.type
					: "default",
			width: Number.isFinite(saved.width)
				? Math.max(1, Math.min(10, Math.round(saved.width)))
				: 5,
			cells,
			elements: [],
		};
		paths.push(path);
		const match = /_(\d+)$/.exec(String(path.id || ""));
		if (match) maxId = Math.max(maxId, Number(match[1]));
	});
	nextPathId = Math.max(nextPathId, maxId + 1);
	rerenderAllPathBorders();
}

// backgroundIdbKey tells restoreWorldBackgroundFromSaved's IndexedDB lookup
// where to find the image when data.background didn't already carry it
// inline (see getWorldBackgroundSaveDataLocal) - omitted entirely for an
// imported JSON file, which is always self-contained already.
async function applyPlanData(data, { backgroundIdbKey } = {}) {
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
		}
		restoreBuildingsFromSaved(data.buildings);
		restorePathsFromSaved(data.roads && data.roads.paths);
		const resolvedBackground = await resolveBackgroundForRestore(
			data.background || null,
			backgroundIdbKey,
		);
		await restoreWorldBackgroundFromSaved(resolvedBackground);
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
		const parsed = raw ? JSON.parse(raw) : null;
		// A null-prototype object, not {} - a plan name is arbitrary user-typed
		// text, and `plans[name] = value` on a normal object treats a plan
		// literally named "__proto__" as a request to rewrite the object's own
		// prototype (via the inherited accessor) instead of storing a real
		// entry, so the save would silently vanish instead of being listed.
		// Object.create(null) has no such accessor - "__proto__" lands as an
		// ordinary key like any other saved name. Object.assign reads via the
		// parsed object (a normal object, unaffected either way) and writes
		// onto the null-proto target, so it's safe regardless of what's in
		// localStorage.
		return Object.assign(
			Object.create(null),
			typeof parsed === "object" && parsed ? parsed : null,
		);
	} catch {
		return Object.create(null);
	}
}

function saveNamedPlans(plans) {
	try {
		window.localStorage.setItem(NAMED_PLANS_STORAGE_KEY, JSON.stringify(plans));
		return true;
	} catch {
		// localStorage may be unavailable or full - a background image data
		// URL embedded per saved plan is the most likely reason to actually
		// hit the quota here.
		return false;
	}
}

async function saveCurrentPlanAs(name) {
	const trimmed = name.trim();
	if (!trimmed) return;
	const plans = loadNamedPlans();
	if (plans[trimmed]) {
		const confirmed = window.confirm(
			`A plan named "${trimmed}" already exists. Overwrite it?`,
		);
		if (!confirmed) return;
	}
	const plan = serializePlan();
	plan.background = await getWorldBackgroundSaveDataLocal(
		namedPlanBgIdbKey(trimmed),
	);
	plans[trimmed] = { plan, savedAt: new Date().toISOString() };
	if (!saveNamedPlans(plans)) {
		window.alert(
			`Couldn't save "${trimmed}" - browser storage is full. Try removing the world background first, or delete an older saved plan to free up space.`,
		);
		return;
	}
	renderNamedPlansList();
}

async function loadNamedPlan(name) {
	const plans = loadNamedPlans();
	const entry = plans[name];
	if (!entry) return;
	await applyPlanData(entry.plan, {
		backgroundIdbKey: namedPlanBgIdbKey(name),
	});
}

function deleteNamedPlan(name) {
	const confirmed = window.confirm(`Delete the saved plan "${name}"?`);
	if (!confirmed) return;
	const plans = loadNamedPlans();
	delete plans[name];
	saveNamedPlans(plans);
	idbDeleteBackground(namedPlanBgIdbKey(name)).catch(() => {}); // best-effort cleanup - a leftover entry is harmless, just unreachable
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
		deleteBtn.className =
			"left-sidebar__plan-action left-sidebar__plan-action--danger";
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

clearBoardButton.addEventListener("click", () => {
	if (placedSquares.length === 0 && paths.length === 0) return; // nothing to clear, skip the confirm entirely
	const confirmed = window.confirm(
		`Clear the board? This removes all ${placedSquares.length} building${placedSquares.length === 1 ? "" : "s"} and ${paths.length} road${paths.length === 1 ? "" : "s"} - undo will still work if you change your mind.`,
	);
	if (!confirmed) return;
	pushUndoState();
	clearPlan();
	scheduleAutoSave();
});

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

loadAllStyles()
	.then(() => applyStyle(STYLE_FILES[0].file))
	.then(async () => {
		try {
			const raw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
			// Awaited (unlike before) so the grid is already at its final,
			// restored size - restoreGridView() below needs that, otherwise
			// the browser clamps the saved scroll position against whatever
			// smaller scrollable area still existed at that point.
			if (raw)
				await applyPlanData(JSON.parse(raw), {
					backgroundIdbKey: AUTOSAVE_BG_IDB_KEY,
				});
		} catch (error) {
			console.error("Failed to restore autosave", error);
		}
		restoreGridView();
		runPlanCheck();
	});
