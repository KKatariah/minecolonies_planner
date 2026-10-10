// The Plan Check's rules: essential buildings that are missing, rough
// guard/food-vs-housing ratios, the colonist capacity, and workplaces too
// far from housing. Pure (no DOM), so it's unit-tested directly.
//
// The planner doesn't know building levels, so the real per-colonist numbers
// (bed capacity, 2 guards per 3 citizens... - see
// notes/MINECOLONIES_MECHANICS.md) can't be computed. These are labeled
// rules of thumb based on building counts; an exact version belongs in a
// separate calculator (notes/FEASIBILITY_NOTES.md).
//
// Buildings are matched by label keywords, which works across styles.

import { rotateFootprintPoint } from "./cell-geometry.js";

const FOOD_KEYWORDS = [
	"farmer",
	"fisherman",
	"shepherd",
	"baker",
	"cook",
	"cookery",
	"beekeeper",
	"chicken herder",
	"cowboy",
	"rabbit hutch",
	"swineherder",
	"plantation",
];
const HOUSING_KEYWORDS = ["residence", "tavern"];
const GUARD_KEYWORDS = ["guard tower", "barracks"];

// A citizen whose home is more than this many blocks (straight line, hut
// block to hut block) from their work building complains at bedtime
// (MAX_NO_COMPLAIN_DISTANCE in the mod's CitizenSleepHandler.java).
export const MAX_COMMUTE_DISTANCE = 160;
// Categories whose buildings employ citizens who live elsewhere. Decorations,
// roads and walls have no workers.
const WORKPLACE_CATEGORIES = new Set(["craftsmanship", "education", "farming", "fundamentals", "military", "mystic"]);
// Buildings in those categories that nobody commutes to: housing itself,
// guards (who sleep in their own tower), and huts with no worker.
const NON_WORKPLACE_KEYWORDS = [
	...HOUSING_KEYWORDS,
	...GUARD_KEYWORDS,
	"town hall",
	"warehouse",
	"mystical site",
	"highlander",
];

const ESSENTIAL_BUILDING_CHECKS = [
	{
		keywords: ["town hall"],
		title: "Town Hall",
		detail: "Founds the colony and claims the surrounding chunks.",
		fix: "Town Hall",
	},
	{
		keywords: ["builder"],
		title: "Builder's Hut",
		detail: "Needed to construct or upgrade any other building.",
		fix: "Builder",
	},
	{
		keywords: ["warehouse"],
		title: "Warehouse",
		detail: "Needed for storage and Courier deliveries between buildings.",
		fix: "Warehouse",
	},
	{
		keywords: HOUSING_KEYWORDS,
		title: "Housing",
		detail: "Colonists need a Residence or Tavern bed to live in the colony.",
		fix: "Residence",
	},
	{
		keywords: FOOD_KEYWORDS,
		title: "Food production",
		detail: "At least one food building — colonists starve without one.",
		fix: "Farmer",
	},
];

// Decorations never match: "Barracks Plot" is a plot marker, not a barracks.
function matchesKeywords(building, keywords) {
	if (building.category === "decoration") return false;
	const label = (building.label || "").toLowerCase();
	return keywords.some((keyword) => label.includes(keyword));
}

function countByKeywords(buildings, keywords) {
	return buildings.filter((building) => matchesKeywords(building, keywords)).length;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// buildings: [{ label }]. Returns { essentials, ratios }, each a list of
// { status: "ok" | "warn" | "info", title, detail, fix? }. `fix` on a warning
// is the label of a building that would resolve it, which the Plan Check
// panel offers to arm in the tray.
export function computePlanChecks(buildings) {
	const essentials = ESSENTIAL_BUILDING_CHECKS.map((check) => {
		const present = countByKeywords(buildings, check.keywords) > 0;
		return {
			status: present ? "ok" : "warn",
			title: check.title,
			detail: check.detail,
			...(present ? {} : { fix: check.fix }),
		};
	});

	const housing = countByKeywords(buildings, HOUSING_KEYWORDS);
	const guards = countByKeywords(buildings, GUARD_KEYWORDS);
	const food = countByKeywords(buildings, FOOD_KEYWORDS);
	const ratios = [];
	if (housing > 0) {
		// Roughly one guard building and one food building per 3 housing.
		const recommended = Math.max(1, Math.ceil(housing / 3));
		const forHousing = `for ${plural(housing, "housing building")}`;
		if (guards === 0) {
			ratios.push({
				status: "warn",
				title: "No guard buildings yet",
				detail:
					"MineColonies targets roughly 2 guards per 3 citizens for security and happiness. Consider a Guard Tower or Barracks.",
				fix: "Guard Tower",
			});
		} else if (guards < recommended) {
			ratios.push({
				status: "warn",
				title: `${plural(guards, "guard building")} ${forHousing}`,
				detail: "Rule of thumb: aim for roughly 1 guard building per 3 housing buildings.",
				fix: "Guard Tower",
			});
		} else {
			ratios.push({
				status: "ok",
				title: `${plural(guards, "guard building")} ${forHousing}`,
				detail: "Guard coverage looks reasonable relative to housing.",
			});
		}

		// No food at all is already flagged under essentials.
		if (food > 0 && food < recommended) {
			ratios.push({
				status: "warn",
				title: `${plural(food, "food building")} ${forHousing}`,
				detail:
					"Rule of thumb: aim for roughly 1 food building per 3 housing buildings. Actual throughput also depends on building level and worker skill.",
				fix: "Farmer",
			});
		} else if (food > 0) {
			ratios.push({
				status: "ok",
				title: `${plural(food, "food building")} ${forHousing}`,
				detail: "Food production looks reasonable relative to housing.",
			});
		}
	}
	return { essentials, ratios };
}

// Where a placed building's hut block(s) are on the map, as [{ x, y }] block
// centers. From the blueprint's hut positions (styles/*.json `huts`, made by
// scripts/generate_rooftop_renders.js) turned with the building; falls back
// to the footprint's center for a building without them.
export function getHutPoints(building) {
	const { huts, x, y, w, h } = building;
	if (!huts?.blocks?.length) return [{ x: x + w / 2, y: y + h / 2 }];
	let turns = Number.isInteger(building.rotation) ? building.rotation : building.rotated ? 1 : 0;
	// A footprint that's the blueprint's turned a quarter is drawn with one
	// extra turn (as the top-down render does), so the huts turn with it.
	const odd = turns % 2 === 1;
	if (w !== (odd ? huts.size_z : huts.size_x) || h !== (odd ? huts.size_x : huts.size_z)) turns++;
	return huts.blocks.map((hut) => {
		const point = rotateFootprintPoint({ x: hut.x + 0.5, y: hut.z + 0.5 }, huts.size_x, huts.size_z, turns % 4);
		return { x: x + point.x, y: y + point.y };
	});
}

// buildings: [{ label, category, x, y, w, h, huts?, rotation? }] in blocks.
// For each workplace, the distance to the nearest housing must stay within
// MAX_COMMUTE_DISTANCE for whoever lives there to work there without
// complaining. Returns a list of { status, title, detail }: one warning per
// workplace that's too far, or a single "ok" summary. Empty when there's
// nothing to compare (no housing is already an essentials warning).
//
// Distances are hut block to hut block on the map, as the game measures
// them, except that the planner doesn't know heights. A plot with several
// huts (e.g. University + Library) counts its farthest one, since each hut
// has its own worker.
export function computeCommuteChecks(buildings) {
	const homes = buildings.filter((building) => matchesKeywords(building, HOUSING_KEYWORDS)).flatMap(getHutPoints);
	const workplaces = buildings.filter(
		(building) => WORKPLACE_CATEGORIES.has(building.category) && !matchesKeywords(building, NON_WORKPLACE_KEYWORDS),
	);
	if (!homes.length || !workplaces.length) return [];

	const distanceToNearestHome = (point) =>
		Math.min(...homes.map((home) => Math.hypot(home.x - point.x, home.y - point.y)));
	const tooFar = [];
	for (const workplace of workplaces) {
		const distance = Math.max(...getHutPoints(workplace).map(distanceToNearestHome));
		if (distance > MAX_COMMUTE_DISTANCE) tooFar.push({ label: workplace.label, distance: Math.round(distance) });
	}

	if (!tooFar.length) {
		return [
			{
				status: "ok",
				title: `${plural(workplaces.length, "workplace")} near housing`,
				detail: `Every workplace has housing within ${MAX_COMMUTE_DISTANCE} blocks, so workers can live close enough not to complain.`,
			},
		];
	}
	return tooFar
		.sort((a, b) => b.distance - a.distance)
		.map(({ label, distance }) => ({
			status: "warn",
			title: `${label} is ${distance} blocks from housing`,
			detail: `Its worker will complain their home is too far away (over ${MAX_COMMUTE_DISTANCE} blocks). Place a Residence closer to it.`,
			fix: "Residence",
		}));
}

// Beds per building at max level (notes/MINECOLONIES_MECHANICS.md): a
// Residence has one per level, the Tavern a fixed 4, a Guard Tower one for
// its guard, and a Barracks one per level in each of its 4 towers.
const BEDS_AT_MAX_LEVEL = [
	{ keywords: ["residence"], beds: 5, name: "Residence" },
	{ keywords: ["tavern"], beds: 4, name: "Tavern" },
	{ keywords: ["guard tower"], beds: 1, name: "Guard Tower" },
	{ keywords: ["barracks"], beds: 20, name: "Barracks" },
];
// The research-unlocked population caps, in order.
const POPULATION_CAPS = [
	{ max: 25, research: null },
	{ max: 50, research: "Outpost" },
	{ max: 100, research: "Hamlet" },
	{ max: 150, research: "Village" },
	{ max: 500, research: "City" },
];

// buildings: [{ label, category }]. The most colonists the plan's buildings
// can house with everything at max level, and what limits that. Returns
// { maxColonists, items: [{ status, title, detail }] } - items is empty
// with no housing at all (that's an essentials warning).
export function computePopulation(buildings) {
	const parts = BEDS_AT_MAX_LEVEL.map((kind) => ({ ...kind, count: countByKeywords(buildings, kind.keywords) })).filter(
		(kind) => kind.count > 0,
	);
	const maxColonists = parts.reduce((sum, kind) => sum + kind.count * kind.beds, 0);
	if (!maxColonists) return { maxColonists, items: [] };

	const breakdown = parts.map((kind) => `${kind.count} × ${kind.name} (${kind.beds})`).join(" + ");
	const items = [
		{
			status: "info",
			title: `Up to ${plural(maxColonists, "colonist")}`,
			detail: `${breakdown}, with every building at max level. Lower levels have fewer beds (a Residence has one per level).`,
		},
	];
	const cap = POPULATION_CAPS.find((tier) => maxColonists <= tier.max) || POPULATION_CAPS[POPULATION_CAPS.length - 1];
	if (cap.research) {
		items.push({
			status: "warn",
			title: `Needs the ${cap.research} research`,
			detail: `A colony is capped at 25 colonists until University research raises it (Outpost 50, Hamlet 100, Village 150, City 500).${
				maxColonists > cap.max ? ` Even City caps it at ${cap.max}.` : ""
			}`,
		});
	}
	return { maxColonists, items };
}
