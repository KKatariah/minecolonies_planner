// The placement ghost: while a building (or a copy of a selection) is armed,
// a see-through copy of it follows the cursor exactly where a click would put
// it - outlined green where it fits, red where it doesn't. grid-pointer.js
// decides what to show; this module only draws it.
//
// A ghost shows the building's top-down render when renders are on and it
// has one, else its flat category color and name, like a placed building.

import { drawRenderTurned } from "./buildings.js";
import { cellSize } from "./config.js";
import { settings } from "./display-settings.js";
import { grid } from "./layout.js";
import { fetchRooftopData, getRenderedRooftopImage, getRooftopDataPath } from "./rooftop.js";

const container = document.createElement("div");
container.className = "placement-ghosts";
container.hidden = true;
// Shown over the ghost after a click where it doesn't fit.
const message = document.createElement("div");
message.className = "placement-ghosts__message";
message.textContent = "No room here";
container.appendChild(message);
grid.appendChild(container);

const ghostEls = [];

// The rotation the render needs for a w x h footprint: the shape's own, or
// one more for a catalog footprint that's the blueprint turned a quarter (as
// applyBuildingVisualMode corrects placed buildings). null if neither fits.
function renderRotation(gridData, w, h, rotation) {
	for (const turns of [rotation, rotation + 1]) {
		const odd = turns % 2 === 1;
		if (w === (odd ? gridData.size_z : gridData.size_x) && h === (odd ? gridData.size_x : gridData.size_z)) {
			return turns % 4;
		}
	}
	return null;
}

async function drawGhostRender(el, shape, w, h, rotation, key) {
	const canvas = el.querySelector("canvas");
	const dataPath = settings.topDownRenders.get() ? getRooftopDataPath(shape) : null;
	if (!dataPath) return;
	try {
		const gridData = await fetchRooftopData(dataPath);
		const turns = renderRotation(gridData, w, h, rotation);
		if (turns === null) return;
		const source = await getRenderedRooftopImage(gridData, dataPath);
		// The ghost may show something else by now.
		if (el.dataset.renderKey !== key) return;
		drawRenderTurned(canvas, source, w, h, turns);
		canvas.hidden = false;
		el.classList.add("has-render");
	} catch {
		// Stays flat.
	}
}

function makeGhost() {
	const el = document.createElement("div");
	el.innerHTML = `<canvas class="placement-ghost__render" hidden></canvas><span class="placement-ghost__label"></span>`;
	container.appendChild(el);
	ghostEls.push(el);
	return el;
}

// ghosts: [{ shape: { id, styleFile, label, category }, x, y, w, h, rotation }]
// in blocks. fits: whether a click would place them.
export function showPlacementGhosts(ghosts, fits) {
	while (ghostEls.length < ghosts.length) makeGhost();
	ghostEls.forEach((el, i) => {
		const ghost = ghosts[i];
		el.hidden = !ghost;
		if (!ghost) return;
		const { shape, x, y, w, h, rotation } = ghost;
		el.className = `placement-ghost category-${shape.category || "farming"}${el.classList.contains("has-render") ? " has-render" : ""}`;
		Object.assign(el.style, {
			left: `${x * cellSize}px`,
			top: `${y * cellSize}px`,
			width: `${w * cellSize}px`,
			height: `${h * cellSize}px`,
		});
		const key = `${shape.styleFile}::${shape.id}@${w}x${h}r${rotation}:${settings.topDownRenders.get()}`;
		if (el.dataset.renderKey !== key) {
			el.dataset.renderKey = key;
			el.classList.remove("has-render");
			el.querySelector("canvas").hidden = true;
			el.querySelector(".placement-ghost__label").textContent = shape.label || "";
			drawGhostRender(el, shape, w, h, rotation, key);
		}
	});
	// The message sits just above the first (anchor) building.
	message.style.left = `${ghosts[0].x * cellSize}px`;
	message.style.top = `${ghosts[0].y * cellSize}px`;
	container.classList.toggle("is-blocked", !fits);
	if (fits) container.classList.remove("is-denied");
	container.hidden = false;
}

export function hidePlacementGhosts() {
	container.hidden = true;
}

// A click on a spot that's blocked: the ghost flashes and says why.
let flashTimer = null;
export function flashPlacementBlocked() {
	if (container.hidden) return;
	container.classList.add("is-denied");
	clearTimeout(flashTimer);
	flashTimer = setTimeout(() => container.classList.remove("is-denied"), 600);
}
