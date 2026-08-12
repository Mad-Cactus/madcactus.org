import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show, createSignal, createResource } from "solid-js";
import PortalLayout from "~/components/PortalLayout";
import {
	getClientDocumentsQuery,
	getClientUserQuery,
} from "~/lib/client-queries";
import type { DocumentType } from "~/db/schema";

const typeLabel: Record<DocumentType, string> = {
	link: "Link",
	file: "File",
	transcript: "Transcript",
};

interface SearchHit {
	id: string;
	title: string;
	type: DocumentType;
	url: string | null;
	file_name: string | null;
	description: string | null;
	content_snippet: string | null;
}

export default function PortalDocuments() {
	const user = createAsync(() => getClientUserQuery(), { deferStream: true });
	const docs = createAsync(() => getClientDocumentsQuery(), {
		deferStream: true,
	});

	const [searchQuery, setSearchQuery] = createSignal("");
	const [searchResults] = createResource(searchQuery, async (q) => {
		if (q.trim().length < 2) return null;
		const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
		if (!res.ok) return null;
		const data = await res.json();
		return (data.results ?? []) as SearchHit[];
	});

	const showSearch = () =>
		searchQuery().trim().length >= 2 && searchResults() !== null;

	return (
		<PortalLayout user={user()}>
			<Title>Documents — Mad Cactus Client Portal</Title>
			<h1 class="page-title">Documents</h1>
			<p class="page-subtitle">Shared files, links, and meeting transcripts</p>

			{/* Search bar */}
			<div style={{ "margin-top": "24px", "margin-bottom": "24px", position: "relative" }}>
				<input
					type="text"
					placeholder="Search documents and transcripts…"
					value={searchQuery()}
					onInput={(e) => setSearchQuery(e.currentTarget.value)}
					style={{
						width: "100%",
						padding: "12px 16px",
						background: "var(--bg-card)",
						border: "1px solid rgba(0,0,0,0.12)",
						"border-radius": "0px",
						color: "var(--text)",
						"font-size": "14px",
						outline: "none",
					}}
				/>
				<Show when={searchResults()?.length === 0 && showSearch()}>
					<div class="muted" style={{ "font-size": "13px", "margin-top": "8px", "padding-left": "4px" }}>
						No matches found. Try different keywords.
					</div>
				</Show>
			</div>

			{/* Search results OR document list */}
			<Show
				when={!showSearch()}
				fallback={
					<div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
						<div class="muted" style={{ "font-size": "13px", "margin-bottom": "4px" }}>
							{searchResults()?.length} result{searchResults()?.length === 1 ? "" : "s"} for "{searchQuery()}"
						</div>
						<For each={searchResults() ?? []}>
							{(hit) => (
								<div class="card" style={{ display: "flex", "align-items": "flex-start", gap: "16px", padding: "20px" }}>
									<div style={{ flex: "1" }}>
										<div style={{ "font-size": "15px", "font-weight": "500" }}>
											{hit.title}
										</div>
										<Show when={hit.content_snippet}>
											<div style={{ "font-size": "13px", "margin-top": "6px", opacity: "0.7", "line-height": "1.5" }}>
												{hit.content_snippet}
											</div>
										</Show>
										<Show when={hit.description && !hit.content_snippet}>
											<div class="muted" style={{ "font-size": "13px", "margin-top": "2px" }}>
												{hit.description}
											</div>
										</Show>
										<div class="muted" style={{ "font-size": "12px", "margin-top": "4px" }}>
											{typeLabel[hit.type]}
										</div>
									</div>
									<div>
										<Show
											when={hit.type === "link" && hit.url}
											fallback={
												<Show when={hit.url}>
													<a href={`/api/download?path=${encodeURIComponent(hit.url!)}`} class="btn btn-sm" download="">
														Download
													</a>
												</Show>
											}
										>
											<a href={hit.url!} target="_blank" rel="noopener noreferrer" class="btn btn-sm">
												Open
											</a>
										</Show>
									</div>
								</div>
							)}
						</For>
					</div>
				}
			>
				<Show when={docs()} fallback={<p class="muted">Loading…</p>}>
					{(list) => (
						<Show
							when={list().length > 0}
							fallback={<div class="card empty">No documents shared yet.</div>}
						>
							<div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
								<For each={list()}>
									{(doc) => (
										<div class="card" style={{ display: "flex", "align-items": "center", gap: "16px", padding: "20px" }}>
											<div style={{ flex: "1" }}>
												<div style={{ "font-size": "15px", "font-weight": "500" }}>
													{doc.title}
												</div>
												<Show when={doc.description}>
													<div class="muted" style={{ "font-size": "13px", "margin-top": "2px" }}>
														{doc.description}
													</div>
												</Show>
												<div class="muted" style={{ "font-size": "12px", "margin-top": "4px" }}>
													{typeLabel[doc.type]}
													<Show when={doc.file_name}> · {doc.file_name}</Show>
													<Show when={doc.file_size}>
														{" "}= {(doc.file_size! / 1024).toFixed(0)}KB
													</Show>
													{" · "}{new Date(doc.created_at).toLocaleDateString()}
												</div>
											</div>
											<div>
												<Show
													when={doc.type === "link" && doc.url}
													fallback={
														<Show when={doc.url}>
															<a
																href={`/api/download?path=${encodeURIComponent(doc.url!)}`}
																class="btn btn-sm"
																download=""
															>
																Download
															</a>
														</Show>
													}
												>
													<a
														href={doc.url!}
														target="_blank"
														rel="noopener noreferrer"
														class="btn btn-sm"
													>
														Open
													</a>
												</Show>
											<Show when={doc.audio_path}>
												<a
													href={`/api/download?path=${encodeURIComponent(doc.audio_path!)}`}
													class="btn btn-sm"
													download=""
												>
													Audio
												</a>
											</Show>
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					)}
				</Show>
			</Show>
		</PortalLayout>
	);
}
