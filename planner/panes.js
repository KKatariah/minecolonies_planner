// The collapsible left and right panes (remembered across reloads), and the
// --bottom-bar-height CSS variable the layout sizes itself around.

import { readStoredFlag, writeStoredFlag } from "../lib/storage.js";
import { bottomBar, leftSidebar, leftToggleButton, previewSidebar, previewToggleButton } from "./layout.js";

function setUpCollapsiblePane({ pane, button, bodyClass, storageKey, name }) {
	function apply(collapsed, persist) {
		pane.classList.toggle("is-collapsed", collapsed);
		document.body.classList.toggle(bodyClass, collapsed);
		button.setAttribute("aria-expanded", String(!collapsed));
		button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${name}`);
		button.textContent = collapsed ? ">" : "Collapse";
		if (persist) writeStoredFlag(storageKey, collapsed);
	}
	button.addEventListener("click", () => apply(!pane.classList.contains("is-collapsed"), true));
	apply(readStoredFlag(storageKey, false), false);
}

export function initPanes() {
	setUpCollapsiblePane({
		pane: leftSidebar,
		button: leftToggleButton,
		bodyClass: "left-pane-collapsed",
		storageKey: "minecolonies.left.collapsed",
		name: "left pane",
	});
	setUpCollapsiblePane({
		pane: previewSidebar,
		button: previewToggleButton,
		bodyClass: "preview-collapsed",
		storageKey: "minecolonies.preview.collapsed",
		name: "preview pane",
	});

	const updateBottomBarHeight = () => {
		document.documentElement.style.setProperty("--bottom-bar-height", `${bottomBar.offsetHeight}px`);
	};
	updateBottomBarHeight();
	window.addEventListener("resize", updateBottomBarHeight);
	new ResizeObserver(updateBottomBarHeight).observe(bottomBar);
}
