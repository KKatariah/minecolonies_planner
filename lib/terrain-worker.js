// Runs computeTerrain() off the main thread for buildTerrainImage() in
// world-terrain.js. Receives { files }, posts { type: "status", text }
// progress messages, then one { type: "result", result }. The result's
// typed arrays are transferred rather than copied.

import { computeTerrain } from "./world-terrain.js";

self.onmessage = async ({ data }) => {
	let result;
	try {
		result = await computeTerrain(data.files, {
			onStatus: (text) => self.postMessage({ type: "status", text }),
		});
	} catch (error) {
		result = { ok: false, message: `Couldn't read the region files: ${error.message}` };
	}
	const transfer = result.ok ? [result.pixels.buffer, result.heightGrid.buffer, result.biomeGrid.buffer] : [];
	self.postMessage({ type: "result", result }, transfer);
};
