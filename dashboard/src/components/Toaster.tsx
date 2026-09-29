import { For } from "solid-js";
import { dismiss, toasts } from "~/lib/toast";

/** Renders the global toast queue (~/lib/toast). Mount once per layout. Click to dismiss. */
export default function Toaster() {
	return (
		<div class="toaster" role="status" aria-live="polite">
			<For each={toasts()}>
				{(t) => (
					<div class={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} title="Click to dismiss">
						{t.msg}
					</div>
				)}
			</For>
		</div>
	);
}
