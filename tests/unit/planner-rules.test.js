// Pure planner logic: the Plan Check rules, material names, and event batching.

const test = require("node:test");
const assert = require("node:assert/strict");

const { computeCommuteChecks, computePlanChecks, computePopulation, getHutPoints } = require("../../planner/plan-check-rules.js");
const { formatMaterialName, getMaterialBaseId, getMaterialShapeClass } = require("../../planner/materials.js");
const events = require("../../planner/events.js");

const named = (...labels) => labels.map((label) => ({ label }));
const statusOf = (items, title) => items.find((item) => item.title === title)?.status;

test("plan check: every essential is flagged until present", () => {
	const empty = computePlanChecks([]);
	assert.ok(empty.essentials.every((item) => item.status === "warn"));
	assert.deepEqual(empty.ratios, [], "no ratios without housing");

	const { essentials } = computePlanChecks(named("Town Hall", "Builder's Hut", "Warehouse", "Residence", "Bakery"));
	assert.ok(essentials.every((item) => item.status === "ok"), JSON.stringify(essentials));
});

test("plan check: guard and food ratios scale with housing", () => {
	const housing = named("Residence", "Residence", "Residence", "Residence");
	const noGuards = computePlanChecks(housing).ratios;
	assert.equal(statusOf(noGuards, "No guard buildings yet"), "warn");

	const tooFew = computePlanChecks([...housing, ...named("Guard Tower", "Farmer")]).ratios;
	assert.equal(statusOf(tooFew, "1 guard building for 4 housing buildings"), "warn");
	assert.equal(statusOf(tooFew, "1 food building for 4 housing buildings"), "warn");

	const enough = computePlanChecks([...housing, ...named("Guard Tower", "Barracks", "Farmer", "Fisherman")]).ratios;
	assert.equal(statusOf(enough, "2 guard buildings for 4 housing buildings"), "ok");
	assert.equal(statusOf(enough, "2 food buildings for 4 housing buildings"), "ok");
});

test("population: beds at max level, and the research its total needs", () => {
	assert.deepEqual(computePopulation(named("Town Hall", "Guard Tower")).items.map((item) => item.title), [
		"Up to 1 colonist",
	]);
	assert.equal(computePopulation(named("Town Hall")).items.length, 0);

	const small = computePopulation(named("Residence", "Alt Residence", "Tavern", "Guard Tower", "Guard Tower"));
	assert.equal(small.maxColonists, 5 * 2 + 4 + 2);
	assert.deepEqual(small.items.map((item) => item.status), ["info"], "25 or fewer needs no research");
	assert.match(small.items[0].detail, /2 × Residence \(5\) \+ 1 × Tavern \(4\) \+ 2 × Guard Tower \(1\)/);

	const big = computePopulation(named(...Array(10).fill("Residence"), "Barracks"));
	assert.equal(big.maxColonists, 70);
	assert.equal(big.items[1].title, "Needs the Hamlet research");

	const huge = computePopulation(named(...Array(120).fill("Residence")));
	assert.equal(huge.items[1].title, "Needs the City research");
	assert.match(huge.items[1].detail, /Even City caps it at 500/);
});

test("a decoration plot marker isn't counted as the building it marks", () => {
	const plot = [{ label: "Barracks Plot", category: "decoration" }];
	assert.equal(computePopulation(plot).maxColonists, 0);
	assert.equal(computePlanChecks([...named("Residence"), ...plot]).ratios[0].title, "No guard buildings yet");
});

test("commute check: warns for workplaces over 160 blocks from the nearest housing", () => {
	const at = (label, category, x, y = 0) => ({ label, category, x, y, w: 10, h: 10 });
	const home = at("Residence", "fundamentals", 0);

	assert.deepEqual(computeCommuteChecks([at("Farmer", "farming", 0)]), [], "nothing to compare without housing");

	const near = computeCommuteChecks([home, at("Farmer", "farming", 160), at("Town Hall", "fundamentals", 500)]);
	assert.deepEqual(
		near.map((item) => [item.status, item.title]),
		[["ok", "1 workplace near housing"]],
		"exactly 160 is fine; the Town Hall has no worker",
	);

	const far = computeCommuteChecks([
		home,
		at("Residence", "fundamentals", 1000),
		at("Fisherman", "farming", 200),
		at("Baker", "craftsmanship", 0, 300),
		at("Guard Tower", "military", 400),
		at("Small Well", "decoration", 400),
	]);
	assert.deepEqual(
		far.map((item) => [item.status, item.title]),
		[
			["warn", "Baker is 300 blocks from housing"],
			["warn", "Fisherman is 200 blocks from housing"],
		],
		"sorted farthest first; guards and decorations are skipped",
	);
});

test("hut points turn with the building, and with a catalog footprint that's the blueprint turned", () => {
	// A 4x2 blueprint with its hut at block (0, 1): the bottom-left corner.
	const huts = { size_x: 4, size_z: 2, blocks: [{ x: 0, z: 1 }] };
	const at = (rotation, w, h) => getHutPoints({ huts, x: 100, y: 50, w, h, rotation });
	assert.deepEqual(at(0, 4, 2), [{ x: 100.5, y: 51.5 }]);
	assert.deepEqual(at(1, 2, 4), [{ x: 100.5, y: 50.5 }], "a quarter turn clockwise brings it to the top-left");
	assert.deepEqual(at(2, 4, 2), [{ x: 103.5, y: 50.5 }]);
	assert.deepEqual(at(3, 2, 4), [{ x: 101.5, y: 53.5 }]);
	// A catalog footprint listed as 2x4 is drawn as the blueprint turned once.
	assert.deepEqual(at(0, 2, 4), at(1, 2, 4));
	assert.deepEqual(
		getHutPoints({ x: 10, y: 20, w: 6, h: 4 }),
		[{ x: 13, y: 22 }],
		"no hut data falls back to the footprint's center",
	);
});

test("commute check measures hut to hut, and counts a multi-hut plot's farthest hut", () => {
	const hutAt = (hx, hz) => ({ size_x: 100, size_z: 10, blocks: [{ x: hx, z: hz }] });
	const home = { label: "Residence", category: "fundamentals", x: 0, y: 0, w: 100, h: 10, huts: hutAt(0, 0) };
	// The footprints' centers are 150 apart, but the huts are at opposite ends.
	const farmer = { label: "Farmer", category: "farming", x: 150, y: 0, w: 100, h: 10, huts: hutAt(99, 0) };
	assert.deepEqual(computeCommuteChecks([home, farmer]).map((item) => item.title), ["Farmer is 249 blocks from housing"]);

	const plot = {
		...farmer,
		label: "University Full",
		category: "education",
		x: 0,
		y: 20,
		huts: { size_x: 100, size_z: 10, blocks: [{ x: 0, z: 0 }, { x: 99, z: 0 }, { x: 99, z: 9 }] },
	};
	assert.deepEqual(computeCommuteChecks([home, plot]).map((item) => item.status), ["ok"]);
	plot.x = 100;
	assert.deepEqual(computeCommuteChecks([home, plot]).map((item) => item.title), ["University Full is 201 blocks from housing"]);
});

test("material names: plain ids, overrides, and Domum Ornamentum ingredient lists", () => {
	assert.equal(formatMaterialName("minecraft:oak_planks"), "Oak Planks");
	assert.equal(formatMaterialName("domum_ornamentum:blockpaperwall"), "Framed Pane");
	assert.equal(
		formatMaterialName("domum_ornamentum:plain@@minecraft:cobblestone,minecraft:spruce_planks"),
		"Cobblestone and Spruce Planks Plain Timber Frame",
	);
	assert.equal(
		formatMaterialName("domum_ornamentum:plain@@minecraft:a,minecraft:b,minecraft:c"),
		"A, B, and C Plain Timber Frame",
	);
	assert.equal(formatMaterialName("toString"), "ToString", "not resolved through Object.prototype");
	assert.equal(getMaterialBaseId("x:y@@a,b"), "x:y");
});

test("material silhouettes follow the block's shape suffix", () => {
	assert.equal(getMaterialShapeClass("minecraft:oak_fence_gate"), "material-shape--fence");
	assert.equal(getMaterialShapeClass("minecraft:stone_brick_stairs@@x"), "material-shape--stairs");
	assert.equal(getMaterialShapeClass("minecraft:stone"), "");
});

test("batched() collapses plan-changed into one event, and drops it on failure", async () => {
	let count = 0;
	events.on("plan-changed", () => count++);
	await events.batched(async () => {
		events.emit("plan-changed");
		await Promise.resolve();
		events.emit("plan-changed");
	});
	assert.equal(count, 1);

	await assert.rejects(
		events.batched(() => {
			events.emit("plan-changed");
			throw new Error("half-loaded");
		}),
	);
	assert.equal(count, 1, "a failed batch must not announce its partial changes");

	events.emit("plan-changed");
	assert.equal(count, 2, "outside a batch, events go straight through");
});
