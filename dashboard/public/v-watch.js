// Watch-time beacon for /v/:id watch pages. Counts only visibly-open time
// (tab hidden = paused), flushes on hide/pagehide via sendBeacon so it
// survives tab close. Open event flips sent → watching server-side.
(function () {
	var id = document.currentScript && document.currentScript.dataset.prospectId;
	if (!id) return;
	var api = "/api/video-event";

	function post(body) {
		navigator.sendBeacon(api, new Blob([JSON.stringify(body)], { type: "application/json" }));
	}

	post({ id: id, type: "open" });

	var visibleMs = 0;
	var tickStart = Date.now();

	function flush() {
		if (visibleMs >= 1000) post({ id: id, type: "watch", seconds: Math.round(visibleMs / 1000) });
		visibleMs = 0;
	}

	document.addEventListener("visibilitychange", function () {
		if (document.hidden) {
			visibleMs += Date.now() - tickStart;
			flush();
		} else {
			tickStart = Date.now();
		}
	});
	addEventListener("pagehide", function () {
		visibleMs += Date.now() - tickStart;
		flush();
	});
})();
