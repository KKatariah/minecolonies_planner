// IndexedDB storage for world background images.
//
// Plans live in localStorage, whose small quota (~5-10MB) is shared by the
// whole site - and a background is a multi-MB PNG. So autosave and named
// plans keep the image here and only small metadata in localStorage.
// IndexedDB gets a share of disk space instead.
//
// Each entry has a companion "<key>:stamp" entry saying which in-memory
// version of the background it holds, so an unchanged image isn't rewritten
// on every save (see world-background.js).

const DB_NAME = "minecolonies-planner";
const STORE = "backgrounds";

let dbPromise = null;

function openDb() {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			if (!window.indexedDB) {
				reject(new Error("IndexedDB unavailable"));
				return;
			}
			const request = window.indexedDB.open(DB_NAME, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(STORE);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	return dbPromise;
}

const stampKey = (key) => `${key}:stamp`;

async function run(mode, operate) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, mode);
		const result = operate(tx.objectStore(STORE));
		tx.oncomplete = () => resolve(result?.result ?? null);
		tx.onerror = () => reject(tx.error);
	});
}

export function putBackground(key, value, stamp) {
	return run("readwrite", (store) => {
		store.put(value, key);
		store.put(stamp, stampKey(key));
	});
}

export function getBackground(key) {
	return run("readonly", (store) => store.get(key));
}

export function getBackgroundStamp(key) {
	return run("readonly", (store) => store.get(stampKey(key)));
}

export function deleteBackground(key) {
	return run("readwrite", (store) => {
		store.delete(key);
		store.delete(stampKey(key));
	});
}

export const AUTOSAVE_BG_KEY = "autosave";

export function namedPlanBgKey(name) {
	return `plan:${name}`;
}
