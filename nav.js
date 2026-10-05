// Shared top nav bar + theme toggle, used by both index.html (planner) and
// colony-inspector.html. Keeping this in one file means the two pages can't
// drift out of sync on nav links or theme-toggle behavior.

const THEME_STORAGE_KEY = "minecolonies.theme";

// shortcutGroups is optional: an array of { title, items: [{ combo, description }] }
// where combo is an array of key labels (e.g. ["Ctrl", "Z"]) rendered as
// separate <kbd> tags. Pages with nothing to document (World Viewer, Colony
// Inspector, Debug - none of them have keyboard shortcuts today) just omit
// it and the "?" button/modal don't appear at all, rather than showing an
// empty "no shortcuts here" state.
function initNavBar(activePage, shortcutGroups) {
	const nav = document.createElement("nav");
	nav.className = "app-nav";
	nav.innerHTML = `
		<a class="app-nav__brand" href="index.html">
			<span class="app-nav__logo" aria-hidden="true">${window.MCIcons.getIconSvg("⛏️", { size: 20 })}</span>
			<span class="app-nav__title">MineColonies Planner</span>
		</a>
		<div class="app-nav__links">
			<a class="app-nav__link" data-nav="planner" href="index.html">Planner</a>
			<a class="app-nav__link" data-nav="inspector" href="colony-inspector.html">Colony Inspector</a>
			<a class="app-nav__link" data-nav="world-viewer" href="world-viewer.html">World Viewer</a>
			<a class="app-nav__link" data-nav="debug" href="debug.html">Debug</a>
		</div>
		<button type="button" class="app-nav__shortcuts-toggle" data-shortcuts-toggle hidden aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
		<button type="button" class="app-nav__theme-toggle" data-theme-toggle aria-label="Toggle light/dark theme">${window.MCIcons.getIconSvg("🌙", { size: 18 })}</button>
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
		themeToggleButton.innerHTML = window.MCIcons.getIconSvg(
			resolved === "light" ? "🌙" : "☀️",
			{ size: 18 },
		);
		themeToggleButton.setAttribute(
			"aria-label",
			resolved === "light" ? "Switch to dark theme" : "Switch to light theme",
		);
		if (!persist) return;
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
		} catch {
			// localStorage may be unavailable in some contexts.
		}
	}

	themeToggleButton.addEventListener("click", () => {
		const current =
			document.documentElement.getAttribute("data-theme") === "light"
				? "light"
				: "dark";
		applyTheme(current === "light" ? "dark" : "light");
	});

	try {
		const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
		if (savedTheme === "light" || savedTheme === "dark") {
			applyTheme(savedTheme, false);
		} else {
			const prefersLight = window.matchMedia?.(
				"(prefers-color-scheme: light)",
			).matches;
			applyTheme(prefersLight ? "light" : "dark", false);
		}
	} catch {
		applyTheme("dark", false);
	}

	if (Array.isArray(shortcutGroups) && shortcutGroups.length) {
		initShortcutsModal(nav, shortcutGroups);
	}

	return nav;
}

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

	function openModal() {
		overlay.hidden = false;
	}
	function closeModal() {
		overlay.hidden = true;
	}

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
		if (event.key !== "?") return;
		const target = event.target;
		const isEditable =
			target &&
			(target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable);
		if (isEditable) return;
		event.preventDefault();
		overlay.hidden ? openModal() : closeModal();
	});
}

window.initNavBar = initNavBar;
