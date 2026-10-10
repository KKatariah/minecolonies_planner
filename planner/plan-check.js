// The Plan Check section of the left pane, refreshed whenever the plan
// changes. The rules are in plan-check-rules.js. A warning that a building
// would fix can be clicked to arm that building in the tray.

import { escapeHtml } from "../lib/dom.js";
import { getIconSvg } from "../lib/icons.js";
import { placedSquares } from "./buildings.js";
import { shapes } from "./catalog.js";
import { on } from "./events.js";
import { planCheckEl } from "./layout.js";
import { computeCommuteChecks, computePlanChecks, computePopulation } from "./plan-check-rules.js";
import { showShapeInTray } from "./tray.js";

const STATUS_ICONS = { ok: "✅", warn: "⚠️", info: "🏠" };

// A warning with a `fix` is a button: clicking it arms that building in the
// tray (opening its tab), ready to place.
function renderItem(item) {
	const text = `
		<span class="plan-check__icon">${getIconSvg(STATUS_ICONS[item.status], { size: 15 })}</span>
		<span class="plan-check__text">
			<span class="plan-check__title">${escapeHtml(item.title)}</span>
			<span class="plan-check__detail">${escapeHtml(item.detail)}</span>
			${item.fix ? `<span class="plan-check__fix">Click to pick a ${escapeHtml(item.fix)}</span>` : ""}
		</span>
	`;
	const classes = `plan-check__item plan-check__item--${item.status}`;
	return item.fix
		? `<button type="button" class="${classes} plan-check__item--fix" data-plan-check-fix="${escapeHtml(item.fix)}">${text}</button>`
		: `<div class="${classes}">${text}</div>`;
}

function renderGroup(title, items) {
	if (!items.length) return "";
	return `<div class="plan-check__group"><h4 class="plan-check__group-title">${escapeHtml(title)}</h4>${items.map(renderItem).join("")}</div>`;
}

// The active style's shape for a fix label: an exact label match, else the
// first whose label contains it.
function findFixShape(label) {
	const wanted = label.toLowerCase();
	return (
		shapes.find((shape) => (shape.label || "").toLowerCase() === wanted) ||
		shapes.find((shape) => (shape.label || "").toLowerCase().includes(wanted)) ||
		null
	);
}

export function runPlanCheck() {
	if (!placedSquares.length) {
		planCheckEl.innerHTML = `<p class="plan-check__empty">Place some buildings to see plan health checks.</p>`;
		return;
	}
	const { essentials, ratios } = computePlanChecks(placedSquares);
	planCheckEl.innerHTML =
		renderGroup("Essentials", essentials) +
		renderGroup("Population", computePopulation(placedSquares).items) +
		renderGroup("Guards & food", ratios) +
		renderGroup("Commute distance", computeCommuteChecks(placedSquares));
}

export function initPlanCheck() {
	planCheckEl.addEventListener("click", (event) => {
		const button = event.target.closest("[data-plan-check-fix]");
		const shape = button && findFixShape(button.dataset.planCheckFix);
		if (shape) showShapeInTray(shape.id);
	});
	on("plan-changed", runPlanCheck);
	runPlanCheck();
}
