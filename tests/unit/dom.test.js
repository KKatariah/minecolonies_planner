// lib/dom.js - the shared HTML escaping and editable-target helpers.

const test = require("node:test");
const assert = require("node:assert/strict");

const { escapeHtml, isEditableTarget } = require("../../lib/dom.js");

test("escapeHtml neutralizes every HTML-significant character", () => {
	const nasty = `minecraft:plains"><img src=x onerror='alert(1)'>&`;
	const escaped = escapeHtml(nasty);
	assert.equal(escaped, "minecraft:plains&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;");
	assert.doesNotMatch(escaped, /[<>"']/);
	assert.equal(escapeHtml(42), "42");
});

test("isEditableTarget recognizes text fields only", () => {
	for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(isEditableTarget({ tagName }), true);
	assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
	assert.equal(isEditableTarget({ tagName: "DIV" }), false);
	assert.equal(isEditableTarget(null), false);
});
