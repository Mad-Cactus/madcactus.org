import { Show, createMemo } from "solid-js";
import { markdownToPostText, newsletterSubject, markdownToHtml } from "~/lib/publish-core";

export type PreviewMode = "linkedin" | "email" | "web";

/** LinkedIn feed card — what the post looks like seconds before you schedule it.
 *  ponytail: static mock (avatar initials, 210-char clamp, first comment);
 *  swap for real LinkedIn API preview if they ever expose one. */
export function LinkedInPreview(props: { markdown: string; title: string; firstComment: string }) {
	const text = createMemo(() => markdownToPostText(props.markdown));
	const clamped = createMemo(() => {
		const t = text();
		return t.length > 210 ? `${t.slice(0, 210).trimEnd()}…` : t;
	});
	return (
		<div style={{ "max-width": "520px" }}>
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
							Fractional AI leadership — Mad Cactus · Follow
						</div>
						<div style={{ color: "rgb(0 0 0 / 0.6)", "font-size": "12px" }}>now · 🌐</div>
					</div>
				</div>
				<div style={{ padding: "0 16px 12px", "white-space": "pre-wrap" }}>
					{clamped()}
					<Show when={text().length > 210}>
						<span style={{ color: "#0a66c2", cursor: "pointer" }}> see more</span>
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
				{text().length.toLocaleString()} characters {text().length > 3000 ? "— over LinkedIn's 3,000 limit" : "— fits LinkedIn"}
			</div>
		</div>
	);
}

/** What the Resend broadcast will look like in an inbox — 600px frame. */
export function NewsletterEmailPreview(props: { markdown: string; title: string }) {
	return (
		<div style={{ "max-width": "640px" }}>
			<div class="muted" style={{ "font-size": "12px", "margin-bottom": "8px" }}>
				Inbox preview — from <strong>Collin Pfeifer</strong> · dispatch@madcactus.org
			</div>
			<div style={{ border: "1px solid var(--border, rgb(0 0 0 / 0.15))", "border-radius": "8px", overflow: "hidden" }}>
				<div style={{ padding: "12px 16px", "border-bottom": "1px solid var(--border, rgb(0 0 0 / 0.1))" }}>
					<div style={{ "font-weight": 600, "font-size": "15px" }}>{newsletterSubject({ markdown: props.markdown, title: props.title })}</div>
					<div class="muted" style={{ "font-size": "12px" }}>Collin Pfeifer · The Cactus Dispatch</div>
				</div>
				<div
					class="dispatch-body"
					style={{ padding: "20px 24px", "font-size": "15px", "line-height": "1.6", color: "var(--text)" }}
					// same marked html the send uses — identical trust boundary as publishDoc
					innerHTML={markdownToHtml(props.markdown)}
				/>
			</div>
		</div>
	);
}

/** The Cactus Dispatch web-article look. ponytail: approximates the marketing
 *  issue pages inline; if the site styling drifts, port the real Astro styles. */
export function NewsletterWebPreview(props: { markdown: string; title: string }) {
	return (
		<div style={{ "max-width": "680px", margin: "0 auto" }}>
			<div class="muted" style={{ "font-size": "12px", "margin-bottom": "8px", "text-align": "center" }}>
				Web preview — how the issue reads on madcactus.org
			</div>
			<article class="dispatch-web">
				<header style={{ "border-bottom": "2px solid var(--text)", "padding-bottom": "12px", "margin-bottom": "20px", "text-align": "center" }}>
					<div style={{ "letter-spacing": "0.25em", "text-transform": "uppercase", "font-size": "11px" }}>The Cactus Dispatch</div>
					<h1 style={{ "font-size": "28px", "margin": "10px 0 4px", "font-family": "Georgia, 'Times New Roman', serif" }}>
						{newsletterSubject({ markdown: props.markdown, title: props.title })}
					</h1>
				</header>
				<div
					style={{ "font-size": "16px", "line-height": "1.7", color: "var(--text)" }}
					innerHTML={markdownToHtml(props.markdown)}
				/>
			</article>
		</div>
	);
}
