// Watch analytics for /v/:id watch pages. The <video> is native, so we get
// real playback events: only actual played seconds count — a tab sitting
// open contributes nothing. Flushes on pause/ended/hide/pagehide via
// sendBeacon. The open beacon flips sent → watching server-side.
(function () {
	var id = document.currentScript && document.currentScript.dataset.prospectId;
	var video = document.querySelector("video");
	if (!id || !video) return;
	var api = "/api/video-event";

	function post(body) {
		navigator.sendBeacon(api, new Blob([JSON.stringify(body)], { type: "application/json" }));
	}

	post({ id: id, type: "open" });

	var playedMs = 0; // since last flush
	var lastTime = null; // anchor for timeupdate deltas
	var maxPosition = 0;
	var duration = 0;

	video.addEventListener("loadedmetadata", function () {
		duration = Math.round(video.duration || 0);
	});

	video.addEventListener("seeking", function () {
		// seek = jump, not watching — re-anchor so the gap never counts
		lastTime = video.currentTime;
	});

	video.addEventListener("timeupdate", function () {
		var t = video.currentTime;
		if (!video.paused && lastTime !== null) {
			var delta = t - lastTime;
			// only count small forward deltas (normal playback); seeks re-anchor
			if (delta > 0 && delta < 2) playedMs += delta * 1000;
		}
		lastTime = t;
		if (t > maxPosition) maxPosition = t;
	});

	function flush() {
		var seconds = Math.round(playedMs / 1000);
		playedMs = 0;
		if (seconds < 1 && maxPosition < 1) return;
		post({
			id: id,
			type: "watch",
			seconds: seconds,
			position: Math.round(maxPosition),
			duration: duration,
			completed: video.ended,
		});
	}

	video.addEventListener("pause", flush);
	video.addEventListener("ended", flush);
	document.addEventListener("visibilitychange", function () {
		if (document.hidden) flush();
	});
	addEventListener("pagehide", flush);
})();
