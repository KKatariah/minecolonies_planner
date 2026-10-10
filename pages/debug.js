// Debug page: every material icon and every curated biome color the app
// has, for checking icon coverage and color choices at a glance.

import { initNavBar } from "../lib/nav.js";
import { BIOME_COLORS, formatBiomeName } from "../lib/world-terrain.js";

initNavBar("debug");

const root = document.getElementById("debug-root");

root.innerHTML = `
	<div class="inspector-intro">
		<h1 class="inspector-intro__title">Debug</h1>
		<p class="inspector-intro__subtitle">Every material icon and biome color this app has data for.</p>
	</div>
	<section class="debug-section">
		<div class="debug-section__header">
			<h2 class="debug-section__title">Material icons</h2>
			<span class="debug-section__count" data-material-count></span>
		</div>
		<input type="text" class="debug-search" placeholder="Filter by id…" data-material-filter />
		<div class="debug-material-grid" data-material-grid></div>
	</section>
	<section class="debug-section">
		<div class="debug-section__header">
			<h2 class="debug-section__title">Biome colors</h2>
			<span class="debug-section__count" data-biome-count></span>
		</div>
		<div class="debug-biome-grid" data-biome-grid></div>
	</section>
`;

const materialCountEl = root.querySelector("[data-material-count]");
const materialFilterInput = root.querySelector("[data-material-filter]");
const materialGridEl = root.querySelector("[data-material-grid]");
const biomeCountEl = root.querySelector("[data-biome-count]");
const biomeGridEl = root.querySelector("[data-biome-grid]");

// ---------- biome colors ----------
// BIOME_COLORS itself (not colorForBiome()) - the curated presets, not the
// keyword-fallback guess used for unrecognized/modded biomes.
const biomeIds = Object.keys(BIOME_COLORS).sort();
biomeCountEl.textContent = `(${biomeIds.length})`;
biomeGridEl.innerHTML = "";
for (const id of biomeIds) {
	const item = document.createElement("div");
	item.className = "debug-biome-item";

	const swatch = document.createElement("div");
	swatch.className = "debug-biome-item__swatch";
	swatch.style.background = BIOME_COLORS[id];

	const labels = document.createElement("div");
	labels.className = "debug-biome-item__labels";
	const name = document.createElement("div");
	name.className = "debug-biome-item__name";
	name.textContent = formatBiomeName(id);
	const meta = document.createElement("div");
	meta.className = "debug-biome-item__meta";
	meta.textContent = `${id} · ${BIOME_COLORS[id]}`;
	labels.appendChild(name);
	labels.appendChild(meta);

	item.appendChild(swatch);
	item.appendChild(labels);
	biomeGridEl.appendChild(item);
}

// ---------- material icons ----------
let materialEntries = [];

function renderMaterialGrid(filterText) {
	const needle = filterText.trim().toLowerCase();
	const visible = needle
		? materialEntries.filter(([id]) => id.toLowerCase().includes(needle))
		: materialEntries;

	materialGridEl.innerHTML = "";
	const fragment = document.createDocumentFragment();
	for (const [id, iconPath] of visible) {
		const item = document.createElement("div");
		item.className = "debug-material-item";

		const iconWrap = document.createElement("div");
		iconWrap.className = "debug-material-item__icon-wrap";
		const img = document.createElement("img");
		img.className = "debug-material-item__icon";
		img.src = iconPath;
		img.alt = "";
		img.loading = "lazy";
		iconWrap.appendChild(img);

		const label = document.createElement("div");
		label.className = "debug-material-item__label";
		label.textContent = id;
		label.title = id;

		item.appendChild(iconWrap);
		item.appendChild(label);
		fragment.appendChild(item);
	}
	materialGridEl.appendChild(fragment);
	materialCountEl.textContent = needle
		? `(${visible.length} of ${materialEntries.length})`
		: `(${materialEntries.length})`;
}

fetch("images/material-icons.json")
	.then((response) => response.json())
	.then((data) => {
		materialEntries = Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]));
		renderMaterialGrid("");
	})
	.catch((error) => {
		materialGridEl.textContent = `Failed to load material-icons.json: ${error.message}`;
	});

materialFilterInput.addEventListener("input", () => {
	renderMaterialGrid(materialFilterInput.value);
});
