import { createEffect, createSignal, onCleanup, onMount, For, Show } from "solid-js";
import type { Accessor } from "solid-js";

interface WaveformProps {
	/** interleaved [min, max, min, max, …] normalized to [-1, 1] */
	peaks: number[];
	durationMs: number;
	/** blocks rendered as [startMs, endMs, cut] overlays */
	regions: Accessor<Array<{ start_ms: number; end_ms: number; cut: boolean }>>;
	audio: HTMLAudioElement | undefined;
	/** called with block indices overlapping the drag selection */
	onSelectRange: (fromMs: number, toMs: number) => void;
}

const H = 96;

/** Scrub-through waveform for the meeting draft editor.
 *  Click = seek. Drag = select a span → release cuts (or restores) every
 *  block it touches. Red overlay = cut blocks. White line = playhead. */
export default function Waveform(props: WaveformProps) {
	let canvas: HTMLCanvasElement | undefined;
	const [sel, setSel] = createSignal<{ from: number; to: number } | null>(null);
	const [playhead, setPlayhead] = createSignal(0);
	const [playing, setPlaying] = createSignal(false);
	let dragging = false;

	const msToX = (ms: number, w: number) => (ms / props.durationMs) * w;
	const xToMs = (x: number, w: number) => (x / w) * props.durationMs;

	function draw() {
		const cv = canvas;
		if (!cv || props.peaks.length === 0) return;
		const w = cv.width;
		const h = cv.height;
		const ctx = cv.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, w, h);

		const mid = h / 2;
		const buckets = props.peaks.length / 2;

		// cut regions behind the wave
		for (const r of props.regions()) {
			if (!r.cut) continue;
			ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
			ctx.fillRect(msToX(r.start_ms, w), 0, Math.max(1, msToX(r.end_ms, w) - msToX(r.start_ms, w)), h);
		}

		// waveform
		ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
		for (let b = 0; b < buckets; b++) {
			const min = props.peaks[b * 2];
			const max = props.peaks[b * 2 + 1];
			const y0 = mid - max * (mid - 2);
			const y1 = mid - min * (mid - 2);
			ctx.fillRect((b / buckets) * w, y0, Math.max(1, w / buckets), Math.max(1, y1 - y0));
		}

		// selection
		const s = sel();
		if (s) {
			ctx.fillStyle = "rgba(234, 179, 8, 0.3)";
			ctx.fillRect(Math.min(s.from, s.to), 0, Math.abs(s.to - s.from), h);
		}
	}

	function tick() {
		const a = props.audio;
		if (a && props.durationMs > 0) setPlayhead(a.currentTime * 1000);
		if (playing()) requestAnimationFrame(tick);
	}

	onMount(() => {
		const a = props.audio;
		if (a) {
			a.addEventListener("timeupdate", () => setPlayhead(a.currentTime * 1000));
			a.addEventListener("play", () => { setPlaying(true); requestAnimationFrame(tick); });
			a.addEventListener("pause", () => setPlaying(false));
			a.addEventListener("ended", () => setPlaying(false));
		}
	});
	onCleanup(() => setPlaying(false));

	// redraw on data/selection changes + keep canvas sized to its box
	createEffect(() => {
		props.peaks;
		props.regions();
		sel();
		if (canvas) {
			const box = canvas.parentElement!;
			canvas.width = box.clientWidth;
			canvas.height = H;
		}
		draw();
	});

	function pos(e: MouseEvent): number | null {
		const cv = canvas;
		if (!cv) return null;
		const rect = cv.getBoundingClientRect();
		return Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
	}

	function onDown(e: MouseEvent) {
		const x = pos(e);
		if (x == null) return;
		dragging = true;
		setSel({ from: x, to: x });
	}
	function onMove(e: MouseEvent) {
		if (!dragging) {
			// click-to-seek fallback handled on up; hover no-op
			return;
		}
		const x = pos(e);
		if (x == null) return;
		setSel((s) => (s ? { ...s, to: x } : null));
		draw();
	}
	function onUp(e: MouseEvent) {
		const rect = canvas?.getBoundingClientRect();
		dragging = false;
		const s = sel();
		setSel(null);
		draw();
		if (!rect) return;
		const x = pos(e) ?? 0;

		if (!s || Math.abs(s.to - s.from) < 4) {
			// treat as click → seek
			if (props.audio) props.audio.currentTime = (x / rect.width) * (props.durationMs / 1000);
			return;
		}
		const fromMs = xToMs(Math.min(s.from, s.to), rect.width);
		const toMs = xToMs(Math.max(s.from, s.to), rect.width);
		props.onSelectRange(fromMs, toMs);
	}

	const playheadPct = () => `${Math.min(100, (playhead() / props.durationMs) * 100)}%`;

	return (
		<div style={{ position: "relative", width: "100%", cursor: "crosshair" }}>
			<canvas
				ref={canvas}
				style={{ width: "100%", height: `${H}px`, display: "block" }}
				onMouseDown={onDown}
				onMouseMove={onMove}
				onMouseUp={onUp}
				aria-label="Audio waveform — click to seek, drag to select a span to cut"
			/>
			<Show when={playhead() > 0}>
				<div
					style={{
						position: "absolute",
						top: "0",
						bottom: "0",
						left: playheadPct(),
						width: "1px",
						background: "#fff",
						"pointer-events": "none",
					}}
				/>
			</Show>
		</div>
	);
}
