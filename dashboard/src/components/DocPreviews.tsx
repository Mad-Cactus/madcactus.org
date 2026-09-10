import { Show, createSignal, createMemo } from "solid-js";
import { markdownToPostText, newsletterSubject, markdownToHtml, EMAIL_FOOTER_HTML } from "~/lib/publish-core";

export type PreviewMode = "linkedin" | "email" | "web";

/** LinkedIn feed card — what the post looks like seconds before you schedule it.
 *  ponytail: static mock (avatar initials, 210-char clamp, first comment);
 *  swap for real LinkedIn API preview if they ever expose one. */
export function LinkedInPreview(props: { markdown: string; title: string; firstComment: string }) {
	const text = createMemo(() => markdownToPostText(props.markdown));
	// LinkedIn collapses long posts after ~210 chars; "see more" expands in place
	const [expanded, setExpanded] = createSignal(false);
	const clamped = createMemo(() => {
		const t = text();
		return expanded() || t.length <= 210 ? t : `${t.slice(0, 210).trimEnd()}…`;
	});
	return (
		<div style={{ width: "100%", "max-width": "520px" }}>
			<div
				style={{
					"background-color": "#fff",
					border: "1px solid rgb(0 0 0 / 0.08)",
					"border-radius": "8px",
					overflow: "hidden",
					color: "rgb(0 0 0 / 0.9)",
					"font-size": "14px",
					"line-height": "1.45",
				}}
			>
				<div style={{ display: "flex", gap: "8px", padding: "12px 16px", "align-items": "center" }}>
					<div
						style={{
							width: "48px",
							height: "48px",
							"border-radius": "50%",
							background: "linear-gradient(135deg, #0a66c2, #70b5f9)",
							color: "#fff",
							display: "flex",
							"align-items": "center",
							"justify-content": "center",
							"font-weight": 700,
							"font-size": "18px",
							flex: "none",
						}}
					>
						CP
					</div>
					<div>
						<div style={{ "font-weight": 600 }}>Collin Pfeifer</div>
						<div style={{ color: "rgb(0 0 0 / 0.6)", "font-size": "12px" }}>
							Consultant at Mad Cactus · Follow
						</div>
						<div style={{ color: "rgb(0 0 0 / 0.6)", "font-size": "12px" }}>now · 🌐</div>
					</div>
				</div>
				<div style={{ padding: "0 16px 12px", "white-space": "pre-wrap" }}>
					{clamped()}
					<Show when={text().length > 210}>
						<span
							style={{ color: "#0a66c2", cursor: "pointer" }}
							onClick={() => setExpanded((v) => !v)}
							role="button"
							tabIndex={0}
							onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
						>
							{expanded() ? " see less" : " see more"}
						</span>
					</Show>
				</div>
				<div style={{ display: "flex", padding: "6px 16px", gap: "16px", color: "rgb(0 0 0 / 0.5)", "font-size": "12px", "border-top": "1px solid rgb(0 0 0 / 0.08)" }}>
					<span>👍 Like</span>
					<span>💬 Comment</span>
					<span>🔁 Repost</span>
					<span>➤ Send</span>
				</div>
			</div>
			<Show when={props.firstComment.trim()}>
				<div
					style={{
						"margin-top": "8px",
						"border-left": "3px solid #0a66c2",
						padding: "8px 12px",
						"font-size": "13px",
						color: "var(--text)",
						background: "rgb(0 0 0 / 0.03)",
						"border-radius": "6px",
					}}
				>
					<strong>First comment</strong> (posts right after publish): {props.firstComment}
				</div>
			</Show>
			<div class="muted" style={{ "font-size": "12px", "margin-top": "8px" }}>
				{text().length.toLocaleString()} characters
				<Show when={text().length > 3000}> — over LinkedIn's 3,000 limit</Show>
			</div>
		</div>
	);
}

/** What the Resend broadcast will look like in an inbox.
 *
 *  Rendered inside an <iframe srcdoc>: the email HTML is the ONLY stylesheet
 *  in its document, exactly like a real email client. Inlining it in the admin
 *  page let admin CSS stomp the issue's h2/p margins — that was the squashed
 *  "wall of text" preview. Includes the code-owned footer so it is byte-for-
 *  byte what sendNewsletter puts in the broadcast.
 */
export function NewsletterEmailPreview(props: { markdown: string; title: string }) {
	const emailHtml = () =>
		`<!doctype html><html><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
		`<body style="margin:0;background:#ffffff;">` +
		`<div style="max-width:640px;margin:0 auto;padding:20px 24px;font-family:Georgia,'Times New Roman',serif;` +
		`font-size:16px;line-height:1.6;color:#1a1a1a;">` +
		markdownToHtml(props.markdown, "email") +
		EMAIL_FOOTER_HTML +
		`</div></body></html>`;
	return (
		<div style={{ width: "100%", "max-width": "640px" }}>
			<div class="muted" style={{ "font-size": "12px", "margin-bottom": "8px" }}>
				Inbox preview — from <strong>Collin Pfeifer</strong> · dispatch@madcactus.org
			</div>
			<div style={{ border: "1px solid var(--border, rgb(0 0 0 / 0.15))", "border-radius": "8px", overflow: "hidden" }}>
				<div style={{ padding: "12px 16px", "border-bottom": "1px solid var(--border, rgb(0 0 0 / 0.1))" }}>
					<div style={{ "font-weight": 600, "font-size": "15px" }}>{newsletterSubject({ markdown: props.markdown, title: props.title })}</div>
					<div class="muted" style={{ "font-size": "12px" }}>Collin Pfeifer · The Cactus Dispatch</div>
				</div>
				<iframe
					// ponytail: srcdoc reloads (scroll reset) on each keystroke while
					// typing with the tab open — debounce here if it gets annoying.
					srcdoc={emailHtml()}
					title="Email preview"
					style={{ width: "100%", height: "70vh", border: "0", background: "#fff", display: "block" }}
				/>
			</div>
		</div>
	);
}

/** The live marketing page itself, served by
 *  /admin/docs/issue-preview/[id] — the SAME components and CSS the public
 *  /newsletter/<id> route renders. What you see is what ships. */
export function NewsletterWebPreview(props: { docId: string }) {
	return (
		<div style={{ width: "100%" }}>
			<div class="muted" style={{ "font-size": "12px", "margin-bottom": "8px", "text-align": "center" }}>
				Web preview — the real madcactus.org issue page (updates on save)
			</div>
			<iframe
				src={`/admin/docs/issue-preview/${props.docId}`}
				title="Web preview"
				style={{ width: "100%", height: "70vh", border: "1px solid var(--border, rgb(0 0 0 / 0.15))", "border-radius": "8px", background: "#fff", display: "block" }}
			/>
		</div>
	);
}
