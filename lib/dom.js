// Small DOM helpers shared by every page.

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// For any text interpolated into innerHTML - text content and attribute
// values alike. Values from uploaded files (biome names, colony data) and
// imported plans are attacker-controlled.
export function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Whether a key event is aimed at a text field, where shortcuts must not fire.
export function isEditableTarget(target) {
	return Boolean(
		target &&
			(target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable),
	);
}
