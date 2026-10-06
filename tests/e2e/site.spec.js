// Site-wide checks: every page boots cleanly, plus the shared nav bar, theme
// toggle and keyboard-shortcuts modal from nav.js.

const { test, expect } = require("./fixtures");

const PAGES = [
	{ path: "/index.html", nav: "planner", title: "MineColonies Planner", root: "#root .grid" },
	{ path: "/colony-inspector.html", nav: "inspector", title: "Colony Inspector — MineColonies Planner", root: "#inspector-root .inspector-intro" },
	{ path: "/world-viewer.html", nav: "world-viewer", title: "World Viewer — MineColonies Planner", root: "#world-viewer-root .inspector-intro" },
	{ path: "/debug.html", nav: "debug", title: "Debug — MineColonies Planner", root: "#debug-root .debug-section" },
];

for (const p of PAGES) {
	test.describe(p.path, () => {
		test("loads without errors and marks its nav link active", async ({ page }) => {
			await page.goto(p.path);
			await expect(page).toHaveTitle(p.title);
			await expect(page.locator(p.root).first()).toBeVisible();
			const nav = page.locator(".app-nav");
			await expect(nav).toHaveCount(1);
			const active = nav.locator(".app-nav__link.is-active");
			await expect(active).toHaveCount(1);
			await expect(active).toHaveAttribute("data-nav", p.nav);
			await expect(active).toHaveAttribute("aria-current", "page");
			// Let async startup work (fetches, autosave restore) finish so its
			// errors, if any, are caught by the pageErrors fixture.
			await page.waitForLoadState("networkidle");
		});
	});
}

// Several components hide themselves with the `hidden` attribute, but any
// CSS rule that sets `display` on the same element silently overrides it.
// This catches that whole class of bug on every page at once (styles.css
// has a global `[hidden] { display: none !important }` guard against it).
const KNOWN_HIDDEN_BUT_SHOWN = {};

for (const p of PAGES) {
	test(`${p.path}: nothing marked [hidden] is actually rendered`, async ({ page }) => {
		await page.goto(p.path);
		await page.waitForLoadState("networkidle");
		const leaks = await page.evaluate(() =>
			[...document.querySelectorAll("[hidden]")]
				.filter((el) => el.checkVisibility())
				.map((el) => {
					const data = [...el.attributes].find((a) => a.name.startsWith("data-"));
					return data ? `[${data.name}]` : `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
				}),
		);
		expect(leaks.sort()).toEqual([...(KNOWN_HIDDEN_BUT_SHOWN[p.path] || [])].sort());
	});
}

test("the root URL serves the planner", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle("MineColonies Planner");
});

test("nav links move between every page", async ({ page }) => {
	await page.goto("/index.html");
	for (const p of [PAGES[1], PAGES[2], PAGES[3], PAGES[0]]) {
		await page.locator(`.app-nav__link[data-nav="${p.nav}"]`).click();
		await expect(page).toHaveURL(new RegExp(`${p.path.replace(".", "\\.")}$`));
		await expect(page.locator(".app-nav__link.is-active")).toHaveAttribute("data-nav", p.nav);
	}
	await page.locator(".app-nav__brand").click();
	await expect(page).toHaveURL(/index\.html$/);
});

test.describe("theme toggle", () => {
	test("defaults to the OS color scheme when nothing is saved", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/debug.html");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

		await page.emulateMedia({ colorScheme: "dark" });
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	});

	test("toggles, updates its label, and persists across pages and reloads", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/debug.html");
		const html = page.locator("html");
		const toggle = page.locator("[data-theme-toggle]");
		await expect(html).toHaveAttribute("data-theme", "dark");
		await expect(toggle).toHaveAttribute("aria-label", "Switch to light theme");

		await toggle.click();
		await expect(html).toHaveAttribute("data-theme", "light");
		await expect(toggle).toHaveAttribute("aria-label", "Switch to dark theme");
		expect(await page.evaluate(() => localStorage.getItem("minecolonies.theme"))).toBe("light");

		await page.goto("/world-viewer.html");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

		await page.locator("[data-theme-toggle]").click();
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	});

	test("panel colors actually change between themes", async ({ page }) => {
		await page.goto("/debug.html");
		const bg = () =>
			page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--panel").trim());
		const first = await bg();
		await page.locator("[data-theme-toggle]").click();
		await expect.poll(bg).not.toBe(first);
	});
});

test.describe("keyboard shortcuts modal", () => {
	test("only appears on pages that document shortcuts", async ({ page }) => {
		await page.goto("/index.html");
		await expect(page.locator("[data-shortcuts-toggle]")).toBeVisible();
		for (const other of ["/colony-inspector.html", "/world-viewer.html", "/debug.html"]) {
			await page.goto(other);
			await expect(page.locator("[data-shortcuts-toggle]")).toBeHidden();
			await expect(page.locator(".shortcuts-modal-overlay")).toHaveCount(0);
		}
	});

	test("opens and closes via button, '?' key, Escape, close button and backdrop", async ({ page }) => {
		await page.goto("/index.html");
		const overlay = page.locator(".shortcuts-modal-overlay");
		await expect(overlay).toBeHidden();

		await page.locator("[data-shortcuts-toggle]").click();
		await expect(overlay).toBeVisible();
		await expect(overlay.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
		await expect(overlay.locator(".shortcuts-modal__group h3")).toHaveText([
			"General",
			"Placing & moving buildings",
			"Roads & Rivers",
			"Top-down renders",
		]);
		await expect(overlay.locator("kbd").first()).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(overlay).toBeHidden();

		await page.keyboard.press("?");
		await expect(overlay).toBeVisible();
		await page.keyboard.press("?");
		await expect(overlay).toBeHidden();

		await page.keyboard.press("?");
		await page.locator("[data-shortcuts-close]").click();
		await expect(overlay).toBeHidden();

		await page.keyboard.press("?");
		await overlay.click({ position: { x: 5, y: 5 } });
		await expect(overlay).toBeHidden();
	});

	test("typing '?' into a text field does not open it", async ({ page }) => {
		await page.goto("/index.html");
		const search = page.locator(".shape-search-input");
		await search.click();
		await page.keyboard.type("?");
		await expect(search).toHaveValue("?");
		await expect(page.locator(".shortcuts-modal-overlay")).toBeHidden();
	});
});

test("pages stay usable at a small laptop size", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	for (const p of PAGES) {
		await page.goto(p.path);
		await expect(page.locator(".app-nav")).toBeVisible();
		await expect(page.locator(p.root).first()).toBeVisible();
	}
});
