// Command palette (⌘K) + g-leader navigation, macro-style.
// ⌘K: fuzzy action list — navigation, new doc, compose, sync.
// g <key>: g e email · g d docs · g a admin · g m meetings · g o outreach
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";

type Cmd = { label: string; hint?: string; run: () => void };

export default function CommandPalette() {
	const navigate = useNavigate();
	const [open, setOpen] = createSignal(false);
	const [gArmed, setGArmed] = createSignal(false);
	const [filter, setFilter] = createSignal("");
	const [index, setIndex] = createSignal(0);

	const cmds = (): Cmd[] => {
		const go = (href: string, label: string): Cmd => ({ label, hint: href, run: () => navigate(href) });
		return [
			go("/admin", "Go to Dashboard"),
			go("/admin/email", "Go to Email"),
			go("/admin/docs", "Go to Docs"),
			go("/admin/projects", "Go to Projects"),
			go("/admin/meetings", "Go to Meetings"),
			go("/admin/outreach", "Go to Outreach"),
			go("/admin/api-keys", "Go to API Keys"),
			{
				label: "New doc",
				hint: "docs",
				run: async () => {
					const res = await fetch("/api/docs", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ title: "Untitled" }),
					});
					const doc = (await res.json()) as { id: string };
					navigate(`/admin/docs/${doc.id}`);
				},
			},
			{ label: "Compose email", hint: "email · c", run: () => navigate("/admin/email?compose=1") },
			{ label: "Sync email", hint: "email", run: () => void fetch("/api/email/sync", { method: "POST" }) },
		].filter((c): c is Cmd => !!c);
	};

	const visible = () =>
		cmds().filter((c) => c.label.toLowerCase().includes(filter().toLowerCase()));

	const run = (c: Cmd) => {
		setOpen(false);
		setFilter("");
		void c.run();
	};

	onMount(() => {
		let gTimer: ReturnType<typeof setTimeout> | undefined;
		const handler = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const typing = ["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;

			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setOpen(!open());
				setFilter("");
				setIndex(0);
				return;
			}
			if (open()) {
				if (e.key === "Escape") setOpen(false);
				else if (e.key === "ArrowDown") {
					e.preventDefault();
					setIndex(Math.min(index() + 1, visible().length - 1));
				} else if (e.key === "ArrowUp") {
					e.preventDefault();
					setIndex(Math.max(index() - 1, 0));
				} else if (e.key === "Enter") {
					const c = visible()[index()];
					if (c) run(c);
				}
				return;
			}
			if (typing) return;
			// g-leader
			if (e.key === "g" && !gArmed()) {
				setGArmed(true);
				clearTimeout(gTimer);
				gTimer = setTimeout(() => setGArmed(false), 1200);
				return;
			}
			if (gArmed()) {
				setGArmed(false);
				clearTimeout(gTimer);
				const routes: Record<string, string> = {
					e: "/admin/email",
					d: "/admin/docs",
					a: "/admin",
					m: "/admin/meetings",
					o: "/admin/outreach",
					p: "/admin/projects",
				};
				const href = routes[e.key.toLowerCase()];
				if (href) {
					e.preventDefault();
					navigate(href);
				}
			}
		};
		window.addEventListener("keydown", handler);
		onCleanup(() => {
			window.removeEventListener("keydown", handler);
			clearTimeout(gTimer);
		});
	});

	return (
		<Show when={open()}>
			<div
				style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", "z-index": 100, display: "flex", "justify-content": "center", "align-items": "flex-start", padding: "120px 16px 0" }}
				onClick={() => setOpen(false)}
			>
				<div class="card" style={{ width: "520px", "max-width": "100%", padding: 0, background: "var(--bg-card)" }} onClick={(e) => e.stopPropagation()}>
					<input
						autofocus
						placeholder="Type a command…"
						value={filter()}
						onInput={(e) => {
							setFilter(e.currentTarget.value);
							setIndex(0);
						}}
						style={{ width: "100%", padding: "14px 16px", border: "none", "border-bottom": "1px solid rgba(0,0,0,0.1)", background: "transparent", "font-size": "15px", outline: "none" }}
					/>
					<For each={visible()}>
						{(c, i) => (
							<div
								style={{ padding: "10px 16px", cursor: "pointer", display: "flex", "justify-content": "space-between", background: i() === index() ? "rgba(188,156,92,0.12)" : "transparent" }}
								onMouseEnter={() => setIndex(i())}
								onClick={() => run(c)}
							>
								<span style={{ "font-size": "14px" }}>{c.label}</span>
								<Show when={c.hint}><span class="muted" style={{ "font-size": "12px" }}>{c.hint}</span></Show>
							</div>
						)}
					</For>
					<Show when={visible().length === 0}>
						<div class="muted" style={{ padding: "14px 16px", "font-size": "14px" }}>No matches.</div>
					</Show>
				</div>
			</div>
		</Show>
	);
}
