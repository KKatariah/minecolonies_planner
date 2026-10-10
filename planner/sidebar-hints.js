// Hover tooltips for the left pane's settings: a row with a data-hint
// attribute shows its description in the purple item tooltip while it's
// hovered or focused, instead of a paragraph under every checkbox. The
// tooltip is fixed to the page rather than nested in the row, since the
// pane scrolls and would clip it.

import { leftSidebar } from "./layout.js";

const GAP = 8;

export function initSidebarHints() {
	const tooltip = document.createElement("div");
	tooltip.className = "sidebar-tooltip";
	tooltip.id = "sidebar-tooltip";
	tooltip.setAttribute("role", "tooltip");
	tooltip.hidden = true;
	document.body.appendChild(tooltip);

	let current = null;

	const show = (row) => {
		current = row;
		tooltip.textContent = row.dataset.hint;
		tooltip.hidden = false;
		// Beside the pane, level with the row; below the row when there's no
		// room beside it (the pane is full-width on phones).
		const rowRect = row.getBoundingClientRect();
		const paneRight = leftSidebar.getBoundingClientRect().right;
		const { width, height } = tooltip.getBoundingClientRect();
		let left = paneRight + GAP;
		let top = rowRect.top;
		if (left + width > window.innerWidth - GAP) {
			left = rowRect.left;
			top = rowRect.bottom + GAP;
		}
		left = Math.max(GAP, Math.min(left, window.innerWidth - width - GAP));
		top = Math.max(GAP, Math.min(top, window.innerHeight - height - GAP));
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
	};
	const hide = (row) => {
		if (row !== current) return;
		current = null;
		tooltip.hidden = true;
	};

	for (const row of leftSidebar.querySelectorAll("[data-hint]")) {
		row.querySelector("input")?.setAttribute("aria-describedby", tooltip.id);
		row.addEventListener("pointerenter", () => show(row));
		row.addEventListener("pointerleave", () => hide(row));
		row.addEventListener("focusin", () => show(row));
		row.addEventListener("focusout", () => hide(row));
	}
	// A scrolled or collapsed pane would leave it floating by nothing.
	leftSidebar.addEventListener("scroll", () => current && hide(current), { passive: true });
}
