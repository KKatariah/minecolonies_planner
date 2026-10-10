// Tracks one pointer from pointerdown until it's released or cancelled.
//
// Every drag in the app (panning, marquee select, painting, moving a
// building...) follows the same shape: wait until the pointer has moved far
// enough to count as a drag, update while it moves, then clean up. Doing that
// by hand meant separate pointermove/pointerup/pointercancel handlers sharing
// module-level flags, and a missed reset in any one of them left the app
// stuck mid-gesture. Here each gesture's state lives in its own closure, and
// release and cancel share one cleanup path.
//
// Options:
//   captureTarget  element to capture the pointer on, so moves outside the
//                  window keep arriving
//   captureOnStart capture only once the threshold is crossed, so a plain
//                  click still lands on whatever was clicked
//   threshold      CSS px of movement before the gesture "starts"; 0 starts
//                  it immediately
//   onStart(event)                 once, when the threshold is crossed
//   onMove(event)                  every move after the start
//   onEnd(event, { started, cancelled })
//                  once, on release or cancel (started: whether it ever
//                  crossed the threshold)
//
// Returns { cancel() } to abort from outside (onEnd runs with cancelled).
export function trackPointerGesture(
	downEvent,
	{ captureTarget = null, captureOnStart = false, threshold = 0, onStart, onMove, onEnd } = {},
) {
	const { pointerId } = downEvent;
	const startX = downEvent.clientX;
	const startY = downEvent.clientY;
	let started = false;
	let finished = false;

	const capture = () => {
		if (!captureTarget) return;
		try {
			captureTarget.setPointerCapture(pointerId);
			captureTarget.addEventListener("lostpointercapture", handleLostCapture);
		} catch {
			// Capture isn't available for this pointer; window listeners still work.
		}
	};

	const begin = (event) => {
		started = true;
		if (captureOnStart) capture();
		onStart?.(event);
	};

	const handleMove = (event) => {
		if (event.pointerId !== pointerId) return;
		if (!started) {
			if (Math.hypot(event.clientX - startX, event.clientY - startY) < threshold) return;
			begin(event);
		}
		onMove?.(event);
	};

	const finish = (event, cancelled) => {
		if (finished) return;
		finished = true;
		window.removeEventListener("pointermove", handleMove, true);
		window.removeEventListener("pointerup", handleUp, true);
		window.removeEventListener("pointercancel", handleCancel, true);
		captureTarget?.removeEventListener("lostpointercapture", handleLostCapture);
		if (captureTarget?.hasPointerCapture?.(pointerId)) {
			try {
				captureTarget.releasePointerCapture(pointerId);
			} catch {
				// Already released.
			}
		}
		onEnd?.(event, { started, cancelled });
	};

	const handleUp = (event) => {
		if (event.pointerId === pointerId) finish(event, false);
	};
	const handleCancel = (event) => {
		if (event.pointerId === pointerId) finish(event, true);
	};
	// Capture can be lost without a pointercancel (e.g. the element is
	// removed). On a normal release this fires after pointerup, by which point
	// the gesture is already finished and it's ignored.
	const handleLostCapture = (event) => {
		if (event.pointerId === pointerId) finish(event, true);
	};

	// Capture phase on window, so a handler calling stopPropagation()
	// can't hide the release from us.
	window.addEventListener("pointermove", handleMove, true);
	window.addEventListener("pointerup", handleUp, true);
	window.addEventListener("pointercancel", handleCancel, true);
	if (!captureOnStart) capture();
	if (threshold <= 0) begin(downEvent);

	return { cancel: () => finish(downEvent, true) };
}

// Swallows the click the browser fires right after a pointerup, so the end
// of a drag isn't also treated as a click (placing, selecting, deselecting).
// The click is dispatched in the same task as the pointerup, before any
// timer, so the listener only needs to live until the next tick.
export function suppressNextClick() {
	const swallow = (event) => {
		event.stopPropagation();
		event.preventDefault();
		remove();
	};
	const remove = () => window.removeEventListener("click", swallow, true);
	window.addEventListener("click", swallow, true);
	setTimeout(remove, 0);
}
