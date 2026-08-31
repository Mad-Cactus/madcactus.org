import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import ConfirmButton from "~/components/ConfirmButton";
import { getUserQuery } from "~/lib/queries";
import {
	getAdminApiKeysQuery,
	createAdminApiKeyAction,
	revokeAdminApiKeyAction,
} from "~/lib/admin-queries";

/** Memberless API keys — server-to-server auth (e.g. the Anarlog publisher).
 *  Raw key is shown once at creation; only a hash is stored. */
export default function AdminApiKeys() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const keys = createAsync(() => getAdminApiKeysQuery(), { deferStream: true });
	const createKey = useAction(createAdminApiKeyAction);
	const revokeKey = useAction(revokeAdminApiKeyAction);

	const [newKey, setNewKey] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	const [label, setLabel] = createSignal("");

	async function handleCreate(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		const res = (await createKey(fd)) as { key?: string; error?: string };
		if (res.error) {
			setError(res.error);
			return;
		}
		setNewKey(res.key ?? null);
		setLabel("");
	}

	async function handleRevoke(id: string) {
		const fd = new FormData();
		fd.set("id", id);
		return revokeKey(fd);
	}

	return (
		<Layout user={user()}>
			<Title>API Keys — Mad Cactus</Title>
			<h1 class="page-title">API Keys</h1>
			<p class="page-subtitle">
				Server-to-server keys (not tied to a portal member) — used by the Anarlog meeting publisher. Works on{" "}
				<code>/api/clients</code> and <code>/api/upload-transcript</code> via{" "}
				<code>Authorization: Bearer mc_…</code>
			</p>

			<Show when={newKey()}>
				<div class="card" style={{ padding: "16px", "margin-bottom": "16px", "border-color": "#16a34a" }}>
					<div style={{ "font-weight": "600", "margin-bottom": "6px" }}>
						Key created — copy it now, it will not be shown again:
					</div>
					<code class="mono" style={{ "font-size": "13px", "word-break": "break-all" }}>{newKey()}</code>
				</div>
			</Show>

			<form onSubmit={handleCreate} style={{ display: "flex", gap: "8px", "margin-bottom": "24px", "max-width": "480px" }}>
				<div class="form-group" style={{ flex: "1", "margin-bottom": "0" }}>
					<input
						type="text"
						name="label"
						placeholder="Label — e.g. meeting-publisher"
						value={label()}
						onInput={(e) => setLabel(e.currentTarget.value)}
					/>
				</div>
				<button type="submit" class="btn btn-primary">Create Key</button>
			</form>
			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show
					when={keys()?.length}
					fallback={<p class="muted">No admin API keys yet.</p>}
				>
					<div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
						<For each={keys()}>
							{(k) => (
								<div class="card" style={{ padding: "14px 20px", display: "flex", "align-items": "center", gap: "12px" }}>
									<div style={{ flex: "1" }}>
										<span style={{ "font-weight": "600", "font-size": "14px" }}>{k.label}</span>
										<span class="mono muted" style={{ "font-size": "12px", "margin-left": "8px" }}>{k.keyPrefix}</span>
									</div>
									<span class="muted" style={{ "font-size": "12px" }}>
										created {new Date(k.createdAt).toLocaleDateString()}
										<Show when={k.lastUsedAt}> · last used {new Date(k.lastUsedAt!).toLocaleDateString()}</Show>
									</span>
									<Show
										when={!k.revokedAt}
										fallback={<span class="badge badge-paused">revoked</span>}
									>
										<ConfirmButton label="Revoke" danger onConfirm={() => handleRevoke(k.id)} />
									</Show>
								</div>
							)}
						</For>
					</div>
				</Show>
			</Suspense>
		</Layout>
	);
}
