// Turning material ids from a building's cost list into display names,
// icons and shape silhouettes. Pure (no DOM), so it's unit-tested directly.
//
// Domum Ornamentum "shape" blocks are keyed "<baseId>@@<ingredient,...>" -
// the materials that particular block is made of.

// Partial blocks are textured like their full block, so the cost list crops
// their icon to a silhouette (.material-shape--* in styles.css).
const SHAPE_SUFFIXES = [
	["_fence_gate", "fence"],
	["_fence", "fence"],
	["_wall", "wall"],
	["_stairs", "stairs"],
	["_slab", "slab"],
	["_pressure_plate", "plate"],
	["_button", "button"],
];

// The block id without any "@@ingredients" suffix.
export function getMaterialBaseId(materialId) {
	const at = materialId.indexOf("@@");
	return at === -1 ? materialId : materialId.slice(0, at);
}

// The silhouette class for a partial block, or "".
export function getMaterialShapeClass(materialId) {
	const baseId = getMaterialBaseId(materialId);
	const name = baseId.includes(":") ? baseId.slice(baseId.indexOf(":") + 1) : baseId;
	const match = SHAPE_SUFFIXES.find(([suffix]) => name.endsWith(suffix));
	return match ? `material-shape--${match[1]}` : "";
}

// Names the automatic "split on underscores" can't produce: ids with no
// underscores ("blockpaperwall"), and Domum Ornamentum's timber-frame
// variants, which split to a bare adjective ("Plain"). Taken from the mods'
// own lang files (assets/domum_ornamentum/lang/en_us.json), where the
// timber frame names are "<variant> Timber Frame".
const MATERIAL_NAME_OVERRIDES = {
	"domum_ornamentum:architectscutter": "Architect's Cutter",
	"domum_ornamentum:blockpaperwall": "Framed Pane",
	"domum_ornamentum:blockpillar": "Round Pillar",
	"domum_ornamentum:blockypillar": "Voxel Pillar",
	"domum_ornamentum:squarepillar": "Square Pillar",
	"domum_ornamentum:blockbarreldeco_onside": "Laying Barrel",
	"domum_ornamentum:blockbarreldeco_standing": "Standing Barrel",
	"domum_ornamentum:plain": "Plain Timber Frame",
	"domum_ornamentum:framed": "Framed Timber Frame",
	"domum_ornamentum:side_framed": "Side Timber Frame",
	"domum_ornamentum:side_framed_horizontal": "Side Horizontal Timber Frame",
	"domum_ornamentum:horizontal_plain": "Plain Horizontal Timber Frame",
	"domum_ornamentum:one_crossed_lr": "Left-Right Crossed Timber Frame",
	"domum_ornamentum:one_crossed_rl": "Right-Left Crossed Timber Frame",
	"domum_ornamentum:double_crossed": "Double Crossed Timber Frame",
	"domum_ornamentum:up_gated": "Up Gate Timber Frame",
	"domum_ornamentum:down_gated": "Down Gate Timber Frame",
	"domum_ornamentum:shingle": "Shingles",
	"domum_ornamentum:shingle_flat": "Flat Shingles",
	"domum_ornamentum:shingle_flat_lower": "Flat Lower Shingles",
	"domum_ornamentum:shingle_slab": "Shingle Slab",
	"minecolonies:blockminecoloniesnamedgrave": "Named Grave",
	"minecolonies:blockminecoloniesrack": "Rack",
	"minecolonies:blockstash": "Stash",
	"minecolonies:blockwaypoint": "Waypoint",
	"minecolonies:decorationcontroller": "Decoration Controller",
};

// "minecraft:oak_planks" -> "Oak Planks". A Domum Ornamentum shape lists
// what it's made of first: "Cobblestone and Spruce Planks Plain Timber Frame".
export function formatMaterialName(materialId) {
	const at = materialId.indexOf("@@");
	if (at !== -1) {
		const ingredients = materialId
			.slice(at + 2)
			.split(",")
			.filter(Boolean)
			.map(formatMaterialName);
		const ingredientList =
			ingredients.length <= 2
				? ingredients.join(" and ")
				: `${ingredients.slice(0, -1).join(", ")}, and ${ingredients[ingredients.length - 1]}`;
		return `${ingredientList} ${formatMaterialName(materialId.slice(0, at))}`;
	}
	if (Object.hasOwn(MATERIAL_NAME_OVERRIDES, materialId)) return MATERIAL_NAME_OVERRIDES[materialId];
	const name = materialId.includes(":") ? materialId.slice(materialId.indexOf(":") + 1) : materialId;
	return name
		.split("_")
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}
