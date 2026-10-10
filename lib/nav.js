// The top nav bar, theme toggle and keyboard-shortcuts modal shared by every
// page, so the pages can't drift apart on links or theme behavior.

import { getIconSvg } from "./icons.js";
import { isEditableTarget } from "./dom.js";
import { readStored, writeStored } from "./storage.js";

const THEME_STORAGE_KEY = "minecolonies.theme";

// activePage: the data-nav id of the current page's link.
// shortcutGroups (optional): [{ title, items: [{ combo: ["Ctrl", "Z"],
// description }] }]. Pages without one get no "?" button or modal.
export function initNavBar(activePage, shortcutGroups) {
	const nav = document.createElement("nav");
	nav.className = "app-nav";
	nav.innerHTML = `
		<a class="app-nav__brand" href="index.html">
			<span class="app-nav__title">MineColonies Planner</span>
		</a>
		<div class="app-nav__links">
			<a class="app-nav__link" data-nav="planner" href="index.html">Planner</a>
			<a class="app-nav__link" data-nav="inspector" href="colony-inspector.html">Colony Inspector</a>
			<a class="app-nav__link" data-nav="world-viewer" href="world-viewer.html">World Viewer</a>
			<a class="app-nav__link" data-nav="debug" href="debug.html">Debug</a>
		</div>
		<button type="button" class="app-nav__shortcuts-toggle" data-shortcuts-toggle hidden aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
		<button type="button" class="app-nav__theme-toggle" data-theme-toggle aria-label="Toggle light/dark theme">${getIconSvg("🌙", { size: 18 })}</button>
	`;
	document.body.prepend(nav);

	const activeLink = nav.querySelector(`[data-nav="${activePage}"]`);
	if (activeLink) {
		activeLink.classList.add("is-active");
		activeLink.setAttribute("aria-current", "page");
	}

	const themeToggleButton = nav.querySelector("[data-theme-toggle]");

	function applyTheme(theme, persist = true) {
		const resolved = theme === "light" ? "light" : "dark";
		document.documentElement.setAttribute("data-theme", resolved);
		// The icon shows the theme a click switches TO.
		themeToggleButton.innerHTML = getIconSvg(resolved === "light" ? "🌙" : "☀️", { size: 18 });
		themeToggleButton.setAttribute(
			"aria-label",
			resolved === "light" ? "Switch to dark theme" : "Switch to light theme",
		);
		if (persist) writeStored(THEME_STORAGE_KEY, resolved);
	}

	themeToggleButton.addEventListener("click", () => {
		const isLight = document.documentElement.getAttribute("data-theme") === "light";
		applyTheme(isLight ? "dark" : "light");
	});

	const savedTheme = readStored(THEME_STORAGE_KEY);
	if (savedTheme === "light" || savedTheme === "dark") {
		applyTheme(savedTheme, false);
	} else {
		const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
		applyTheme(prefersLight ? "light" : "dark", false);
	}

	if (Array.isArray(shortcutGroups) && shortcutGroups.length) {
		initShortcutsModal(nav, shortcutGroups);
	}

	return nav;
}

// shortcutGroups is static text written in this codebase, so it's
// interpolated as HTML (descriptions use entities like ⌘).
function initShortcutsModal(nav, shortcutGroups) {
	const shortcutsButton = nav.querySelector("[data-shortcuts-toggle]");
	shortcutsButton.hidden = false;

	const overlay = document.createElement("div");
	overlay.className = "shortcuts-modal-overlay";
	overlay.hidden = true;
	const groupsHtml = shortcutGroups
		.map(
			(group) => `
				<div class="shortcuts-modal__group">
					<h3>${group.title}</h3>
					<dl>
						${group.items
							.map(
								(item) => `
									<div class="shortcuts-modal__row">
										<dt>${item.combo.map((key) => `<kbd>${key}</kbd>`).join(" + ")}</dt>
										<dd>${item.description}</dd>
									</div>
								`,
							)
							.join("")}
					</dl>
				</div>
			`,
		)
		.join("");
	overlay.innerHTML = `
		<div class="shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
			<div class="shortcuts-modal__header">
				<h2>Keyboard shortcuts</h2>
				<button type="button" class="shortcuts-modal__close" data-shortcuts-close aria-label="Close">&times;</button>
			</div>
			<div class="shortcuts-modal__body">${groupsHtml}</div>
		</div>
	`;
	document.body.appendChild(overlay);

	const openModal = () => {
		overlay.hidden = false;
	};
	const closeModal = () => {
		overlay.hidden = true;
	};

	shortcutsButton.addEventListener("click", openModal);
	overlay.querySelector("[data-shortcuts-close]").addEventListener("click", closeModal);
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) closeModal();
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !overlay.hidden) {
			closeModal();
			return;
		}
		if (event.key !== "?" || isEditableTarget(event.target)) return;
		event.preventDefault();
		if (overlay.hidden) openModal();
		else closeModal();
	});
}
