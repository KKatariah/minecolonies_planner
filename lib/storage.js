// localStorage access that never throws. Storage can be unavailable (some
// private-browsing modes, blocked site data) or full; every preference here
// is a convenience, so a failure just means it isn't remembered.

export function readStored(key) {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

// Returns false if the value couldn't be stored (unavailable or over quota).
export function writeStored(key, value) {
	try {
		window.localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

export function readStoredFlag(key, defaultValue) {
	const raw = readStored(key);
	return raw === null ? defaultValue : raw === "1";
}

export function writeStoredFlag(key, on) {
	writeStored(key, on ? "1" : "0");
}

// A remembered on/off setting, optionally mirrored by a checkbox. onChange
// runs on every change and, unless applyInitial is false, once at creation
// with the restored value.
export function persistedToggle({ key, defaultValue, checkbox = null, onChange = null, applyInitial = true }) {
	let value = readStoredFlag(key, defaultValue);
	if (checkbox) checkbox.checked = value;

	function set(next) {
		value = Boolean(next);
		if (checkbox) checkbox.checked = value;
		writeStoredFlag(key, value);
		onChange?.(value);
	}

	checkbox?.addEventListener("change", () => set(checkbox.checked));
	if (applyInitial) onChange?.(value);

	return {
		get: () => value,
		set,
		toggle: () => set(!value),
	};
}
