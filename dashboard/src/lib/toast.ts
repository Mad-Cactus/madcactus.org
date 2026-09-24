import { createSignal } from "solid-js";

// Module-level signal store: one queue for the whole app. Call toast() from
// anywhere; <Toaster /> (mounted once per layout) renders it.
export type Toast = { id: number; msg: string; kind: "error" | "success" | "info" };

const [toasts, setToasts] = createSignal<Toast[]>([]);
export { toasts };

let nextId = 0;
export function toast(msg: string, kind: Toast["kind"] = "info") {
	const id = ++nextId;
	setToasts((prev) => [...prev, { id, msg, kind }]);
	// errors linger long enough to read + copy; the rest self-dismiss
	setTimeout(() => dismiss(id), kind === "error" ? 10000 : 4000);
}

export function dismiss(id: number) {
	setToasts((prev) => prev.filter((t) => t.id !== id));
}
