// The secondary pages: Colony Inspector, World Viewer and Debug.

const zlib = require("zlib");
const { test, expect } = require("./fixtures");
const W = require("../helpers/nbt-writer.js");
const { makeChunkNbt, buildRegion } = require("../helpers/region-builder.js");

const XSS = `<img src=x onerror="window.__xss=1">`;

function citizen({ id, name, female = 0, job, saturation = 12.5 }) {
	const entries = [
		["id", W.int(id)],
		["name", W.str(name)],
		["female", W.byte(female)],
		["saturation", W.double(saturation)],
		["newSkills", W.compound({
			levelMap: W.list(W.TAG.Compound, [
				[["skill", W.int(0)], ["level", W.int(7)]],
				[["skill", W.int(3)], ["level", W.int(2)]],
			]),
		})],
	];
	if (job) entries.push(["job", W.compound({ type: W.str(job) })]);
	return entries;
}

function colony({ id = 1, name = "Testville", citizens = [], buildings = [] } = {}) {
	return W.compound({
		id: W.int(id),
		name: W.str(name),
		dimension: W.str("minecraft:overworld"),
		pack: W.str("Caledonia"),
		teamcolor: W.int(4),
		colonyday: W.int(42),
		citizenManager: W.compound({ citizens: W.list(W.TAG.Compound, citizens.map(citizen)) }),
		buildingManager: W.compound({
			buildings: W.list(W.TAG.Compound, buildings.map((b) => [
				["type", W.str(b.type)],
				["level", W.int(b.level)],
				["residents", W.intArray(b.residents || [])],
			])),
		}),
	});
}

const datFile = (rootCompound, name = "colony1.dat", gzip = true) => {
	const raw = Buffer.from(W.encodeNbt(rootCompound));
	return { name, mimeType: "application/octet-stream", buffer: gzip ? zlib.gzipSync(raw) : raw };
};

test.describe("Colony Inspector", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/colony-inspector.html");
	});

	test("the example colony loads and renders every section", async ({ page }) => {
		await page.locator("[data-load-sample]").click();
		await expect(page.locator("[data-status]")).toHaveText("Loaded example-colony.dat");
		const results = page.locator("[data-results]");
		await expect(results).toBeVisible();
		await expect(results.locator(".inspector-card__title")).not.toBeEmpty();
		await expect(results.locator(".inspector-stat-tile")).not.toHaveCount(0);
		await expect(results.locator(".inspector-section__title").first()).toContainText("Citizens");
		await expect(results.locator(".inspector-raw summary")).toHaveText("Raw parsed data (example-colony.dat)");
	});

	test("an uploaded colony file shows stats, citizens, skills, homes and buildings", async ({ page }) => {
		await page.locator("[data-file-input]").setInputFiles(datFile(colony({
			citizens: [
				{ id: 1, name: "Alice", female: 1, job: "minecolonies:baker" },
				{ id: 2, name: "Bob", job: "minecolonies:baker" },
				{ id: 3, name: "Cleo" },
			],
			buildings: [
				{ type: "minecolonies:residence", level: 2, residents: [1, 2] },
				{ type: "minecolonies:bakery", level: 1 },
			],
		})));
		await expect(page.locator("[data-status]")).toHaveText("Loaded colony1.dat");
		const tiles = page.locator(".inspector-stat-tile");
		await expect(tiles.filter({ hasText: "Colony ID" })).toContainText("1");
		await expect(tiles.filter({ hasText: "Citizens" })).toContainText("3");
		await expect(tiles.filter({ hasText: "Buildings" })).toContainText("2");
		await expect(tiles.filter({ hasText: "Colony day" })).toContainText("42");
		await expect(tiles.filter({ hasText: "Team color" })).toBeVisible();
		await expect(page.locator(".inspector-chip-row").first()).toContainText("Baker: 2");
		await expect(page.locator(".inspector-chip-row").first()).toContainText("Unemployed: 1");

		const cards = page.locator(".inspector-citizen-card");
		await expect(cards).toHaveCount(3);
		const alice = cards.filter({ hasText: "Alice" });
		await expect(alice).toContainText("Baker");
		await expect(alice.locator(".inspector-skill").first()).toContainText("7");
		await expect(alice).toContainText("Residence Lv2");
		await expect(alice.locator(".inspector-meter-row", { hasText: "Saturation" })).toContainText("12.5/20");
		await expect(cards.filter({ hasText: "Cleo" })).toContainText("Unemployed");

		const rows = page.locator(".inspector-table tbody tr");
		await expect(rows).toHaveCount(2);
		await expect(rows.first()).toContainText("Bakery");
	});

	test("a multi-colony file shows a picker that switches colonies", async ({ page }) => {
		const root = W.compound({
			colonies: W.list(W.TAG.Compound, [
				colony({ id: 1, name: "North", citizens: [{ id: 1, name: "Nia" }] }).value,
				colony({ id: 2, name: "South", citizens: [{ id: 1, name: "Sam" }, { id: 2, name: "Sol" }] }).value,
			]),
		});
		await page.locator("[data-file-input]").setInputFiles(datFile(root));
		const select = page.locator(".inspector-picker__select");
		await expect(page.locator(".inspector-picker__label")).toContainText("2 colonies found");
		await expect(page.locator(".inspector-card__title")).toHaveText("North");
		await select.selectOption({ index: 1 });
		await expect(page.locator(".inspector-card__title")).toHaveText("South");
		await expect(page.locator(".inspector-citizen-card")).toHaveCount(2);
	});

	test("uncompressed NBT files work too", async ({ page }) => {
		await page.locator("[data-file-input]").setInputFiles(datFile(colony({ name: "Raw" }), "colony9.dat", false));
		await expect(page.locator(".inspector-card__title")).toHaveText("Raw");
		await expect(page.locator(".inspector-section").first()).toContainText("No citizens found");
	});

	test("colonies.dat and unrecognized files explain themselves and still show raw data", async ({ page }) => {
		await page.locator("[data-file-input]").setInputFiles(datFile(W.compound({ compatabilityManager: W.compound({}) }), "colonies.dat"));
		await expect(page.locator(".inspector-notice")).toContainText("top-level colonies.dat");
		await expect(page.locator(".inspector-raw")).toBeVisible();

		await page.locator("[data-file-input]").setInputFiles(datFile(W.compound({ something: W.str("else") }), "other.dat"));
		await expect(page.locator(".inspector-notice")).toContainText("Couldn't recognize");
		await expect(page.locator(".inspector-raw")).toContainText("something");
	});

	test("garbage input reports a parse error", async ({ page }) => {
		await page.locator("[data-file-input]").setInputFiles({ name: "junk.dat", mimeType: "application/octet-stream", buffer: Buffer.from("hello world") });
		await expect(page.locator("[data-status]")).toContainText("Couldn't parse junk.dat");
		await expect(page.locator("[data-results]")).toBeHidden();
	});

	test("hostile strings in a save file are shown as text, never executed", async ({ page }) => {
		const root = W.compound([
			["id", W.int(1)],
			["name", W.str(XSS)],
			["dimension", W.str(XSS)],
			["pack", W.str(XSS)],
			["citizenManager", W.compound({ citizens: W.list(W.TAG.Compound, [citizen({ id: 1, name: XSS, job: XSS })]) })],
			["buildingManager", W.compound({ buildings: W.list(W.TAG.Compound, [[["type", W.str(XSS)], ["level", W.str(XSS)]]]) })],
			[XSS, W.str(XSS)],
			["__proto__", W.compound({ polluted: W.byte(1) })],
		]);
		await page.locator("[data-file-input]").setInputFiles(datFile(root));
		await expect(page.locator(".inspector-card__title")).toHaveText(XSS);
		await page.locator(".inspector-raw summary").click();
		await expect(page.locator(".inspector-raw")).toContainText("__proto__");
		await page.waitForTimeout(200);
		expect(await page.evaluate(() => window.__xss)).toBeUndefined();
		expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
		await expect(page.locator("[data-results] img")).toHaveCount(0);
	});

	test("huge compounds are truncated in the raw view", async ({ page }) => {
		const entries = Array.from({ length: 450 }, (_, i) => [`k${i}`, W.byte(1)]);
		await page.locator("[data-file-input]").setInputFiles(datFile(W.compound(entries)));
		await expect(page.locator(".inspector-raw__truncated")).toHaveText("…and 250 more");
	});
});

test.describe("World Viewer", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/world-viewer.html");
	});

	test("the example area renders a map with a biome legend", async ({ page }) => {
		await page.locator("[data-load-sample]").click();
		await expect(page.locator("[data-status]")).toContainText(/Loaded [\d,]+ chunks from 1 file\./, { timeout: 30_000 });
		await expect(page.locator("[data-results]")).toBeVisible();
		const size = await page.locator("[data-canvas]").evaluate((c) => [c.width, c.height]);
		expect(size[0]).toBeGreaterThan(0);
		expect(size[1]).toBeGreaterThan(0);
		await expect(page.locator(".world-viewer-legend__item")).not.toHaveCount(0);
	});

	// buildTerrainImage silently falls back to the main thread if the worker
	// can't start, which would still render correctly - so check it directly.
	test("region parsing runs in a Web Worker, not on the page", async ({ page }) => {
		const workers = [];
		page.on("worker", (worker) => workers.push(new URL(worker.url()).pathname));
		await page.locator("[data-load-sample]").click();
		await expect(page.locator("[data-results]")).toBeVisible({ timeout: 30_000 });
		expect(workers).toEqual(["/lib/terrain-worker.js"]);
	});

	test("hovering the map shows a biome tooltip", async ({ page }) => {
		await page.locator("[data-load-sample]").click();
		await expect(page.locator("[data-results]")).toBeVisible({ timeout: 30_000 });
		const box = await page.locator("[data-canvas]").boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await expect(page.locator("[data-tooltip]")).toBeVisible();
		await expect(page.locator("[data-tooltip]")).toContainText(/block \(-?\d+, -?\d+\) · y=-?\d+/);
	});

	test("zoom buttons, fit-to-view and go-to coordinates", async ({ page }) => {
		await page.locator("[data-load-sample]").click();
		await expect(page.locator("[data-results]")).toBeVisible({ timeout: 30_000 });
		const zoom = () => page.evaluate(() => window.__worldViewer.viewZoom);
		const fitted = await zoom();
		await page.locator("[data-zoom-in]").click();
		expect(await zoom()).toBeGreaterThan(fitted);
		await page.locator("[data-zoom-out]").click();
		await page.locator("[data-zoom-out]").click();
		expect(await zoom()).toBeLessThan(fitted);
		await page.locator("[data-zoom-reset]").click();
		expect(await zoom()).toBeCloseTo(fitted);

		await page.locator("[data-goto-x]").fill("100");
		await page.locator("[data-goto-z]").fill("100");
		await page.locator("[data-goto-form] button").click();
		await expect(page.locator("[data-status]")).toHaveText("Centered on (100, 100).");
		await page.locator("[data-goto-x]").fill("99999");
		await page.locator("[data-goto-form] button").click();
		await expect(page.locator("[data-status]")).toContainText("no data there");
	});

	test("dragging pans the map", async ({ page }) => {
		await page.locator("[data-load-sample]").click();
		await expect(page.locator("[data-results]")).toBeVisible({ timeout: 30_000 });
		const before = await page.evaluate(() => [window.__worldViewer.viewPanX, window.__worldViewer.viewPanY]);
		const box = await page.locator("[data-viewport]").boundingBox();
		await page.mouse.move(box.x + 200, box.y + 200);
		await page.mouse.down();
		await page.mouse.move(box.x + 300, box.y + 260, { steps: 5 });
		await page.mouse.up();
		const after = await page.evaluate(() => [window.__worldViewer.viewPanX, window.__worldViewer.viewPanY]);
		expect(after[0] - before[0]).toBeCloseTo(100, 0);
		expect(after[1] - before[1]).toBeCloseTo(60, 0);
	});

	test("multiple adjacent region files render together", async ({ page }) => {
		const files = [
			{ name: "r.0.0.mca", mimeType: "application/octet-stream", buffer: buildRegion([{ cx: 31, cz: 0, nbt: makeChunkNbt({ biome: "minecraft:desert" }) }]) },
			{ name: "r.1.0.mca", mimeType: "application/octet-stream", buffer: buildRegion([{ cx: 0, cz: 0, nbt: makeChunkNbt({ biome: "minecraft:forest" }) }]) },
		];
		await page.locator("[data-file-input]").setInputFiles(files);
		await expect(page.locator("[data-status]")).toHaveText("Loaded 2 chunks from 2 files.", { timeout: 30_000 });
		await expect(page.locator(".world-viewer-legend__item")).toHaveText(["Desert", "Forest"]);
	});

	test("files too far apart are rejected with an explanation", async ({ page }) => {
		const region = buildRegion([{ cx: 0, cz: 0, nbt: makeChunkNbt() }]);
		await page.locator("[data-file-input]").setInputFiles([
			{ name: "r.0.0.mca", mimeType: "application/octet-stream", buffer: region },
			{ name: "r.200.0.mca", mimeType: "application/octet-stream", buffer: region },
		]);
		await expect(page.locator("[data-status]")).toContainText("too far apart");
		await expect(page.locator("[data-results]")).toBeHidden();
	});

	test("a broken file is skipped and reported alongside good ones", async ({ page }) => {
		await page.locator("[data-file-input]").setInputFiles([
			{ name: "r.0.0.mca", mimeType: "application/octet-stream", buffer: buildRegion([{ cx: 0, cz: 0, nbt: makeChunkNbt() }]) },
			{ name: "r.1.0.mca", mimeType: "application/octet-stream", buffer: Buffer.alloc(50) },
		]);
		await expect(page.locator("[data-status]")).toContainText("Loaded 1 chunks from 1 file. Skipped 1:", { timeout: 30_000 });
		await expect(page.locator("[data-status]")).toContainText("too small");
	});

	test("hostile biome names are escaped in the legend and tooltip", async ({ page }) => {
		const evil = `minecraft:x${XSS}`;
		await page.locator("[data-file-input]").setInputFiles({
			name: "r.0.0.mca",
			mimeType: "application/octet-stream",
			buffer: buildRegion([{ cx: 0, cz: 0, nbt: makeChunkNbt({ biome: evil }) }]),
		});
		await expect(page.locator("[data-results]")).toBeVisible({ timeout: 30_000 });
		await expect(page.locator(".world-viewer-legend__item")).toContainText("<img");
		const box = await page.locator("[data-canvas]").boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await expect(page.locator("[data-tooltip]")).toContainText("<img");
		expect(await page.evaluate(() => window.__xss)).toBeUndefined();
		await expect(page.locator("[data-results] img")).toHaveCount(0);
	});
});

test.describe("Debug page", () => {
	test("lists every material icon, all of which load", async ({ page }) => {
		await page.goto("/debug.html");
		const total = await page.evaluate(async () => Object.keys(await (await fetch("images/material-icons.json")).json()).length);
		await expect(page.locator(".debug-material-item")).toHaveCount(total);
		await expect(page.locator("[data-material-count]")).toHaveText(`(${total})`);
		// Force the lazy images to load and check none are broken.
		const broken = await page.locator(".debug-material-item__icon").evaluateAll(async (imgs) => {
			await Promise.all(
				imgs.map((img) => {
					img.loading = "eager";
					return img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; });
				}),
			);
			return imgs.filter((img) => img.naturalWidth === 0).map((img) => img.getAttribute("src"));
		});
		expect(broken).toEqual([]);
	});

	test("the filter narrows the material list", async ({ page }) => {
		await page.goto("/debug.html");
		await expect(page.locator(".debug-material-item").first()).toBeVisible();
		await page.locator("[data-material-filter]").fill("OAK_PLANKS");
		const labels = await page.locator(".debug-material-item__label").allTextContents();
		expect(labels.length).toBeGreaterThan(0);
		expect(labels.every((l) => l.includes("oak_planks"))).toBe(true);
		await expect(page.locator("[data-material-count]")).toHaveText(new RegExp(`^\\(${labels.length} of \\d+\\)$`));
		await page.locator("[data-material-filter]").fill("zzz-nothing");
		await expect(page.locator(".debug-material-item")).toHaveCount(0);
	});

	test("lists every curated biome color", async ({ page }) => {
		await page.goto("/debug.html");
		const count = await page.evaluate(async () => Object.keys((await import("/lib/world-terrain.js")).BIOME_COLORS).length);
		await expect(page.locator(".debug-biome-item")).toHaveCount(count);
		await expect(page.locator("[data-biome-count]")).toHaveText(`(${count})`);
		await expect(page.locator(".debug-biome-item__name", { hasText: /^Plains$/ })).toHaveCount(1);
	});
});
