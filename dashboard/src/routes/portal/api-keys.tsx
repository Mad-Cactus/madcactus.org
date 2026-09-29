import { Title } from "@solidjs/meta";
import { createAsync, revalidate, useAction } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";
import CreateDialog, { type CreateResult } from "~/components/CreateDialog";
import PortalLayout from "~/components/PortalLayout";
import ConfirmButton from "~/components/ConfirmButton";
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

	const [copied, setCopied] = createSignal(false);

	const mcpUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/api/mcp`
			: "/api/mcp";

	/** Creates the key; refreshes the list so the dialog's one-time secret is
	 *  the only thing left to do. */
	async function handleCreate(fd: FormData): Promise<CreateResult> {
		fd.set("label", String(fd.get("label") || "").trim() || "Default");
		const result = (await createKey(fd)) as { key?: string; error?: string };
		if (!result?.error) await revalidate(getClientApiKeysQuery.key);
		return result;
	}

	const claudeConfig = `{
  "mcpServers": {
    "madcactus": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

	return (
		<PortalLayout user={user()}>
			<Title>API Keys — Mad Cactus Client Portal</Title>

			<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "gap": "16px", "margin-bottom": "32px" }}>
				<div>
					<h1 class="page-title">API Keys</h1>
					<p class="page-subtitle" style={{ "margin-bottom": "0" }}>
						Connect your AI agent to your project data via MCP
					</p>
				</div>
				<CreateDialog
					label="Generate Key"
					title="Generate new API key"
					submitLabel="Generate Key"
					onSubmit={handleCreate}
					renderSuccess={(res) => <KeyCreated result={res} />}
				>
					<div class="form-group">
						<label for="label">Label (optional)</label>
						<input type="text" id="label" name="label" placeholder="e.g. Claude Desktop, Cursor" />
					</div>
				</CreateDialog>
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
													<ConfirmButton
																			label="Revoke"
																			onConfirm={async () => {
																				const fd = new FormData();
																				fd.set("id", key.id);
																				return revokeKey(fd);
																			}}
																		/>
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

/** One-time secret panel — the dialog stays open until this is dismissed. */
function KeyCreated(props: { result: NonNullable<CreateResult> }) {
	const [copied, setCopied] = createSignal(false);
	const key = () => String(props.result.key ?? "");
	return (
		<div>
			<p class="muted" style={{ "font-size": "13px", "margin-bottom": "12px" }}>
				Copy this key now — you won't see it again.
			</p>
			<div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
				<code
					style={{
						flex: "1",
						padding: "10px 14px",
						background: "var(--bg-elevated)",
						border: "1px solid rgba(255,255,255,0.1)",
						"font-size": "13px",
						"word-break": "break-all",
					}}
				>
					{key()}
				</code>
				<button
					class="btn btn-primary"
					onClick={() => {
						navigator.clipboard.writeText(key());
						setCopied(true);
						setTimeout(() => setCopied(false), 2000);
					}}
				>
					{copied() ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}
