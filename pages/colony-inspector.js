// Colony Inspector: upload a MineColonies colony<ID>.dat save (gzip NBT) and
// view its citizens and buildings. Parsed entirely in the browser.
//
// NBT key names were confirmed against the mod source (ldtteam/minecolonies
// commit e0d7ae1, MC 1.20.1 - see notes/MINECOLONIES_MECHANICS.md). Keys
// drift between mod versions, so anything missing shows as "not found"
// rather than throwing, and the raw data view always shows the whole file.

import { initNavBar } from "../lib/nav.js";
import { getIconSvg } from "../lib/icons.js";
import { escapeHtml } from "../lib/dom.js";
import { readNbtFile } from "../lib/nbt.js";

const SKILL_NAMES = [
	"Athletics",
	"Dexterity",
	"Strength",
	"Agility",
	"Stamina",
	"Mana",
	"Adaptability",
	"Focus",
	"Creativity",
	"Knowledge",
	"Intelligence",
];

const HAPPINESS_MODIFIER_LABELS = {
	homelessness: "Homelessness",
	unemployment: "Unemployment",
	health: "Health",
	idleatjob: "Idle at job",
	school: "School",
	mysticalsite: "Mystical site",
	security: "Security",
	social: "Social",
	slepttonight: "Slept last night",
	food: "Food",
	greatfood: "Great food",
};

// Standard Minecraft ChatFormatting ordinals 0-15 are the 16 dye/text colors,
// in registration order — stable vanilla API, not mod-specific.
const TEAM_COLORS = [
	"#000000",
	"#0000AA",
	"#00AA00",
	"#00AAAA",
	"#AA0000",
	"#AA00AA",
	"#FFAA00",
	"#AAAAAA",
	"#555555",
	"#5555FF",
	"#55FF55",
	"#55FFFF",
	"#FF5555",
	"#FF55FF",
	"#FFFF55",
	"#FFFFFF",
];

initNavBar("inspector");

const root = document.getElementById("inspector-root");

root.innerHTML = `
	<div class="inspector-intro">
		<h1 class="inspector-intro__title">Colony Inspector</h1>
		<p class="inspector-intro__subtitle">Upload a colony save file to view real colonist and building data</p>
	</div>
	<section class="inspector-upload" data-dropzone>
		<div class="inspector-upload__zone" data-dropzone-target>
			<p class="inspector-upload__prompt">Drop a <code>colony&lt;ID&gt;.dat</code> file here, or</p>
			<button type="button" class="inspector-upload__button" data-file-trigger>Choose file</button>
			<input type="file" accept=".dat" hidden data-file-input />
			<p class="inspector-upload__status" data-status></p>
			<button type="button" class="inspector-upload__link-button" data-load-sample>Don't have a save file handy? Try an example colony</button>
		</div>
		<details class="inspector-help">
			<summary>Where do I find this file?</summary>
			<div class="inspector-help__body">
				<p>In your world save folder, look under <code>minecolonies/&lt;dimension&gt;/colony&lt;ID&gt;.dat</code> — e.g. <code>saves/MyWorld/minecolonies/minecraft/overworld/colony1.dat</code>. For a server, this is inside the server's world folder.</p>
				<p>This tool does not upload your file anywhere — it's parsed entirely in your browser, matching the rest of this planner's no-backend design.</p>
				<p>NBT tag names are pinned to one mod source snapshot and can drift across MineColonies versions. If a field shows "not found," the raw data view below still shows everything that was actually read from the file.</p>
			</div>
		</details>
	</section>
	<section class="inspector-results" data-results hidden></section>
`;

const dropzoneTarget = root.querySelector("[data-dropzone-target]");
const fileInput = root.querySelector("[data-file-input]");
const fileTriggerButton = root.querySelector("[data-file-trigger]");
const statusEl = root.querySelector("[data-status]");
const resultsEl = root.querySelector("[data-results]");

fileTriggerButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
	const file = fileInput.files && fileInput.files[0];
	if (file) handleFile(file);
});

const loadSampleButton = root.querySelector("[data-load-sample]");
loadSampleButton.addEventListener("click", async () => {
	statusEl.textContent = "Loading example colony…";
	try {
		const response = await fetch("sample-data/example-colony.dat");
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const buffer = await response.arrayBuffer();
		await handleFile(new File([buffer], "example-colony.dat"));
	} catch (err) {
		statusEl.textContent = `Couldn't load the example colony: ${err.message}`;
	}
});

["dragenter", "dragover"].forEach((eventName) => {
	dropzoneTarget.addEventListener(eventName, (event) => {
		event.preventDefault();
		dropzoneTarget.classList.add("is-dragover");
	});
});
["dragleave", "drop"].forEach((eventName) => {
	dropzoneTarget.addEventListener(eventName, (event) => {
		event.preventDefault();
		dropzoneTarget.classList.remove("is-dragover");
	});
});
dropzoneTarget.addEventListener("drop", (event) => {
	const file = event.dataTransfer.files && event.dataTransfer.files[0];
	if (file) handleFile(file);
});

async function handleFile(file) {
	statusEl.textContent = `Parsing ${file.name}…`;
	resultsEl.hidden = true;
	resultsEl.innerHTML = "";
	try {
		const { value: root } = await readNbtFile(file);
		const resolved = resolveColonyRoot(root);
		renderResolved(resolved, file.name);
		statusEl.textContent = `Loaded ${file.name}`;
	} catch (err) {
		statusEl.textContent = `Couldn't parse ${file.name}: ${err.message}`;
	}
}

function resolveColonyRoot(rootValue) {
	if (Array.isArray(rootValue.colonies)) {
		return { mode: "capability", colonies: rootValue.colonies, root: rootValue };
	}
	if (rootValue.citizenManager !== undefined) {
		return { mode: "single", colonies: [rootValue], root: rootValue };
	}
	if (rootValue.compatabilityManager !== undefined) {
		return { mode: "manager-only", colonies: [], root: rootValue };
	}
	return { mode: "unknown", colonies: [], root: rootValue };
}

function renderResolved(resolved, fileName) {
	resultsEl.hidden = false;

	if (resolved.mode === "manager-only") {
		resultsEl.appendChild(
			buildNotice(
				"This looks like the top-level colonies.dat, which only stores compatibility/recipe data — not colony or citizen data. Look for colony<ID>.dat instead (see 'Where do I find this file?' above).",
			),
		);
		resultsEl.appendChild(buildRawTreeSection(resolved.root, fileName));
		return;
	}

	if (resolved.mode === "unknown") {
		resultsEl.appendChild(
			buildNotice(
				"Couldn't recognize this file's structure as a MineColonies colony save. Showing the raw parsed data below in case it's still useful.",
			),
		);
		resultsEl.appendChild(buildRawTreeSection(resolved.root, fileName));
		return;
	}

	if (resolved.colonies.length === 1) {
		renderColony(resolved.colonies[0], fileName);
		return;
	}

	const picker = document.createElement("div");
	picker.className = "inspector-picker";
	const label = document.createElement("label");
	label.className = "inspector-picker__label";
	label.textContent = `${resolved.colonies.length} colonies found in this file — pick one:`;
	const select = document.createElement("select");
	select.className = "inspector-picker__select";
	resolved.colonies.forEach((colony, index) => {
		const option = document.createElement("option");
		option.value = String(index);
		option.textContent = `${colony.name ?? "Unnamed"} (id ${colony.id ?? "?"}, ${colony.dimension ?? "?"})`;
		select.appendChild(option);
	});
	label.appendChild(select);
	picker.appendChild(label);
	resultsEl.appendChild(picker);

	const colonyContainer = document.createElement("div");
	resultsEl.appendChild(colonyContainer);

	const renderSelected = () => {
		colonyContainer.innerHTML = "";
		renderColony(
			resolved.colonies[Number(select.value)],
			fileName,
			colonyContainer,
		);
	};
	select.addEventListener("change", renderSelected);
	renderSelected();
}

function buildNotice(text) {
	const notice = document.createElement("p");
	notice.className = "inspector-notice";
	notice.textContent = text;
	return notice;
}

function renderColony(colony, fileName, container = resultsEl) {
	const citizens = colony.citizenManager?.citizens ?? [];
	const buildings = colony.buildingManager?.buildings ?? [];
	const residentLinks = findResidentLinks(buildings);

	container.appendChild(buildColonySummary(colony, citizens, buildings));
	container.appendChild(buildCitizensSection(citizens, residentLinks));
	container.appendChild(buildBuildingsSection(buildings));
	container.appendChild(buildRawTreeSection(colony, fileName));
}

function buildColonySummary(colony, citizens, buildings) {
	const section = document.createElement("section");
	section.className = "inspector-card";

	const jobCounts = new Map();
	for (const citizen of citizens) {
		const type = citizen.job?.type;
		const label = type ? formatJobType(type) : "Unemployed";
		jobCounts.set(label, (jobCounts.get(label) ?? 0) + 1);
	}

	const teamColorHex =
		typeof colony.teamcolor === "number" ? TEAM_COLORS[colony.teamcolor] : null;

	section.innerHTML = `
		<h2 class="inspector-card__title">${escapeHtml(colony.name ?? "Unnamed Colony")}</h2>
		<div class="inspector-stat-grid">
			${statTile("Colony ID", colony.id ?? "—")}
			${statTile("Dimension", colony.dimension ?? "—")}
			${statTile("Style", colony.pack ?? colony.style ?? "—")}
			${statTile("Citizens", citizens.length)}
			${statTile("Buildings", buildings.length)}
			${statTile("Colony day", colony.colonyday ?? "—")}
			${teamColorHex ? statTileSwatch("Team color", teamColorHex) : ""}
		</div>
		<div class="inspector-chip-row" data-job-chips></div>
	`;

	const chipRow = section.querySelector("[data-job-chips]");
	for (const [label, count] of [...jobCounts.entries()].sort((a, b) => b[1] - a[1])) {
		const chip = document.createElement("span");
		chip.className = "inspector-chip";
		chip.textContent = `${label}: ${count}`;
		chipRow.appendChild(chip);
	}

	return section;
}

function statTile(label, value) {
	return `
		<div class="inspector-stat-tile">
			<span class="inspector-stat-tile__label">${escapeHtml(label)}</span>
			<span class="inspector-stat-tile__value">${escapeHtml(String(value))}</span>
		</div>
	`;
}

function statTileSwatch(label, hex) {
	return `
		<div class="inspector-stat-tile">
			<span class="inspector-stat-tile__label">${escapeHtml(label)}</span>
			<span class="inspector-stat-tile__value inspector-stat-tile__value--swatch">
				<span class="inspector-swatch" style="background:${hex}"></span>${hex}
			</span>
		</div>
	`;
}

function buildCitizensSection(citizens, residentLinks) {
	const section = document.createElement("section");
	section.className = "inspector-section";

	if (citizens.length === 0) {
		section.innerHTML = `<h2 class="inspector-section__title">Citizens</h2><p class="inspector-notice">No citizens found in this colony's data.</p>`;
		return section;
	}

	const heading = document.createElement("h2");
	heading.className = "inspector-section__title";
	heading.textContent = `Citizens (${citizens.length})`;
	section.appendChild(heading);

	const grid = document.createElement("div");
	grid.className = "inspector-citizen-grid";
	for (const citizen of citizens) {
		grid.appendChild(buildCitizenCard(citizen, residentLinks));
	}
	section.appendChild(grid);

	return section;
}

function buildCitizenCard(citizen, residentLinks) {
	const card = document.createElement("article");
	card.className = "inspector-citizen-card";

	const genderLabel = citizen.female ? "Female" : "Male";
	const jobLabel = citizen.job?.type ? formatJobType(citizen.job.type) : "Unemployed";
	const happiness = estimateHappiness(citizen);
	const buildingsForCitizen = residentLinks.get(citizen.id) ?? [];

	card.innerHTML = `
		<div class="inspector-citizen-card__header">
			<h3 class="inspector-citizen-card__name">${escapeHtml(citizen.name ?? "Unnamed")}</h3>
			<span class="inspector-citizen-card__gender">${getIconSvg(genderLabel === "Female" ? "♀" : "♂", { size: 15 })}</span>
		</div>
		<div class="inspector-citizen-card__meta">
			<span>${escapeHtml(jobLabel)}</span>
			<span>id ${escapeHtml(String(citizen.id ?? "?"))}</span>
		</div>
		<div class="inspector-meter-row">
			<span class="inspector-meter-row__label">Happiness</span>
			${meterBar(happiness.value, 10, happiness.approximate ? " (est.)" : "")}
		</div>
		<div class="inspector-meter-row">
			<span class="inspector-meter-row__label">Saturation</span>
			${meterBar(typeof citizen.saturation === "number" ? citizen.saturation : null, 20)}
		</div>
		<div class="inspector-citizen-card__skills" data-skills></div>
		${
			buildingsForCitizen.length > 0
				? `<div class="inspector-citizen-card__buildings">${buildingsForCitizen
						.map(
							(b) =>
								`<span class="inspector-chip inspector-chip--small">${escapeHtml(formatBuildingType(b.type))} Lv${escapeHtml(String(b.level ?? "?"))}</span>`,
						)
						.join("")}</div>`
				: ""
		}
		${happiness.breakdown.length > 0 ? `<details class="inspector-citizen-card__happiness-detail"><summary>Happiness factors</summary><div class="inspector-chip-row" data-happiness-chips></div></details>` : ""}
	`;

	const skillsWrap = card.querySelector("[data-skills]");
	const skillLevels = getSkillLevels(citizen);
	if (skillLevels) {
		SKILL_NAMES.forEach((name, index) => {
			const entry = document.createElement("span");
			entry.className = "inspector-skill";
			entry.textContent = `${name} ${skillLevels[index] ?? 0}`;
			skillsWrap.appendChild(entry);
		});
	}

	const happinessChipRow = card.querySelector("[data-happiness-chips]");
	if (happinessChipRow) {
		for (const entry of happiness.breakdown) {
			const chip = document.createElement("span");
			chip.className = "inspector-chip inspector-chip--small";
			chip.textContent = `${entry.label}: ${entry.factor.toFixed(2)}`;
			happinessChipRow.appendChild(chip);
		}
	}

	return card;
}

function meterBar(value, max, suffix = "") {
	if (value === null || value === undefined || Number.isNaN(value)) {
		return `<span class="inspector-meter"><span class="inspector-meter__fill" style="width:0%"></span></span><span class="inspector-meter-row__value">—</span>`;
	}
	const clamped = Math.max(0, Math.min(max, value));
	const pct = (clamped / max) * 100;
	return `<span class="inspector-meter"><span class="inspector-meter__fill" style="width:${pct}%"></span></span><span class="inspector-meter-row__value">${clamped.toFixed(1)}/${max}${suffix}</span>`;
}

function getSkillLevels(citizen) {
	const levelMap = citizen.newSkills?.levelMap;
	if (!Array.isArray(levelMap)) return null;
	const levels = new Array(SKILL_NAMES.length).fill(0);
	for (const entry of levelMap) {
		if (typeof entry.skill === "number" && typeof entry.level === "number") {
			levels[entry.skill] = entry.level;
		}
	}
	return levels;
}

// The mod computes happiness live from time-decaying modifier factors rather
// than storing a final number (see notes/MINECOLONIES_MECHANICS.md). This
// reproduces the weighted-average shape using the confirmed 7/14-day
// homelessness-style decay thresholds, but is an estimate, not the exact
// in-game value — polymorphic per-modifier decay curves aren't fully known.
function estimateHappiness(citizen) {
	const modifiers = citizen.newhappinesshandler;
	if (!Array.isArray(modifiers) || modifiers.length === 0) {
		return { value: null, approximate: true, breakdown: [] };
	}

	let weightedSum = 0;
	let weightTotal = 0;
	const breakdown = [];

	for (const modifier of modifiers) {
		const rawValue = modifier.supplier?.Value;
		if (typeof rawValue !== "number") continue;
		let factor = rawValue;
		if (modifier.modifier === "TIME_PERIOD_MODIFIER" && typeof modifier.day === "number") {
			if (modifier.day > 14) factor = rawValue * 0.5;
			else if (modifier.day > 7) factor = rawValue * 0.75;
		}
		const label = HAPPINESS_MODIFIER_LABELS[modifier.id] ?? formatJobType(modifier.id ?? "");
		breakdown.push({ label, factor });
		if (Math.abs(factor - 1) < 1e-6) continue; // neutral factors drop out, matching the mod's own formula
		const weight = typeof modifier.weight === "number" ? modifier.weight : 1;
		weightedSum += factor * weight;
		weightTotal += weight;
	}

	const value = weightTotal > 0 ? Math.min(10, 10 * (weightedSum / weightTotal)) : 10;
	return { value, approximate: true, breakdown };
}

function buildBuildingsSection(buildings) {
	const section = document.createElement("section");
	section.className = "inspector-section";

	if (buildings.length === 0) {
		section.innerHTML = `<h2 class="inspector-section__title">Buildings</h2><p class="inspector-notice">No buildings found in this colony's data.</p>`;
		return section;
	}

	const counts = new Map();
	for (const building of buildings) {
		const type = formatBuildingType(building.type);
		if (!counts.has(type)) counts.set(type, []);
		counts.get(type).push(building.level ?? "?");
	}

	const heading = document.createElement("h2");
	heading.className = "inspector-section__title";
	heading.textContent = `Buildings (${buildings.length})`;
	section.appendChild(heading);

	const table = document.createElement("table");
	table.className = "inspector-table";
	table.innerHTML = `
		<thead><tr><th>Building</th><th>Count</th><th>Levels</th></tr></thead>
		<tbody>
			${[...counts.entries()]
				.sort((a, b) => a[0].localeCompare(b[0]))
				.map(
					([type, levels]) =>
						`<tr><td>${escapeHtml(type)}</td><td>${levels.length}</td><td>${escapeHtml(levels.join(", "))}</td></tr>`,
				)
				.join("")}
		</tbody>
	`;
	section.appendChild(table);

	return section;
}

// Which module key wraps "residents" isn't confirmed across versions, so
// this walks each building's full compound looking for any "residents"
// array rather than depending on an exact nesting path.
function findResidentLinks(buildings) {
	const map = new Map();
	for (const building of buildings) {
		const ids = new Set();
		collectResidentIds(building, ids, 0);
		for (const id of ids) {
			if (!map.has(id)) map.set(id, []);
			map.get(id).push({ type: building.type, level: building.level });
		}
	}
	return map;
}

function collectResidentIds(node, out, depth) {
	if (depth > 8 || node === null || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) collectResidentIds(item, out, depth + 1);
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === "residents" && Array.isArray(value)) {
			for (const id of value) if (typeof id === "number") out.add(id);
		} else {
			collectResidentIds(value, out, depth + 1);
		}
	}
}

function formatJobType(type) {
	// Normally a namespaced string ("minecolonies:baker"), but a malformed
	// or hand-edited file can put anything here.
	if (typeof type !== "string") return "Unknown";
	const short = type.includes(":") ? type.split(":")[1] : type;
	return short
		.split(/[_\s]+/)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}

function formatBuildingType(type) {
	if (!type) return "Unknown";
	return formatJobType(type);
}

function buildRawTreeSection(value, fileName) {
	const section = document.createElement("section");
	section.className = "inspector-section";
	const details = document.createElement("details");
	details.className = "inspector-raw";
	const summary = document.createElement("summary");
	summary.textContent = `Raw parsed data (${fileName})`;
	details.appendChild(summary);
	details.appendChild(buildTreeNode(value, 0));
	section.appendChild(details);
	return section;
}

const RAW_TREE_MAX_ITEMS = 200;

function buildTreeNode(value, depth) {
	if (value === null || value === undefined) {
		const span = document.createElement("span");
		span.className = "inspector-raw__leaf";
		span.textContent = "null";
		return span;
	}
	if (Array.isArray(value)) {
		if (value.length === 0) {
			const span = document.createElement("span");
			span.className = "inspector-raw__leaf";
			span.textContent = "[]";
			return span;
		}
		const list = document.createElement("ul");
		list.className = "inspector-raw__list";
		value.slice(0, RAW_TREE_MAX_ITEMS).forEach((item, index) => {
			const li = document.createElement("li");
			const label = document.createElement("span");
			label.className = "inspector-raw__key";
			label.textContent = `[${index}] `;
			li.appendChild(label);
			li.appendChild(buildTreeNode(item, depth + 1));
			list.appendChild(li);
		});
		if (value.length > RAW_TREE_MAX_ITEMS) {
			const li = document.createElement("li");
			li.className = "inspector-raw__truncated";
			li.textContent = `…and ${value.length - RAW_TREE_MAX_ITEMS} more`;
			list.appendChild(li);
		}
		return list;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value);
		if (entries.length === 0) {
			const span = document.createElement("span");
			span.className = "inspector-raw__leaf";
			span.textContent = "{}";
			return span;
		}
		const list = document.createElement("ul");
		list.className = "inspector-raw__list";
		// Truncated like arrays: a compound can hold hundreds of thousands of
		// keys for a few MB of file, and this view is built for every colony.
		for (const [key, child] of entries.slice(0, RAW_TREE_MAX_ITEMS)) {
			const li = document.createElement("li");
			const label = document.createElement("span");
			label.className = "inspector-raw__key";
			label.textContent = `${key}: `;
			li.appendChild(label);
			li.appendChild(buildTreeNode(child, depth + 1));
			list.appendChild(li);
		}
		if (entries.length > RAW_TREE_MAX_ITEMS) {
			const li = document.createElement("li");
			li.className = "inspector-raw__truncated";
			li.textContent = `…and ${entries.length - RAW_TREE_MAX_ITEMS} more`;
			list.appendChild(li);
		}
		return list;
	}
	const span = document.createElement("span");
	span.className = "inspector-raw__leaf";
	span.textContent = String(value);
	return span;
}
