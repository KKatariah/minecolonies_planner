// A minimal publish/subscribe channel between planner modules. Modules that
// change state announce it here instead of calling every module that reacts,
// which keeps the dependency graph one-directional.
//
// Events:
//   "plan-changed"        buildings, paths, grid size or background changed
//                         (autosave and the plan check listen)
//   "selection-changed"   the selected building(s) or armed tray shape changed
//   "display-changed"     a display setting changed - payload: setting name
//   "rooftop-manifest-loaded"

const listeners = new Map(); // name -> Set<fn>

// Events held back during batched() and sent once at the end.
const BATCHABLE = new Set(["plan-changed"]);
let batchDepth = 0;
const pending = new Set();

export function on(name, fn) {
	if (!listeners.has(name)) listeners.set(name, new Set());
	listeners.get(name).add(fn);
}

export function emit(name, payload) {
	if (batchDepth > 0 && BATCHABLE.has(name)) {
		pending.add(name);
		return;
	}
	for (const fn of listeners.get(name) || []) fn(payload);
}

// Runs fn (sync or async) with "plan-changed" collapsed into a single event
// after it finishes - e.g. loading a plan places hundreds of buildings but
// should autosave once, with the finished board. If fn throws, the held
// events are dropped, so a half-loaded board is never autosaved.
export async function batched(fn) {
	batchDepth++;
	let succeeded = false;
	try {
		const result = await fn();
		succeeded = true;
		return result;
	} finally {
		batchDepth--;
		if (batchDepth === 0) {
			const names = [...pending];
			pending.clear();
			if (succeeded) for (const name of names) emit(name);
		}
	}
}
