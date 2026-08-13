import { Show, createSignal, type JSX } from "solid-js";
import { revalidate } from "@solidjs/router";

/**
 * Button that confirms before running a destructive async action and reports
 * the result inline. Used by every delete/revoke call site so mutating buttons
 * never silently fail (no more bare 500s) and always give on-screen feedback.
 *
 * ponytail: inline confirm ("Delete? Yes / No") instead of a modal lib — zero
 * new deps. Swap for a Kobalte Dialog here if a real modal is wanted later.
 */
export default function ConfirmButton(props: {
	label: string;
	/** Async action. Return `{ error }` to signal failure; anything else = success. */
	onConfirm: () => Promise<{ error?: string } | null | undefined>;
	confirmText?: string;
	successText?: string;
	danger?: boolean;
	class?: string;
	style?: JSX.CSSProperties;
}) {
	const [state, setState] = createSignal<
		"idle" | "confirm" | "busy" | "done" | "error"
	>("idle");
	const [msg, setMsg] = createSignal("");

	async function run() {
		setState("busy");
		setMsg("");
		try {
			const res = await props.onConfirm();
			if (res?.error) {
				setState("error");
				setMsg(res.error);
				return;
			}
			// Show a brief confirmation, then revert (list revalidates and the row
			// unmounts on its own; this covers actions that don't remove a row).
			setState("done");
			revalidate();
			setTimeout(() => setState("idle"), 1200);
		} catch (e) {
			setState("error");
			setMsg(e instanceof Error ? e.message : "Something went wrong");
		}
	}

	const dangerStyle = (): JSX.CSSProperties =>
		props.danger ? { color: "#ef4444" } : {};

	return (
		<span style={{ display: "inline-flex", gap: "6px", "align-items": "center" }}>
			<Show when={state() === "confirm"} fallback={
				<button
					type="button"
					class={props.class ?? "btn btn-sm"}
					style={{ ...dangerStyle(), ...props.style }}
					disabled={state() === "busy"}
					onClick={() => setState("confirm")}
				>
					{state() === "busy" ? "…" : props.label}
				</button>
			}>
				<span class="muted" style={{ "font-size": "12px" }}>
					{props.confirmText ?? "Delete?"}
				</span>
				<button
					type="button"
					class="btn btn-sm"
					style={{ color: "#ef4444" }}
					disabled={state() === "busy"}
					onClick={run}
				>
					{state() === "busy" ? "…" : "Yes"}
				</button>
				<button
					type="button"
					class="btn btn-sm"
					onClick={() => setState("idle")}
				>
					No
				</button>
			</Show>
			<Show when={state() === "done"}>
				<span style={{ color: "#22c55e", "font-size": "12px" }}>
					✓ {props.successText ?? "Done"}
				</span>
			</Show>
			<Show when={state() === "error"}>
				<span class="login-error" style={{ "font-size": "12px" }}>{msg()}</span>
			</Show>
		</span>
	);
}
