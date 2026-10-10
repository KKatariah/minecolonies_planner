// "My Plans": named saves kept in this browser. The plans are in
// localStorage; their background images are in IndexedDB (background-store.js).

import { deleteBackground, namedPlanBgKey } from "./background-store.js";
import { namedPlansEmptyEl, namedPlansListEl, planNameInput, saveNamedPlanButton } from "./layout.js";
import { applyPlanData } from "./persistence.js";
import { serializePlan } from "./plan-state.js";
import { getWorldBackgroundSaveDataLocal } from "./world-background.js";
import { readStored, writeStored } from "../lib/storage.js";

const NAMED_PLANS_STORAGE_KEY = "minecolonies.namedPlans.v1";

// name -> { plan, savedAt }. A null-prototype object: names are user-typed,
// and a plan named "__proto__" on a plain object would silently replace the
// object's prototype instead of being stored.
export function loadNamedPlans() {
	try {
		const parsed = JSON.parse(readStored(NAMED_PLANS_STORAGE_KEY));
		return Object.assign(Object.create(null), typeof parsed === "object" && parsed ? parsed : null);
	} catch {
		return Object.create(null);
	}
}

// False if storage is unavailable or full.
function saveNamedPlans(plans) {
	return writeStored(NAMED_PLANS_STORAGE_KEY, JSON.stringify(plans));
}

// Resolves to whether the plan was saved.
async function saveCurrentPlanAs(name) {
	const trimmed = name.trim();
	if (!trimmed) return false;
	const plans = loadNamedPlans();
	if (plans[trimmed] && !window.confirm(`A plan named "${trimmed}" already exists. Overwrite it?`)) return false;
	const plan = serializePlan();
	plan.background = await getWorldBackgroundSaveDataLocal(namedPlanBgKey(trimmed));
	plans[trimmed] = { plan, savedAt: new Date().toISOString() };
	if (!saveNamedPlans(plans)) {
		window.alert(
			`Couldn't save "${trimmed}" - browser storage is full. Try removing the world background first, or delete an older saved plan to free up space.`,
		);
		return false;
	}
	renderNamedPlansList();
	return true;
}

async function loadNamedPlan(name) {
	const entry = loadNamedPlans()[name];
	if (entry) await applyPlanData(entry.plan, { backgroundKey: namedPlanBgKey(name) });
}

function deleteNamedPlan(name) {
	if (!window.confirm(`Delete the saved plan "${name}"?`)) return;
	const plans = loadNamedPlans();
	delete plans[name];
	saveNamedPlans(plans);
	// Best effort: a leftover image is harmless, just unreachable.
	deleteBackground(namedPlanBgKey(name)).catch(() => {});
	renderNamedPlansList();
}

function button(label, className, onClick) {
	const el = document.createElement("button");
	el.type = "button";
	el.className = className;
	el.textContent = label;
	el.addEventListener("click", onClick);
	return el;
}

// Newest first.
function renderNamedPlansList() {
	const plans = loadNamedPlans();
	const names = Object.keys(plans).sort((a, b) => (plans[b].savedAt || "").localeCompare(plans[a].savedAt || ""));
	namedPlansListEl.querySelectorAll(".left-sidebar__plan-row").forEach((row) => row.remove());
	namedPlansEmptyEl.style.display = names.length ? "none" : "block";
	for (const name of names) {
		const row = document.createElement("div");
		row.className = "left-sidebar__plan-row";
		const nameSpan = document.createElement("span");
		nameSpan.className = "left-sidebar__plan-name";
		nameSpan.textContent = name;
		nameSpan.title = name;
		row.append(
			nameSpan,
			button("Load", "left-sidebar__plan-action", () => loadNamedPlan(name)),
			button("Delete", "left-sidebar__plan-action left-sidebar__plan-action--danger", () => deleteNamedPlan(name)),
		);
		namedPlansListEl.appendChild(row);
	}
}

export function initNamedPlans() {
	// The name box is only cleared once the save succeeds, so a cancelled
	// overwrite or a full storage error keeps what was typed.
	const save = async () => {
		if (await saveCurrentPlanAs(planNameInput.value)) planNameInput.value = "";
	};
	saveNamedPlanButton.addEventListener("click", save);
	planNameInput.addEventListener("keydown", (event) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		save();
	});
	renderNamedPlansList();
}
