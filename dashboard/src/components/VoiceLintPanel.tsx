import { For, Show } from "solid-js";
import type { LintResult } from "~/lib/voice-lint";

/**
 * Inline voice-lint issues, shared by DocEditor (docs/posts/newsletters) and
 * the email draft editor. Shows the checked-rule count plus every avoid hit
 * with a before/after fix example when the pattern carries one.
 */
export const VoiceLintPanel = (props: { result: LintResult | null; stale?: boolean }) => (
	<Show when={props.result}>
		<div
			class="doc-lint"
			style={{
				"margin-top": "10px",
				padding: "8px 12px",
				"border-left": props.result!.avoidCount ? "3px solid #a33" : "3px solid #4a7c4e",
				background: props.result!.avoidCount ? "rgba(170,51,51,0.05)" : "rgba(74,124,78,0.06)",
				"font-size": "13px",
			}}
		>
			<div style={{ "font-weight": 600, "margin-bottom": "4px" }}>
				<Show when={props.result!.avoidCount} fallback={<span>voice ✓ — checked against {props.result!.checked} rules</span>}>
					<span style={{ color: "#a33" }}>voice lint — {props.result!.avoidCount} issue{props.result!.avoidCount === 1 ? "" : "s"}</span>
				</Show>
				<Show when={props.stale}> · checking…</Show>
			</div>
			<For each={props.result!.violations}>
				{(v) => (
					<div style={{ "margin-bottom": "6px" }}>
						<div>
							<code style={{ background: "rgba(170,51,51,0.1)", padding: "0 3px" }}>{v.matched.slice(0, 80)}</code>
							{" — "}
							{v.rule}
						</div>
						<Show when={v.lesson}>
							<div class="muted" style={{ "font-size": "12px" }}>lesson: {v.lesson!.slice(0, 120)}</div>
						</Show>
						<Show when={v.before} keyed>
							{(before) => (
								<div class="muted" style={{ "font-size": "12px" }}>
									instead of: “{before.slice(0, 80)}”
									<Show when={v.after} keyed>{(after) => <> → try: “{after.slice(0, 80)}”</>}</Show>
								</div>
							)}
						</Show>
						<Show when={!v.before && v.after} keyed>
							{(after) => (
								<div class="muted" style={{ "font-size": "12px" }}>try: “{after.slice(0, 80)}”</div>
							)}
						</Show>
					</div>
				)}
			</For>
		</div>
	</Show>
);
