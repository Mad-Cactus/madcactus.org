import { createSignal } from "solid-js";

// Module-level signal store: one queue for the whole app. Call toast() from
// anywhere; <Toaster /> (mounted once per layout) renders it.
export type Toast = { id: number; msg: string; kind: "error" | "success" | "info"; at: Date };

const [toasts, setToasts] = createSignal<Toast[]>([]);
const [history, setHistory] = createSignal<Toast[]>([]);
export { toasts, history };

let nextId = 0;
export function toast(msg: string, kind: Toast["kind"] = "info") {
	const id = ++nextId;
	const t = { id, msg, kind, at: new Date() };
	setToasts((prev) => [...prev, t]);
	setHistory((prev) => [t, ...prev].slice(0, 100));
	// errors linger long enough to read + copy; the rest self-dismiss
	setTimeout(() => dismiss(id), kind === "error" ? 10000 : 4000);
}

export function dismiss(id: number) {
	setToasts((prev) => prev.filter((t) => t.id !== id));
}
