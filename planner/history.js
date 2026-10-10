// Undo/redo: snapshots of the whole plan (as JSON), taken just before each
// edit. The world background isn't part of history.

import { batched } from "./events.js";
import { redoButton, undoButton } from "./layout.js";
import { loadPlanContents, sanitizeForBoard, serializePlan } from "./plan-state.js";

const MAX_UNDO_STATES = 50;
export const undoStack = [];
export const redoStack = [];

function updateUndoRedoButtons() {
	undoButton.disabled = undoStack.length === 0;
	redoButton.disabled = redoStack.length === 0;
}

// Call before changing the plan. A new edit discards anything to redo.
export function pushUndoState() {
	commitUndoSnapshot(takeUndoSnapshot());
}

// The two halves of pushUndoState, for an edit that may turn out not to
// happen (a building drag dropped where it doesn't fit snaps back): take the
// snapshot before changing anything, and commit it only if the edit stands.
export function takeUndoSnapshot() {
	return JSON.stringify(serializePlan());
}

export function commitUndoSnapshot(snapshot) {
	undoStack.push(snapshot);
	if (undoStack.length > MAX_UNDO_STATES) undoStack.shift();
	redoStack.length = 0;
	updateUndoRedoButtons();
}

export function clearHistory() {
	undoStack.length = 0;
	redoStack.length = 0;
	updateUndoRedoButtons();
}

function restoreSnapshot(json) {
	return batched(() => loadPlanContents(sanitizeForBoard(JSON.parse(json))));
}

export async function undo() {
	if (!undoStack.length) return;
	redoStack.push(JSON.stringify(serializePlan()));
	const previous = undoStack.pop();
	updateUndoRedoButtons();
	await restoreSnapshot(previous);
}

export async function redo() {
	if (!redoStack.length) return;
	undoStack.push(JSON.stringify(serializePlan()));
	const next = redoStack.pop();
	updateUndoRedoButtons();
	await restoreSnapshot(next);
}

export function initHistory() {
	undoButton.addEventListener("click", () => undo());
	redoButton.addEventListener("click", () => redo());
	updateUndoRedoButtons();
}
