// Shape-category icon set - replaces the emoji glyphs that used to be
// embedded directly in styles/*.json (shape.emoji) and a handful of
// UI-level emoji elsewhere (nav bar, plan check, colony inspector). The
// style JSONs still carry the original emoji character as their `emoji`
// field - it's kept as an internal lookup KEY (ICONS is keyed by the same
// characters), not touched/renamed, since 238 shape entries across two
// files referencing it by string would be a much larger, riskier diff for
// zero behavioral gain. Every render site that used to drop shape.emoji
// straight into text now calls getIconSvg(shape.emoji) instead.
//
// One consistent visual language throughout: 24x24 viewBox, currentColor
// stroke, no fill (so it always matches whatever text color surrounds it,
// light or dark theme, any category tint), rounded caps/joins. Kept
// deliberately simple - 2-6 shape primitives per icon - both for visual
// consistency across the set and because that's what's actually reliable
// to hand-author well.
(function () {
	const ICONS = {
		// ---- Farming ----
		"🌾": '<path d="M12 21V9"/><path d="M12 9c-3-1-4-4-3-7 3 1 4 4 3 7"/><path d="M12 9c3-1 4-4 3-7-3 1-4 4-3 7"/><path d="M12 14c-2.5-.7-3.3-2.8-2.5-5 2.2.6 3 2.6 2.5 5"/><path d="M12 14c2.5-.7 3.3-2.8 2.5-5-2.2.6-3 2.6-2.5 5"/>',
		"🌴": '<path d="M12 21V12"/><path d="M12 12c-3-3-7-3-9-1 2 3 6 3 9 1"/><path d="M12 12c3-3 7-3 9-1-2 3-6 3-9 1"/><path d="M12 12c-1-4 0-7 2-9"/><path d="M12 12c1-3 0-6-2-8"/>',
		"🌸": '<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8c-1.5-1.8-1.5-4 0-5.3 1.5 1.3 1.5 3.5 0 5.3"/><path d="M14.2 12c1.8-1.5 4-1.5 5.3 0-1.3 1.5-3.5 1.5-5.3 0"/><path d="M12 14.2c1.5 1.8 1.5 4 0 5.3-1.5-1.3-1.5-3.5 0-5.3"/><path d="M9.8 12c-1.8 1.5-4 1.5-5.3 0 1.3-1.5 3.5-1.5 5.3 0"/>',
		"🌿": '<path d="M6 20c-1-6 1-11 6-14 1 6-1 11-6 14Z"/><path d="M18 20c1-5 0-9-4-12"/>',
		"♻️": '<path d="M7 15H4l2.5 4"/><path d="M6 15c-1.3-2.2-1-4.6.5-6.5"/><path d="M14 5h3l-2 4"/><path d="M17 5c2 1.3 3 3.5 2.8 5.8"/><path d="M14.5 19l2.6-2-1.6-2.8"/><path d="M17.1 17c2.2-1 3.6-3 3.7-5.4"/>',
		// ---- Farming (animals) ----
		"🐄": '<path d="M6 11c-1.5-1-2-3 0-4"/><path d="M18 11c1.5-1 2-3 0-4"/><ellipse cx="12" cy="13" rx="6" ry="5"/><circle cx="9.5" cy="12.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12.5" r="0.6" fill="currentColor" stroke="none"/><path d="M9.5 16c1 1 4 1 5 0"/>',
		"🐇": '<path d="M9.5 10c-1-3 0-6 1-6.5 1 1 1 4 .5 6.5"/><path d="M14.5 10c1-3 0-6-1-6.5-1 1-1 4-.5 6.5"/><ellipse cx="12" cy="14" rx="5" ry="5.5"/><circle cx="10" cy="13" r="0.6" fill="currentColor" stroke="none"/><circle cx="14" cy="13" r="0.6" fill="currentColor" stroke="none"/>',
		"🐑": '<circle cx="12" cy="12.5" r="5" /><circle cx="8.5" cy="10" r="1.8"/><circle cx="12" cy="8.5" r="1.8"/><circle cx="15.5" cy="10" r="1.8"/><circle cx="10.3" cy="12" r="0.6" fill="currentColor" stroke="none"/><circle cx="13.7" cy="12" r="0.6" fill="currentColor" stroke="none"/>',
		"🐔": '<path d="M6 15a5 5 0 0110 0c0 2-1 3.5-2.5 4.5h-5A5 5 0 016 15Z"/><path d="M16 13.5l3-1.2-1 2.6z"/><path d="M9 10c0-1 .4-1.8 1.2-2.2M12 9.3c0-1.3.7-2.2 1.8-2.5"/><path d="M9.5 20v1.5M13 20v1.5"/>',
		"🐖": '<ellipse cx="10.5" cy="13" rx="6.5" ry="4.5"/><circle cx="17" cy="14" r="2.3"/><circle cx="17.8" cy="13.6" r="0.35" fill="currentColor" stroke="none"/><circle cx="16.4" cy="13.6" r="0.35" fill="currentColor" stroke="none"/><path d="M6.5 9.5l1.5 2"/><path d="M13 16c1.2.8 1.2 2-.3 2.4"/>',
		"🐝": '<ellipse cx="12" cy="13" rx="4" ry="5"/><path d="M8 11h8M8 13h8M8 15h8"/><path d="M9 8c0-2 1.5-3.5 3-3.5S15 6 15 8"/><path d="M8 8.5c-1.5-1-3-.5-3.5 1"/><path d="M16 8.5c1.5-1 3-.5 3.5 1"/>',
		"🐴": '<path d="M8 20v-8c0-4.5 2.8-8.5 6-8.5 1.6 0 2.8 1 3.3 2.3"/><path d="M14.3 4.8l2.3-1.6-.2 2.5 2 .9-2.2.9"/><path d="M17.3 8c1 2.6-.2 4.7-2.6 5.8"/><path d="M12.5 20v-4.5"/><circle cx="15.8" cy="9.5" r="0.45" fill="currentColor" stroke="none"/>',
		// ---- Craftsmanship ----
		"⚒️": '<path d="M4 20l6-6" /><path d="M9 15l3-3-3.5-3.5-3 3z" transform="translate(0,0)"/><path d="M14 10l6-6" /><path d="M17 4l3 3-3 3-3-3z"/>',
		"⚗️": '<path d="M10 3h4"/><path d="M11 3v5l-4.5 7a3 3 0 002.6 4.5h5.8a3 3 0 002.6-4.5L13 8V3"/><path d="M8.5 15h7"/>',
		"⛏️": '<path d="M5 6c4-3 10-3 14 1-4 1-8 4-10 8"/><path d="M9 15l-5 5"/>',
		"🏗️": '<path d="M5 21V6l6-3v18"/><path d="M11 6h9"/><path d="M17 6v4"/><path d="M20 6l-2 4"/><path d="M5 12h4"/>',
		"🍳": '<circle cx="10" cy="14" r="5.5"/><path d="M15.5 10.5L20 6"/><path d="M19 5l2 2-2 2"/><ellipse cx="10" cy="14" rx="2.4" ry="1.6" fill="currentColor" stroke="none" opacity="0.35"/>',
		"🍺": '<path d="M7 9h8v9a2 2 0 01-2 2H9a2 2 0 01-2-2z"/><path d="M15 11h2a2 2 0 012 2v2a2 2 0 01-2 2h-2"/><path d="M7 9c0-2.5 1.8-4.5 4-4.5S15 6.5 15 9"/>',
		"🎨": '<path d="M12 20c-4.5 0-8-3.2-8-7.5S7.5 5 12 5s8 2.8 8 6.5c0 1.8-1.4 2.5-3 2.5h-1.5c-1 0-1.5 1.4-.7 2.2.9.9-.1 3.8-2.8 3.8Z"/><circle cx="8.3" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="11.5" cy="8.3" r="1" fill="currentColor" stroke="none"/><circle cx="15.2" cy="10.5" r="1" fill="currentColor" stroke="none"/>',
		"🎣": '<path d="M6 4l10 12"/><path d="M4 20c2-3 5-3.5 7-2"/><circle cx="6" cy="4" r="1.3"/><path d="M16 16c1 1.5.5 3-1 3.5"/>',
		"🛠️": '<path d="M14.5 6.5a3.5 3.5 0 00-4.7 4.2L4 16.5 6 19l5.8-5.8a3.5 3.5 0 004.2-4.7l-2.3 2.3-2-2z"/>',
		"🥖": '<path d="M5 15c-1-3 1-8 5-9.5 4-1.5 9 1 10 5s-1 8-5 9.5c-4 1.5-9-1-10-5Z"/><path d="M8 8.5c1 1 1 2.5 0 3.5M11.5 6.5c1 1.2 1 2.8 0 4M15 7c1 1.2 1 2.8 0 4"/>',
		"🧪": '<path d="M9 3h6" /><path d="M10 3v7.5L5.5 18a2 2 0 001.7 3h9.6a2 2 0 001.7-3L14 10.5V3" /><path d="M8 15h8"/>',
		"🧱": '<rect x="3" y="6" width="8" height="4"/><rect x="13" y="6" width="8" height="4"/><rect x="7" y="14" width="8" height="4"/><rect x="3" y="14" width="2" height="4"/><rect x="19" y="14" width="2" height="4"/>',
		"🪓": '<path d="M13 3l7 7-3 3-7-7z"/><path d="M12.5 10.5L4 19"/><path d="M4 19l1.5-4.5L9 16z"/>',
		"🔥": '<path d="M12 3c1.5 3-1 4.5-1.5 7C9 8 8 9 8 11a4 4 0 108 0c0-1.5-1-2.5-2-3 1 3-.5 4-1 4.5"/><path d="M8.5 15a3.5 3.5 0 007 0c0-1-.4-1.8-1-2.5.3 1.5-.5 2.5-1.5 3"/>',
		"🧺": '<path d="M4 11h16l-2 8H6z"/><path d="M8 11c0-3 1.8-5 4-5s4 2 4 5"/><path d="M4 11h16M9 14v3M12 14v3M15 14v3"/>',
		// ---- Education / Mystic ----
		"🎓": '<path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v4c0 1.5 2.7 3 6 3s6-1.5 6-3v-4"/><path d="M21 9v6"/>',
		"📚": '<path d="M4 5h5.5a2 2 0 012 2v13a1.6 1.6 0 00-2-1H4z"/><path d="M20 5h-5.5a2 2 0 00-2 2v13a1.6 1.6 0 012-1H20z"/>',
		"🔮": '<circle cx="12" cy="11" r="6"/><path d="M6 19h12" /><path d="M8.5 19c0-1.5 1.5-2.5 3.5-2.5s3.5 1 3.5 2.5"/>',
		// ---- Fundamentals ----
		"🏛️": '<path d="M4 21h16"/><path d="M5 21V10M9 21V10M12 21V10M15 21V10M19 21V10"/><path d="M3 10l9-6 9 6z"/>',
		"🏠": '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
		"⛺": '<path d="M4 19L12 5l8 14"/><path d="M9 19l3-6 3 6"/><path d="M12 5v3"/>',
		"🏟️": '<ellipse cx="12" cy="12" rx="9" ry="6"/><ellipse cx="12" cy="12" rx="5" ry="3.2"/>',
		"🪨": '<path d="M4 17c-1-3 1-6 4-7 1-2 3-3 5-2 3 0 6 2 6.5 5 2 1 2 4 0 5-1 1-3 1.5-5 1.5H8c-2 0-3.5-1-4-2.5Z"/>',
		// ---- Water/wells/canals ----
		"💧": '<path d="M12 3c3.5 4.5 6 8 6 11a6 6 0 11-12 0c0-3 2.5-6.5 6-11Z"/>',
		"🌉": '<path d="M3 16c2-4 6-6 9-6s7 2 9 6"/><path d="M3 16h18"/><path d="M6 16v-3M10 16v-4M14 16v-4M18 16v-3"/>',
		// ---- Hospital / school / archery / guard / barracks ----
		"🏥": '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 8v8M8 12h8"/>',
		"🏫": '<path d="M3 21h18"/><path d="M5 21V9l7-4 7 4v12"/><path d="M10 21v-5h4v5"/><path d="M9 11h.01M15 11h.01"/>',
		"🏹": '<path d="M6 3a15 15 0 010 18"/><path d="M6 3l3 3M6 21l3-3"/><path d="M6 12h13"/><path d="M16 9l3 3-3 3"/>',
		"🛡️": '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
		"🪖": '<path d="M4 15a8 8 0 0116 0z"/><path d="M2 15h20"/><rect x="10" y="6" width="4" height="3" rx="0.5"/>',
		// ---- Deliveryman / warehouse / smeltery / mystic worker / ships ----
		"📦": '<path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>',
		"⚓": '<circle cx="12" cy="5" r="1.8"/><path d="M12 7v13"/><path d="M6 14a6 6 0 0012 0"/><path d="M8 10h8"/>',
		// ---- Roads/infrastructure ----
		"🚈": '<rect x="5" y="6" width="14" height="10" rx="2"/><path d="M5 11h14"/><circle cx="9" cy="18.5" r="1"/><circle cx="15" cy="18.5" r="1"/>',
		"🚗": '<path d="M4 20h16"/><path d="M4 20l1.5-6h13L20 20"/><path d="M6.5 14l1.2-3.5h8.6L17.5 14"/><circle cx="8" cy="20" r="1.3"/><circle cx="16" cy="20" r="1.3"/>',
		"🚝": '<path d="M4 17h16"/><rect x="6" y="8" width="12" height="7" rx="1.5"/><path d="M9 6v2M15 6v2"/><path d="M9 20l-2 2M15 20l2 2"/>',
		"🚶": '<circle cx="12" cy="4.5" r="1.7"/><path d="M12 8v6l-3 7"/><path d="M12 14l3.5 7"/><path d="M8.5 12L12 10l3.5 2"/>',
		"🛣️": '<path d="M8 3L4 21"/><path d="M16 3l4 18"/><path d="M12 3v3M12 9v3M12 15v3"/>',
		"🛒": '<path d="M3 4h2l2.4 12.2A2 2 0 009.4 18H18a2 2 0 002-1.6L21.5 8H6"/><circle cx="10" cy="21" r="1.2"/><circle cx="17" cy="21" r="1.2"/>',

		// ---- UI-level (nav bar theme toggle, colony inspector, plan check) ----
		"🌙": '<path d="M20 14.5A8.5 8.5 0 1110.5 4a7 7 0 009.5 10.5Z"/>',
		"☀️": '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
		"♂": '<circle cx="10" cy="14" r="5.5"/><path d="M14 10L20 4"/><path d="M15 4h5v5"/>',
		"♀": '<circle cx="12" cy="9" r="5.5"/><path d="M12 14.5V21"/><path d="M8.5 18h7"/>',
		"❓": '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 114 2c-1 .8-1.5 1.4-1.5 2.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
		"✅": '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/>',
		"⚠️": '<path d="M12 3l10 18H2z"/><path d="M12 9v5"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
	};

	// A generic building-outline fallback for a shape with no matching
	// entry above (an emoji added to a style JSON after this set was
	// built, or none at all) - a plain roof-and-walls glyph rather than a
	// blank/missing icon.
	const DEFAULT_ICON =
		'<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>';

	function getIconMarkup(key) {
		return ICONS[key] || DEFAULT_ICON;
	}

	// size in px (both dimensions, used as the width/height attributes - a
	// fallback intrinsic size, not a hard cap) - every icon also carries the
	// "mc-icon" class so a single CSS rule (see styles.css) can make it
	// track surrounding dynamic/em-based text sizing wherever that's
	// needed, without every call site having to compute a pixel size.
	function getIconSvg(key, { size = 18, className = "" } = {}) {
		return (
			`<svg viewBox="0 0 24 24" width="${size}" height="${size}" class="mc-icon ${className}" ` +
			`fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
			`stroke-linejoin="round" aria-hidden="true">${getIconMarkup(key)}</svg>`
		);
	}

	window.MCIcons = { getIconSvg, getIconMarkup, ICONS, DEFAULT_ICON };
})();
