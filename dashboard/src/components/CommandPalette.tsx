// Command palette (⌘K) + g-leader navigation, macro-style.
// Built on the shadcn Command parts (cmdk-solid); filtering, arrow-key
// selection and Enter handling come from cmdk — this file is behavior only.
// g <key>: g e email · g d docs · g a admin · g m meetings · g o outreach
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
	CommandDialog,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "~/components/ui/command";

type Cmd = { label: string; hint?: string; run: () => void };

export default function CommandPalette() {
	const navigate = useNavigate();
	const [open, setOpen] = createSignal(false);
	const [gArmed, setGArmed] = createSignal(false);
	const [search, setSearch] = createSignal("");

	const cmds = (): Cmd[] => {
		const go = (href: string, label: string): Cmd => ({ label, hint: href, run: () => navigate(href) });
		return [
			go("/admin", "Go to Dashboard"),
			go("/admin/email", "Go to Email"),
			go("/admin/docs", "Go to Docs"),
			go("/admin/posts", "Go to Posts"),
			go("/admin/newsletters", "Go to Newsletters"),
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
			{
				label: "New LinkedIn post",
				hint: "posts",
				run: async () => {
					const res = await fetch("/api/docs", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ title: "Untitled post", kind: "post" }),
					});
					const doc = (await res.json()) as { id: string };
					navigate(`/admin/posts/${doc.id}`);
				},
			},
			{
				label: "New newsletter issue",
				hint: "newsletters",
				run: async () => {
					const res = await fetch("/api/docs", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ title: "Untitled issue", kind: "newsletter" }),
					});
					const doc = (await res.json()) as { id: string };
					navigate(`/admin/newsletters/${doc.id}`);
				},
			},
			{ label: "Compose email", hint: "email · c", run: () => navigate("/admin/email?compose=1") },
			{ label: "Sync email", hint: "email", run: () => void fetch("/api/email/sync", { method: "POST" }) },
		];
	};

	const run = (c: Cmd) => {
		setOpen(false);
		setSearch("");
		void c.run();
	};

	const toggle = () => {
		setOpen(!open());
		setSearch("");
	};

	onMount(() => {
		let gTimer: ReturnType<typeof setTimeout> | undefined;
		const handler = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const typing = ["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;

			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				toggle();
				return;
			}
			if (open()) return; // cmdk handles arrows/enter/escape while open
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
		<CommandDialog
			open={open()}
			onOpenChange={(o: boolean) => {
				setOpen(o);
				if (o) setSearch("");
			}}
			label="Command menu"
		>
			<CommandInput value={search()} onValueChange={setSearch} placeholder="Type a command…" />
			<CommandList>
				<CommandEmpty>No matches.</CommandEmpty>
				<For each={cmds()}>
					{(c) => (
						<CommandItem value={c.label} keywords={c.hint ? [c.hint] : undefined} onSelect={() => run(c)}>
							<span>{c.label}</span>
							<Show when={c.hint}>
								<span class="muted" style={{ "font-size": "12px" }}>{c.hint}</span>
							</Show>
						</CommandItem>
					)}
				</For>
			</CommandList>
		</CommandDialog>
	);
}
