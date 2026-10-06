// Loads one of the site's plain <script> files (written for the browser,
// attaching their API to `window`) into an isolated Node vm context, so its
// pure helper functions can be unit-tested without a browser.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO_ROOT = path.join(__dirname, "..", "..");

// files: repo-relative paths, loaded in order into one shared context (e.g.
// ["nbt.js", "world-terrain.js"] - world-terrain.js expects window.NBT).
function loadBrowserScripts(files, extraGlobals = {}) {
	const window = {};
	const context = {
		window,
		console,
		TextDecoder,
		TextEncoder,
		Blob,
		File,
		Response,
		DecompressionStream,
		Uint8Array,
		ArrayBuffer,
		DataView,
		...extraGlobals,
	};
	vm.createContext(context);
	for (const file of files) {
		const code = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
		vm.runInContext(code, context, { filename: file });
	}
	return window;
}

module.exports = { loadBrowserScripts, REPO_ROOT };
