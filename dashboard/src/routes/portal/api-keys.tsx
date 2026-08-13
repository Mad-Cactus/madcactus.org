import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";
import PortalLayout from "~/components/PortalLayout";
import {
	createApiKeyAction,
	getClientApiKeysQuery,
	getClientUserQuery,
	revokeApiKeyAction,
} from "~/lib/client-queries";

export default function PortalApiKeys() {
	const user = createAsync(() => getClientUserQuery(), { deferStream: true });
	const keys = createAsync(() => getClientApiKeysQuery(), {
		deferStream: true,
	});
	const createKey = useAction(createApiKeyAction);
	const revokeKey = useAction(revokeApiKeyAction);

	const [label, setLabel] = createSignal("");
	const [newKey, setNewKey] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	const [copied, setCopied] = createSignal(false);

	const mcpUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/api/mcp`
			: "/api/mcp";

	async function handleCreate(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData();
		fd.set("label", label() || "Default");
		const result = await createKey(fd);
		if (result?.key) {
			setNewKey(result.key);
			setLabel("");
			// Refresh the list
			window.location.reload();
		}
	}

	function copyKey() {
		if (newKey()) {
			navigator.clipboard.writeText(newKey()!);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}

	const claudeConfig = `{
  "mcpServers": {
    "madcactus": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${newKey() || "YOUR_API_KEY"}"
      }
    }
  }
}`;

	return (
		<PortalLayout user={user()}>
			<Title>API Keys — Mad Cactus Client Portal</Title>
			<h1 class="page-title">API Keys</h1>
			<p class="page-subtitle">
				Connect your AI agent to your project data via MCP
			</p>

			{/* New key display */}
			<Show when={newKey()}>
				<div
					class="card"
					style={{
						"margin-top": "32px",
						"margin-bottom": "24px",
						border: "1px solid var(--gold)",
						"background": "rgba(188, 156, 92, 0.06)",
					}}
				>
					<h3 style={{ "margin-bottom": "8px" }}>API Key Created</h3>
					<p class="muted" style={{ "font-size": "13px", "margin-bottom": "16px" }}>
						Copy this key now — you won't see it again.
					</p>
					<div
						style={{
							display: "flex",
							gap: "8px",
							"align-items": "center",
						}}
					>
						<code
							style={{
								flex: "1",
								padding: "10px 14px",
								background: "var(--bg-elevated)",
								border: "1px solid rgba(255,255,255,0.1)",
								"border-radius": "0px",
								"font-size": "13px",
								"word-break": "break-all",
							}}
						>
							{newKey()}
						</code>
						<button class="btn btn-primary" onClick={copyKey}>
							{copied() ? "Copied" : "Copy"}
						</button>
					</div>
				</div>
			</Show>

			{/* Create new key */}
			<div class="card" style={{ "margin-top": "32px" }}>
				<h3 style={{ "margin-bottom": "16px" }}>Generate New API Key</h3>
				<form onSubmit={handleCreate} style={{ display: "flex", gap: "12px", "align-items": "flex-end" }}>
					<div class="form-group" style={{ flex: "1", margin: "0" }}>
						<label for="label">Label (optional)</label>
						<input
							type="text"
							id="label"
							placeholder="e.g. Claude Desktop, Cursor"
							value={label()}
							onInput={(e) => setLabel(e.currentTarget.value)}
						/>
					</div>
					<button type="submit" class="btn btn-primary">Generate Key</button>
				</form>
				<Show when={error()}>
					<p class="login-error" style={{ "margin-top": "8px" }}>{error()}</p>
				</Show>
			</div>

			{/* Existing keys */}
			<div style={{ "margin-top": "32px" }}>
				<div class="section-heading">Your Keys</div>
				<Show when={keys()} fallback={<p class="muted">Loading…</p>}>
					{(list) => (
						<Show
							when={list().length > 0}
							fallback={<div class="card empty">No API keys yet.</div>}
						>
							<div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
								<For each={list()}>
									{(key) => (
										<div class="card" style={{ display: "flex", "align-items": "center", gap: "16px", padding: "16px 20px" }}>
											<div style={{ flex: "1" }}>
												<div style={{ "font-weight": "500", "font-size": "14px" }}>
													{key.label}
												</div>
												<div class="mono muted" style={{ "font-size": "12px" }}>
													{key.keyPrefix}
													<Show when={key.lastUsedAt}>
														{" · last used "}{new Date(key.lastUsedAt!).toLocaleDateString()}
													</Show>
												</div>
											</div>
											<Show
												when={key.revokedAt}
												fallback={
													<form method="post" action="/portal/api-keys/revoke">
														<input type="hidden" name="id" value={key.id} />
														<button type="submit" class="btn btn-sm">Revoke</button>
													</form>
												}
											>
												<span class="badge badge-paused">Revoked</span>
											</Show>
										</div>
									)}
								</For>
							</div>
						</Show>
					)}
				</Show>
			</div>

			{/* MCP setup instructions */}
			<div class="card" style={{ "margin-top": "32px" }}>
				<h3 style={{ "margin-bottom": "8px" }}>How to Connect Your Agent</h3>
				<p class="muted" style={{ "font-size": "13px", "margin-bottom": "16px" }}>
					Add this MCP server config to your AI agent (Claude Desktop, Cursor, etc.):
				</p>
				<div style={{ position: "relative" }}>
					<button
						class="btn btn-sm"
						style={{ position: "absolute", top: "8px", right: "8px" }}
						onClick={() => {
							navigator.clipboard.writeText(claudeConfig);
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}}
					>
						{copied() ? "Copied" : "Copy"}
					</button>
					<pre
						style={{
							background: "var(--bg-elevated)",
							border: "1px solid rgba(255,255,255,0.1)",
							"border-radius": "0px",
							padding: "16px",
							"padding-right": "60px",
							"font-size": "12px",
							overflow: "auto",
							"line-height": "1.5",
						}}
					>
						<code>{claudeConfig}</code>
					</pre>
				</div>
				<p class="muted" style={{ "font-size": "12px", "margin-top": "12px" }}>
					Once connected, ask your agent: "What's the status of my project with Mad Cactus?"
				</p>
			</div>
		</PortalLayout>
	);
}
