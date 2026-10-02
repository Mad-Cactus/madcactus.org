import { For, Show, createSignal } from "solid-js";
import { dismiss, history, toasts } from "~/lib/toast";

/** Renders the global toast queue (~/lib/toast). Mount once per layout.
 *  Active toasts: click to dismiss. The ◈ button bottom-left opens the
 *  message history — every past toast, click a row to expand it. */
export default function Toaster() {
	const [open, setOpen] = createSignal(false);
	const [expanded, setExpanded] = createSignal<number | null>(null);
	return (
		<>
			<div class="toaster" role="status" aria-live="polite">
				<For each={toasts()}>
					{(t) => (
						<div class={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} title="Click to dismiss">
							{t.msg}
						</div>
					)}
				</For>
			</div>

			<Show when={open()}>
				<div
					style={{
						position: "fixed",
						left: "16px",
						bottom: "60px",
						width: "440px",
						"max-width": "86vw",
						"max-height": "44vh",
						overflow: "auto",
						background: "var(--bg-card, #fff)",
						border: "1px solid var(--border, #ddd)",
						"border-radius": "10px",
						padding: "10px 12px",
						"box-shadow": "0 8px 24px rgba(0,0,0,0.18)",
						"z-index": 200,
					}}
				>
					<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "6px" }}>
						<strong style={{ "font-size": "13px" }}>Message history</strong>
						<button type="button" class="btn btn-sm" onClick={() => setOpen(false)}>✕</button>
					</div>
					<Show when={history().length > 0} fallback={<p class="muted" style={{ margin: 0, "font-size": "13px" }}>Nothing yet.</p>}>
						<For each={history()}>
							{(t) => (
								<div
									style={{
										display: "flex",
										gap: "8px",
										padding: "6px 0",
										"border-top": "1px solid var(--border, #eee)",
										"font-size": "13px",
										cursor: "pointer",
										"align-items": "baseline",
									}}
									onClick={() => setExpanded(expanded() === t.id ? null : t.id)}
								>
									<span style={{ "flex-shrink": 0, "font-weight": 600 }}>{t.kind === "error" ? "✗" : t.kind === "success" ? "✓" : "·"}</span>
									<span style={{ "flex-shrink": 0 }} class="muted">{t.at.toLocaleTimeString()}</span>
									<span
										style={{
											overflow: "hidden",
											"text-overflow": "ellipsis",
											"white-space": expanded() === t.id ? "normal" : "nowrap",
											"max-width": "330px",
										}}
									>
										{t.msg}
									</span>
								</div>
							)}
						</For>
					</Show>
				</div>
			</Show>

			<button
				type="button"
				title={open() ? "Hide message history" : "Show message history"}
				onClick={() => setOpen(!open())}
				style={{
					position: "fixed",
					left: "16px",
					bottom: "16px",
					width: "34px",
					height: "34px",
					"border-radius": "50%",
					border: "1px solid var(--border, #ddd)",
					background: "var(--bg-card, #fff)",
					cursor: "pointer",
					"font-size": "14px",
					"box-shadow": "0 2px 8px rgba(0,0,0,0.12)",
					"z-index": 201,
					opacity: toasts().length || open() ? 1 : 0.55,
				}}
			>
				◈
			</button>
		</>
	);
}
