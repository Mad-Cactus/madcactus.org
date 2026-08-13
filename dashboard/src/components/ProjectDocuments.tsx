import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import {
	getDocumentsQuery,
	createDocumentLinkAction,
} from "~/lib/admin-queries";

type FormMode = "link" | "file" | "transcript";

/** Documents section for a project — list + three upload forms (link, file, transcript).
 *  Used on both the company detail and project detail admin pages. */
export default function ProjectDocuments(props: {
	projectId: string;
	referer: string;
}) {
	const docs = createAsync(() => getDocumentsQuery(props.projectId), {
		deferStream: true,
	});
	const addDocLink = useAction(createDocumentLinkAction);

	const [activeForm, setActiveForm] = createSignal<FormMode | null>(null);
	const toggle = (mode: FormMode) =>
		setActiveForm((prev) => (prev === mode ? null : mode));

	async function handleDocLink(e: Event) {
		e.preventDefault();
		const fd = new FormData(e.target as HTMLFormElement);
		fd.set("project_id", props.projectId);
		fd.set("_referer", props.referer);
		await addDocLink(fd);
	}

	return (
		<div style={{ "margin-bottom": "24px" }}>
			<div
				style={{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
					"margin-bottom": "8px",
				}}
			>
				<span class="muted" style={{ "font-size": "13px" }}>
					Documents
				</span>
				<div style={{ display: "flex", gap: "6px" }}>
					<button class="btn btn-sm" onClick={() => toggle("link")}>
						Add Link
					</button>
					<button class="btn btn-sm" onClick={() => toggle("file")}>
						Upload File
					</button>
					<button class="btn btn-sm" onClick={() => toggle("transcript")}>
						Add Transcript
					</button>
				</div>
			</div>

			{/* ── Link form ── */}
			<Show when={activeForm() === "link"}>
				<div class="card" style={{ "margin-bottom": "8px", padding: "16px" }}>
					<form onSubmit={handleDocLink}>
						<div class="form-row">
							<div class="form-group">
								<label for={`lnk_t_${props.projectId}`}>Title</label>
								<input
									type="text"
									id={`lnk_t_${props.projectId}`}
									name="title"
									required
									placeholder="Project Brief"
								/>
							</div>
							<div class="form-group">
								<label for={`lnk_ty_${props.projectId}`}>Type</label>
								<select id={`lnk_ty_${props.projectId}`} name="type">
									<option value="link">Link</option>
									<option value="transcript">Transcript Link</option>
								</select>
							</div>
						</div>
						<div class="form-group">
							<label for={`lnk_u_${props.projectId}`}>URL</label>
							<input
								type="url"
								id={`lnk_u_${props.projectId}`}
								name="url"
								required
								placeholder="https://docs.google.com/…"
							/>
						</div>
						<div class="form-group">
							<label for={`lnk_d_${props.projectId}`}>Description</label>
							<input
								type="text"
								id={`lnk_d_${props.projectId}`}
								name="description"
								placeholder="Brief description"
							/>
						</div>
						<div class="form-group">
							<label for={`lnk_c_${props.projectId}`}>
								Content for search (optional)
							</label>
							<textarea
								id={`lnk_c_${props.projectId}`}
								name="content"
								rows={3}
								placeholder="Paste key text to make searchable…"
							/>
						</div>
						<button type="submit" class="btn btn-primary">
							Add
						</button>
					</form>
				</div>
			</Show>

			{/* ── File upload form ── */}
			<Show when={activeForm() === "file"}>
				<div class="card" style={{ "margin-bottom": "8px", padding: "16px" }}>
					<form
						method="post"
						action="/api/upload"
						enctype="multipart/form-data"
					>
						<input type="hidden" name="project_id" value={props.projectId} />
						<input type="hidden" name="_referer" value={props.referer} />
						<input type="hidden" name="doc_type" value="file" />
						<div class="form-group">
							<label for={`f_file_${props.projectId}`}>File</label>
							<input
								type="file"
								id={`f_file_${props.projectId}`}
								name="file"
								required
							/>
						</div>
						<div class="form-group">
							<label for={`f_t_${props.projectId}`}>Title (optional)</label>
							<input
								type="text"
								id={`f_t_${props.projectId}`}
								name="title"
								placeholder="Defaults to filename"
							/>
						</div>
						<div class="form-group">
							<label for={`f_d_${props.projectId}`}>Description</label>
							<input
								type="text"
								id={`f_d_${props.projectId}`}
								name="description"
								placeholder="Brief description"
							/>
						</div>
						<button type="submit" class="btn btn-primary">
							Upload
						</button>
					</form>
				</div>
			</Show>

			{/* ── Transcript form ── */}
			<Show when={activeForm() === "transcript"}>
				<div class="card" style={{ "margin-bottom": "8px", padding: "16px" }}>
					<form
						method="post"
						action="/api/upload-transcript"
						enctype="multipart/form-data"
					>
						<input type="hidden" name="project_id" value={props.projectId} />
						<input type="hidden" name="_referer" value={props.referer} />
						<div class="form-group">
							<label for={`tr_t_${props.projectId}`}>Title</label>
							<input
								type="text"
								id={`tr_t_${props.projectId}`}
								name="title"
								required
								placeholder="Weekly Sync — Jan 15"
							/>
						</div>
						<div class="form-group">
							<label for={`tr_c_${props.projectId}`}>Transcript</label>
							<textarea
								id={`tr_c_${props.projectId}`}
								name="content"
								rows={6}
								placeholder="Paste meeting transcript…"
							/>
						</div>
						<div class="form-group">
							<label for={`tr_a_${props.projectId}`}>
								Audio file (optional)
							</label>
							<input
								type="file"
								id={`tr_a_${props.projectId}`}
								name="audio"
								accept="audio/*"
							/>
						</div>
						<div class="form-group">
							<label for={`tr_d_${props.projectId}`}>Description</label>
							<input
								type="text"
								id={`tr_d_${props.projectId}`}
								name="description"
								placeholder="Brief description"
							/>
						</div>
						<button type="submit" class="btn btn-primary">
							Add Transcript
						</button>
					</form>
				</div>
			</Show>

			{/* ── Document list ── */}
			<Suspense
				fallback={
					<p class="muted" style={{ "font-size": "12px" }}>
						Loading…
					</p>
				}
			>
				<Show when={docs()}>
					{(list) => (
						<Show
							when={list().length > 0}
							fallback={
								<p class="muted" style={{ "font-size": "12px" }}>
									No documents.
								</p>
							}
						>
							<div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
								<For each={list()}>
									{(doc) => (
										<div
											style={{
												display: "flex",
												"align-items": "center",
												gap: "8px",
												"font-size": "13px",
											}}
										>
											{/* Link type → external URL */}
											<Show when={doc.type === "link" && doc.url}>
												<a
													href={doc.url!}
													target="_blank"
													rel="noopener noreferrer"
													class="gold"
												>
													{doc.title}
												</a>
											</Show>
											{/* File/transcript with storage path → download */}
											<Show when={doc.type !== "link" && doc.url}>
												<a
													href={`/api/download?path=${encodeURIComponent(doc.url!)}`}
													class="gold"
												>
													{doc.title}
												</a>
											</Show>
											{/* Transcript/file without storage (text-only) */}
											<Show when={doc.type !== "link" && !doc.url}>
												<span>{doc.title}</span>
											</Show>
											{/* Audio attachment */}
											<Show when={doc.audioPath}>
												<a
													href={`/api/download?path=${encodeURIComponent(doc.audioPath!)}`}
													class="muted"
													style={{ "font-size": "12px" }}
												>
													audio
												</a>
											</Show>
											<span
												class="badge badge-paused"
												style={{ "text-transform": "capitalize" }}
											>
												{doc.type}
											</span>
											<form
												method="post"
												action="/admin/companies/delete-doc"
												style={{ display: "inline", "margin-left": "auto" }}
											>
												<input type="hidden" name="id" value={doc.id} />
												<Show when={doc.url && doc.type !== "link"}>
													<input
														type="hidden"
														name="storage_path"
														value={doc.url!}
													/>
												</Show>
												<Show when={doc.audioPath}>
													<input
														type="hidden"
														name="audio_path"
														value={doc.audioPath!}
													/>
												</Show>
												<input type="hidden" name="_referer" value={props.referer} />
												<button
													type="submit"
													class="btn btn-sm"
													style={{ color: "#ef4444" }}
												>
													Delete
												</button>
											</form>
										</div>
									)}
								</For>
							</div>
						</Show>
					)}
				</Show>
			</Suspense>
		</div>
	);
}
