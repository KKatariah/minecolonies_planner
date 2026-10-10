// Keeping the plan: autosave (restored on the next visit), JSON import and
// export, and Clear board. Named plans are in named-plans.js.

import { STYLE_FILES } from "./config.js";
import { activeStyleFile } from "./catalog.js";
import { AUTOSAVE_BG_KEY } from "./background-store.js";
import { placedSquares } from "./buildings.js";
import { batched, on } from "./events.js";
import { clearHistory, pushUndoState } from "./history.js";
import {
	bgStatusEl,
	clearBoardButton,
	exportJsonButton,
	exportPngButton,
	importJsonInput,
	importJsonTriggerButton,
} from "./layout.js";
import { SAVE_FORMAT_VERSION } from "./plan-format.js";
import { clearPlan, loadPlanContents, sanitizeForBoard, serializePlan } from "./plan-state.js";
import { paths } from "./paths.js";
import { exportPlanAsPNG } from "./png-export.js";
import { applyStyle } from "./tray.js";
import {
	getWorldBackgroundSaveDataLocal,
	resolveBackgroundForRestore,
	restoreWorldBackgroundFromSaved,
	worldBackground,
} from "./world-background.js";
import { readStored, writeStored } from "../lib/storage.js";

export const AUTOSAVE_STORAGE_KEY = "minecolonies.autosave.v1";

// The pending autosave's timer, or null when there's nothing unsaved.
export let autoSaveTimer = null;

function scheduleAutoSave() {
	clearTimeout(autoSaveTimer);
	autoSaveTimer = setTimeout(async () => {
		autoSaveTimer = null;
		const data = serializePlan();
		try {
			data.background = await getWorldBackgroundSaveDataLocal(AUTOSAVE_BG_KEY);
		} catch {
			data.background = null;
		}
		// Fails if storage is full - most likely from a background stored
		// inline because IndexedDB is unavailable (some private modes).
		if (!writeStored(AUTOSAVE_STORAGE_KEY, JSON.stringify(data)) && worldBackground) {
			bgStatusEl.textContent =
				"Background couldn't be autosaved (browser storage is full) - buildings still save fine, but re-upload the world file after a reload.";
		}
	}, 500);
}

// Replaces the board (and undo history) with a saved plan, switching to its
// style. backgroundKey: where IndexedDB holds the background image, for
// plans that don't carry it inline (autosave, named plans).
// Resolves to { ok: true, skippedBuildings } or { ok: false, message }.
export async function applyPlanData(data, { backgroundKey } = {}) {
	if (!data || data.formatVersion !== SAVE_FORMAT_VERSION) {
		console.error("Unsupported or missing plan format version.");
		return { ok: false, message: "This file isn't a plan saved by this version of the planner." };
	}
	clearHistory();
	return batched(async () => {
		if (data.styleFile && data.styleFile !== activeStyleFile && STYLE_FILES.some((s) => s.file === data.styleFile)) {
			await applyStyle(data.styleFile);
		}
		// Validated before anything is cleared.
		const plan = sanitizeForBoard(data);
		loadPlanContents(plan);
		const background = await resolveBackgroundForRestore(data.background || null, backgroundKey);
		await restoreWorldBackgroundFromSaved(background);
		return { ok: true, skippedBuildings: plan.skippedBuildings };
	});
}

// Restores the autosaved plan, if there is one.
export async function restoreAutosave() {
	const raw = readStored(AUTOSAVE_STORAGE_KEY);
	if (!raw) return;
	try {
		await applyPlanData(JSON.parse(raw), { backgroundKey: AUTOSAVE_BG_KEY });
	} catch (error) {
		console.error("Failed to restore autosave", error);
	}
}

function downloadPlanAsJSON() {
	const json = JSON.stringify(serializePlan({ includeBackground: true }), null, 2);
	const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = `minecolonies-plan-${Date.now()}.json`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importPlanFile(file) {
	let data;
	try {
		data = JSON.parse(await file.text());
	} catch (error) {
		console.error("Failed to read plan file.", error);
		window.alert(`Couldn't import "${file.name}" - it isn't valid JSON.`);
		return;
	}
	const result = await applyPlanData(data);
	if (!result.ok) {
		window.alert(`Couldn't import "${file.name}": ${result.message}`);
	} else if (result.skippedBuildings) {
		const n = result.skippedBuildings;
		window.alert(
			`Imported "${file.name}", but skipped ${n} building${n === 1 ? "" : "s"} that ${n === 1 ? "was" : "were"} malformed or off the grid.`,
		);
	}
}

function clearBoard() {
	if (!placedSquares.length && !paths.length) return; // nothing to clear - don't ask
	const b = placedSquares.length;
	const r = paths.length;
	const confirmed = window.confirm(
		`Clear the board? This removes all ${b} building${b === 1 ? "" : "s"} and ${r} road${r === 1 ? "" : "s"} - undo will still work if you change your mind.`,
	);
	if (!confirmed) return;
	pushUndoState();
	clearPlan();
}

export function initPersistence() {
	on("plan-changed", scheduleAutoSave);

	clearBoardButton.addEventListener("click", clearBoard);
	exportJsonButton.addEventListener("click", downloadPlanAsJSON);
	exportPngButton.addEventListener("click", exportPlanAsPNG);
	importJsonTriggerButton.addEventListener("click", () => importJsonInput.click());
	importJsonInput.addEventListener("change", () => {
		const file = importJsonInput.files?.[0];
		// Cleared so choosing the same file again still fires "change".
		importJsonInput.value = "";
		if (file) importPlanFile(file);
	});
}
