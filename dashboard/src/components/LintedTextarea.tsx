import { For, type JSX } from "solid-js";
import type { LintViolation } from "~/lib/voice-lint";

/**
 * Textarea with code-editor-style wavy underlines under voice-lint matches.
 * Mirror technique: an absolutely-positioned div behind the textarea renders
 * the same text with <mark>s; the transparent-background textarea sits on top
 * and both share identical typography + wrapping, so marks land exactly under
 * the matched characters (violation.index/length). Scroll stays synced.
 */
export const LintedTextarea = (props: {
	value: string;
	violations: LintViolation[];
	onInput: (v: string) => void;
	rows?: number;
	placeholder?: string;
	ariaLabel?: string;
}) => {
	let ta: HTMLTextAreaElement | undefined;
	let mirror: HTMLDivElement | undefined;
	const onScroll = () => {
		if (ta && mirror) {
			mirror.scrollTop = ta.scrollTop;
			mirror.scrollLeft = ta.scrollLeft;
		}
	};
	// walk the text into marked/unmarked segments — overlaps resolved first-wins
	const segs = () => {
		const vs = [...props.violations].filter((v) => v.index >= 0 && v.length > 0 && v.index + v.length <= props.value.length).sort((a, b) => a.index - b.index);
		const out: { text: string; v?: LintViolation }[] = [];
		let pos = 0;
		for (const v of vs) {
			if (v.index < pos) continue;
			if (v.index > pos) out.push({ text: props.value.slice(pos, v.index) });
			out.push({ text: props.value.slice(v.index, v.index + v.length), v });
			pos = v.index + v.length;
		}
		out.push({ text: props.value.slice(pos) });
		return out;
	};
	// identical box + typography on both layers is what makes the marks align
	const shared: JSX.CSSProperties = {
		"font-family": "inherit",
		"font-size": "14px",
		"line-height": "1.5",
		padding: "8px",
		"box-sizing": "border-box",
		"white-space": "pre-wrap",
		"word-break": "break-word",
		width: "100%",
	};
	return (
		<div style={{ position: "relative", "margin-bottom": "8px" }}>
			<div
				ref={mirror}
				aria-hidden="true"
				style={{ ...shared, position: "absolute", inset: 0, height: "100%", overflow: "hidden", "pointer-events": "none", "z-index": 0, color: "transparent" }}
			>
				<For each={segs()}>
					{(s) =>
						s.v ? (
							<mark class="lint-underline" title={`${s.v.rule}${s.v.lesson ? ` — ${s.v.lesson}` : ""}`}>
								{s.text}
							</mark>
						) : (
							s.text
						)
					}
				</For>
				{"\n "}
			</div>
			<textarea
				ref={ta}
				placeholder={props.placeholder}
				aria-label={props.ariaLabel}
				rows={props.rows ?? 12}
				value={props.value}
				onInput={(e) => props.onInput(e.currentTarget.value)}
				onScroll={onScroll}
				style={{ ...shared, position: "relative", "z-index": 1, background: "transparent", border: "1px solid rgba(0,0,0,0.12)", resize: "none", display: "block" }}
			/>
		</div>
	);
};
