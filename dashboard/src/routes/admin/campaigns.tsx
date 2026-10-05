import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import CreateDialog from "~/components/CreateDialog";
import Layout from "~/components/Layout";
import { LintedTextarea } from "~/components/LintedTextarea";
import { VoiceLintPanel } from "~/components/VoiceLintPanel";
import { getUserQuery } from "~/lib/queries";
import {
	getCampaignsQuery,
	createCampaignAction,
	updateCampaignAction,
	deleteCampaignAction,
	addCampaignCompanyAction,
	updateCampaignCompanyAction,
	deleteCampaignCompanyAction,
	setCampaignTemplatesAction,
} from "~/lib/admin-queries";
import { stageLabel, type CampaignCompany, type CampaignTouch, type OutreachStage } from "~/db/schema";
import type { CompanySendStats } from "~/lib/campaign-stats";
import { fillTemplate, templateSlots } from "~/lib/campaign-fill";
import type { LintResult } from "~/lib/voice-lint";
import { fmtDate } from "~/lib/video-summary";

/** getCampaignsQuery row: company + its Gmail-grounded send/reply state. */
type CampaignCompanyWithStats = CampaignCompany & { sendStats: CompanySendStats | null };

/** one campaigns query row */
type CampaignData = {
	id: string;
	name: string;
	description: string | null;
	templates: CampaignTouch[];
	companies: CampaignCompanyWithStats[];
	prospects: { id: string; company: string; stage: string }[];
};

/** company-row edits — datetime-local/number values stay raw strings so a
 *  half-typed value never round-trips through Number() into the DB */
type RowEdit = { contactEmail?: string; sequenceStep?: string; nextSendAt?: string; nextEmailNote?: string };

/** All editing state lives in the page component, never inside a card: every
 *  autosave revalidates getCampaignsQuery, which replaces the row objects,
 *  and <For> is reference-keyed — so cards remount on their own save and
 *  anything held inside one would be wiped. Inputs read local ?? props. */
type CampaignStore = {
	openMap: () => Record<string, boolean>;
	meta: () => Record<string, { name?: string; description?: string }>;
	rows: () => Record<string, RowEdit>;
	saveState: () => Record<string, string>;
	touchLint: () => Record<string, LintResult | null>;
	lintStale: () => Record<string, boolean>;
	touches: (c: { id: string; templates: CampaignTouch[] }) => CampaignTouch[];
	toggleOpen: (id: string, open: boolean) => void;
	editMetaField: (id: string, patch: { name?: string; description?: string }) => void;
	saveTouches: (id: string, ts: CampaignTouch[]) => void;
	lintTouch: (id: string, i: number, body: string) => void;
	editCompanyField: (id: string, patch: RowEdit) => void;
};

/** datetime-local submits wall clock; pin it to an instant (ISO+Z). */
function withInstantIso(fd: FormData): FormData {
	const v = String(fd.get("next_send_at") || "");
	fd.set("next_send_at", v ? new Date(v).toISOString() : "");
	return fd;
}

/** datetime-local value for an existing date (local wall clock). */
function toInputValue(d: Date | null): string {
	if (!d) return "";
	const p = (n: number) => String(n).padStart(2, "0");
	const x = new Date(d);
	return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}

/** Preview values for a touch: the selected company's stored facts when
 *  available, sample copy otherwise. Unfilled slots stay visible as
 *  {{slot}} — the preview shows what is still missing, never fakes it. */
function previewValues(company: { companyName: string; contactEmail: string | null; nextEmailNote: string | null } | null): Record<string, string> {
	const samples: Record<string, string> = {
		first_name: "Sam",
		company: "Acme Logistics",
		watch_sentence: "customs shipment records, carrier safety files, and diesel prices",
		finding_1: "14 inbound steel shipments last quarter (up from 9)",
		finding_2: "carrier insurance lapsed twice this year",
		finding_3: "$4.1M in tariff exposure at current rates",
		link: "https://madcactus.org/l/demo",
		owner_role: "your head of operations",
	};
	if (!company) return samples;
	const local = (company.contactEmail ?? "").split("@")[0] ?? "";
	const first = local.split(/[._-]/)[0] ?? "";
	const url = (company.nextEmailNote ?? "").match(/https?:\/\/\S+/)?.[0];
	return {
		...samples,
		company: company.companyName,
		...(first ? { first_name: first[0].toUpperCase() + first.slice(1) } : {}),
		...(url ? { link: url } : {}),
	};
}

function TemplatesPanel(props: {
	campaign: { id: string; templates: CampaignTouch[]; companies: CampaignCompanyWithStats[] };
	store: CampaignStore;
}) {
	const st = props.store;
	const touches = () => st.touches(props.campaign);
	const [previewFor, setPreviewFor] = createSignal<number | null>(null);
	const [previewCompany, setPreviewCompany] = createSignal<string>("");

	const selectedCompany = () =>
		props.campaign.companies.find((c) => c.id === previewCompany()) ?? null;

	const setTouches = (ts: CampaignTouch[]) => st.saveTouches(props.campaign.id, ts);
	const setTouch = (i: number, patch: Partial<CampaignTouch>) =>
		setTouches(touches().map((t, j) => (j === i ? { ...t, ...patch } : t)));
	const removeTouch = (i: number) => {
		const next = touches().filter((_, j) => j !== i);
		setTouches(next);
		// indices shifted — re-lint so underlines stay under the right bodies
		next.forEach((t, j) => st.lintTouch(props.campaign.id, j, t.body));
	};
	const lintKey = (i: number) => `${props.campaign.id}:${i}`;

	return (
		<div style={{ "margin-top": "16px" }}>
			<div style={{ display: "flex", "align-items": "baseline", gap: "10px" }}>
				<h3 style={{ margin: "0", "font-size": "14px", "font-weight": "600" }}>Templates — the frozen copy, on this campaign</h3>
				<Show when={st.saveState()[`t:${props.campaign.id}`]}>
					<span class="muted" style={{ "font-size": "12px" }}>{st.saveState()[`t:${props.campaign.id}`]}</span>
				</Show>
				<Show when={props.campaign.companies.length}>
					<label class="muted" style={{ "font-size": "12px", "margin-left": "auto" }}>
						preview fill:{" "}
						<select value={previewCompany()} onChange={(e) => setPreviewCompany(e.currentTarget.value)}>
							<option value="">sample company</option>
							<For each={props.campaign.companies}>
								{(c) => <option value={c.id}>{c.companyName}</option>}
							</For>
						</select>
					</label>
				</Show>
			</div>
			<For each={touches()}>
				{(t, i) => (
					<div style={{ "border": "1px solid rgba(127,127,127,0.2)", "border-radius": "8px", "padding": "12px", "margin-top": "10px" }}>
						<div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
							<span class="muted" style={{ "font-size": "12px", "min-width": "64px" }}>touch {t.step}</span>
							<input
								type="text"
								placeholder="Subject"
								value={t.subject}
								onInput={(e) => setTouch(i(), { subject: e.currentTarget.value })}
								style={{ flex: "1", "font-weight": "600" }}
							/>
							<button
								type="button"
								class="btn btn-sm"
								onClick={() => setPreviewFor(previewFor() === i() ? null : i())}
							>
								{previewFor() === i() ? "Hide preview" : "Preview"}
							</button>
							<Show when={touches().length > 1}>
								<button type="button" class="btn btn-sm" onClick={() => removeTouch(i())}>
									✕
								</button>
							</Show>
						</div>
						<LintedTextarea
							ariaLabel={`Touch ${t.step} body`}
							placeholder="Email body — {{slots}} for the per-company fill"
							value={t.body}
							violations={st.touchLint()[lintKey(i())]?.violations ?? []}
							onInput={(v) => {
								setTouch(i(), { body: v });
								st.lintTouch(props.campaign.id, i(), v);
							}}
							rows={Math.max(6, t.body.split("\n").length + 2)}
						/>
						<VoiceLintPanel result={st.touchLint()[lintKey(i())] ?? null} stale={st.lintStale()[lintKey(i())]} />
						<Show when={t.body.trim()}>
							<span class="muted" style={{ "font-size": "11px" }}>slots: {templateSlots(t.body).join(", ") || "none"}</span>
						</Show>
						<Show when={previewFor() === i()}>
							<div style={{ "margin-top": "8px" }}>
								<div class="muted" style={{ "font-size": "11px" }}>
									Subject: {fillTemplate(t.subject, previewValues(selectedCompany()))}
								</div>
								<pre style={{ "white-space": "pre-wrap", "font-size": "12px", "margin": "6px 0 0", "background": "rgba(127,127,127,0.08)", "padding": "10px", "border-radius": "6px" }}>
									{fillTemplate(t.body, previewValues(selectedCompany()))}
								</pre>
								<div class="muted" style={{ "font-size": "11px", "margin-top": "4px" }}>
									Leftover {"{{slots}}"} fill the morning of the send, with verified facts.
								</div>
							</div>
						</Show>
					</div>
				)}
			</For>
			<div style={{ display: "flex", gap: "8px", "margin-top": "10px", "align-items": "center" }}>
				<button
					type="button"
					class="btn btn-sm"
					onClick={() => setTouches([...touches(), { step: touches().length + 1, subject: "", body: "" }])}
				>
					Add touch
				</button>
				<span class="muted" style={{ "font-size": "12px" }}>Every edit autosaves. Voice lint is advisory — the panel flags, you decide.</span>
			</div>
		</div>
	);
}

function CampaignRow(props: { company: CampaignCompanyWithStats; store: CampaignStore }) {
	const remove = useAction(deleteCampaignCompanyAction);
	const st = props.store;
	const row = () => st.rows()[props.company.id];
	const saveText = () => st.saveState()[`r:${props.company.id}`];
	return (
		<div style={{ display: "grid", gap: "4px", padding: "10px 0", "border-bottom": "1px solid rgba(127, 127, 127, 0.15)" }}>
			<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "align-items": "center" }}>
				<span style={{ "font-weight": "600", "min-width": "160px" }}>{props.company.companyName}</span>
				<input
					type="email"
					placeholder="contact email"
					value={row()?.contactEmail ?? props.company.contactEmail ?? ""}
					onInput={(e) => st.editCompanyField(props.company.id, { contactEmail: e.currentTarget.value })}
					style={{ width: "200px" }}
					spellcheck={false}
				/>
				<label class="muted" style={{ "font-size": "12px" }}>
					step{" "}
					<input
						type="number"
						min="1"
						value={row()?.sequenceStep ?? props.company.sequenceStep}
						onInput={(e) => st.editCompanyField(props.company.id, { sequenceStep: e.currentTarget.value })}
						style={{ width: "52px" }}
					/>
				</label>
				<input
					type="datetime-local"
					value={row()?.nextSendAt ?? toInputValue(props.company.nextSendAt)}
					onChange={(e) => st.editCompanyField(props.company.id, { nextSendAt: e.currentTarget.value })}
				/>
				<input
					type="text"
					placeholder="what the next email should say"
					value={row()?.nextEmailNote ?? props.company.nextEmailNote ?? ""}
					onInput={(e) => st.editCompanyField(props.company.id, { nextEmailNote: e.currentTarget.value })}
					style={{ flex: "1", "min-width": "180px" }}
				/>
				<button
					type="button"
					class="btn btn-sm"
					onClick={() => {
						const fd = new FormData();
						fd.set("id", props.company.id);
						void remove(fd);
					}}
				>
					✕
				</button>
				<Show when={saveText()}>
					<span class="muted" style={{ "font-size": "12px" }}>{saveText()}</span>
				</Show>
			</div>
			<div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap", "align-items": "baseline" }}>
				<Show when={props.company.nextSendAt}>
					<span class="muted" style={{ "font-size": "12px" }}>
						next send: {fmtDate(props.company.nextSendAt)}
					</span>
				</Show>
				<Show
					when={props.company.sendStats && props.company.sendStats.sends > 0}
					fallback={
						<Show when={props.company.sendStats}>
							<span class="muted" style={{ "font-size": "12px" }}>no linked sends yet</span>
						</Show>
					}
				>
					<span class="muted" style={{ "font-size": "12px" }}>
						{props.company.sendStats!.sends} sent (first {props.company.sendStats!.firstSentAt ? fmtDate(new Date(props.company.sendStats!.firstSentAt)) : "?"})
					</span>
					<Show
						when={props.company.sendStats!.replied}
						fallback={<span class="muted" style={{ "font-size": "12px" }}>no reply</span>}
					>
						<span style={{ "font-size": "12px", color: "var(--green, #2e7d32)" }}>
							✓ replied{props.company.sendStats!.replyCount > 1 ? ` ×${props.company.sendStats!.replyCount}` : ""}
						</span>
						<Show when={props.company.sendStats!.lastReplySnippet}>
							<span class="muted" style={{ "font-size": "12px", "max-width": "420px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
								"{props.company.sendStats!.lastReplySnippet}"
							</span>
						</Show>
					</Show>
				</Show>
			</div>
		</div>
	);
}

function Campaign(props: { campaign: CampaignData; store: CampaignStore }) {
	const addCampaignCompany = useAction(addCampaignCompanyAction);
	const removeCampaign = useAction(deleteCampaignAction);
	const st = props.store;
	const c = () => props.campaign;
	const name = () => st.meta()[c().id]?.name ?? c().name;
	const description = () => st.meta()[c().id]?.description ?? c().description ?? "";
	const saveText = () => st.saveState()[`c:${c().id}`];
	return (
		<details
			class="card"
			style={{ padding: "20px", "margin-bottom": "16px" }}
			open={st.openMap()[c().id]}
			onToggle={(e) => {
				const open = e.currentTarget.open;
				st.toggleOpen(c().id, open);
				// lint saved bodies once on first open — violations already in the
				// DB show without waiting for a keystroke
				if (open)
					st.touches(c()).forEach((t, i) => {
						if (t.body.trim() && st.touchLint()[`${c().id}:${i}`] === undefined) st.lintTouch(c().id, i, t.body);
					});
			}}
		>
			<summary style={{ cursor: "pointer", display: "flex", "align-items": "baseline", gap: "10px" }}>
				<h2 style={{ margin: "0", "font-family": "var(--font-serif)", "font-weight": "400", "font-size": "20px", display: "inline", "white-space": "nowrap" }}>{name()}</h2>
				<span class="muted" title={description()} style={{ "font-size": "12px", flex: "1", "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
					{description()}
				</span>
				<span class="muted" style={{ "font-size": "12px", "white-space": "nowrap" }}>
					{c().companies.length} target{c().companies.length === 1 ? "" : "s"} · {c().templates.length} touch{c().templates.length === 1 ? "" : "es"} · {c().prospects.length} on board
				</span>
				<button
					type="button"
					class="btn btn-sm"
					style={{ "margin-left": "auto" }}
					onClick={(e) => {
						e.preventDefault();
						if (!confirm(`Delete campaign "${c().name}"? Its target list goes with it; board prospects keep their stages.`)) return;
						const fd = new FormData();
						fd.set("id", c().id);
						void removeCampaign(fd);
					}}
				>
					Delete campaign
				</button>
			</summary>

			<div style={{ display: "flex", gap: "10px", "align-items": "center", "margin-top": "12px" }}>
				<input
					type="text"
					aria-label="Campaign name"
					placeholder="Campaign name"
					value={name()}
					onInput={(e) => st.editMetaField(c().id, { name: e.currentTarget.value })}
					style={{ flex: "1", "font-family": "var(--font-serif)", "font-size": "18px", padding: "4px 8px", border: "1px solid rgba(127,127,127,0.25)", "border-radius": "6px" }}
				/>
				<Show when={saveText()}>
					<span class="muted" style={{ "font-size": "12px", "white-space": "nowrap" }}>{saveText()}</span>
				</Show>
			</div>
			<textarea
				aria-label="Campaign description"
				placeholder="What this campaign is for"
				value={description()}
				ref={(el) => (el.value = description())}
				onInput={(e) => st.editMetaField(c().id, { description: e.currentTarget.value })}
				rows={2}
				style={{ width: "100%", "margin-top": "8px", "font-size": "13px", "box-sizing": "border-box" }}
			/>

			<TemplatesPanel campaign={{ id: c().id, templates: c().templates, companies: c().companies }} store={st} />

			<div style={{ "margin-top": "16px" }}>
				<h3 style={{ margin: "0 0 4px", "font-size": "14px", "font-weight": "600" }}>Companies</h3>
				<For each={c().companies}>
					{(company) => <CampaignRow company={company} store={st} />}
				</For>
				<Show when={!c().companies.length}>
					<p class="muted" style={{ "font-size": "13px" }}>No targets yet — add the first company below.</p>
				</Show>
			</div>

			<div style={{ display: "flex", "align-items": "center", "gap": "8px", "margin-top": "14px" }}>
				<CreateDialog
					label="Add company"
					title={`Add company to ${c().name}`}
					submitLabel="Add"
					triggerClass="btn btn-primary btn-sm"
					onSubmit={(fd) => {
						fd.set("campaign_id", c().id);
						return addCampaignCompany(withInstantIso(fd)) as Promise<{ error?: string; success?: string }>;
					}}
				>
					<div class="form-group">
						<label for="company_name">Company *</label>
						<input type="text" id="company_name" name="company_name" required />
					</div>
					<div class="form-row">
						<div class="form-group">
							<label for="contact_email">Contact email</label>
							<input type="email" id="contact_email" name="contact_email" spellcheck={false} />
						</div>
						<div class="form-group">
							<label for="next_send_at">Next send</label>
							<input type="datetime-local" id="next_send_at" name="next_send_at" />
						</div>
					</div>
					<div class="form-group">
						<label for="next_email_note">What the first/next email should say</label>
						<input type="text" id="next_email_note" name="next_email_note" />
					</div>
				</CreateDialog>
			</div>

			<Show when={c().prospects.length}>
				<details style={{ "margin-top": "14px" }}>
					<summary class="muted" style={{ cursor: "pointer", "font-size": "12px" }}>
						On the CRM board ({c().prospects.length})
					</summary>
					<div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap", "margin-top": "8px" }}>
						<For each={c().prospects}>
							{(p) => (
								<a href="/admin/outreach" class="btn btn-sm" title={stageLabel(p.stage)}>
									{p.company} · {stageLabel(p.stage as OutreachStage)}
								</a>
							)}
						</For>
					</div>
				</details>
			</Show>
		</details>
	);
}

export default function AdminCampaigns() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const campaigns = createAsync(() => getCampaignsQuery(), { deferStream: true });
	const createCampaign = useAction(createCampaignAction);
	const updateCampaign = useAction(updateCampaignAction);
	const saveTemplates = useAction(setCampaignTemplatesAction);
	const updateCompany = useAction(updateCampaignCompanyAction);

	// page-level autosave state — see CampaignStore comment for why this
	// cannot live inside the cards
	const [openMap, setOpenMap] = createSignal<Record<string, boolean>>({});
	const [metaEdits, setMetaEdits] = createSignal<Record<string, { name?: string; description?: string }>>({});
	const [touchEdits, setTouchEdits] = createSignal<Record<string, CampaignTouch[]>>({});
	const [rowEdits, setRowEdits] = createSignal<Record<string, RowEdit>>({});
	const [saveState, setSaveState] = createSignal<Record<string, string>>({});
	const [touchLint, setTouchLint] = createSignal<Record<string, LintResult | null>>({});
	const [lintStale, setLintStale] = createSignal<Record<string, boolean>>({});
	const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	const lintTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	const setSave = (key: string, v: string) => setSaveState({ ...saveState(), [key]: v });
	const savedAt = () => `saved ${new Date().toLocaleTimeString()}`;
	const complete = (t: CampaignTouch) => t.subject.trim() !== "" && t.body.trim() !== "";

	const touchesFor = (c: { id: string; templates: CampaignTouch[] }): CampaignTouch[] =>
		touchEdits()[c.id] ?? (c.templates.length > 0 ? [...c.templates] : [{ step: 1, subject: "", body: "" }]);

	const editMetaField = (id: string, patch: { name?: string; description?: string }) => {
		setMetaEdits({ ...metaEdits(), [id]: { ...metaEdits()[id], ...patch } });
		const key = `c:${id}`;
		clearTimeout(saveTimers[key]);
		setSave(key, "saving…");
		saveTimers[key] = setTimeout(async () => {
			const m = metaEdits()[id];
			if (!m) return;
			const src = campaigns()?.find((c) => c.id === id);
			const fd = new FormData();
			fd.set("id", id);
			fd.set("name", m.name ?? src?.name ?? "");
			fd.set("description", m.description ?? src?.description ?? "");
			const r = (await updateCampaign(fd)) as { error?: string; success?: string };
			setSave(key, r.error ?? savedAt());
		}, 900);
	};

	const saveTouches = (id: string, ts: CampaignTouch[]) => {
		setTouchEdits({ ...touchEdits(), [id]: ts });
		const key = `t:${id}`;
		clearTimeout(saveTimers[key]);
		// hold the flush while any touch is incomplete — a mid-retype blank
		// subject/body must not hit the server's structural validation
		if (ts.some((t) => !complete(t))) {
			setSave(key, "incomplete touch — not saved");
			return;
		}
		setSave(key, "saving…");
		saveTimers[key] = setTimeout(async () => {
			const cur = touchEdits()[id];
			if (!cur || cur.some((t) => !complete(t))) return;
			const fd = new FormData();
			fd.set("campaign_id", id);
			fd.set("touch_count", String(cur.length));
			cur.forEach((t, i) => {
				fd.set(`touch_${i}_step`, String(t.step));
				fd.set(`touch_${i}_subject`, t.subject);
				fd.set(`touch_${i}_body`, t.body);
			});
			const r = (await saveTemplates(fd)) as { error?: string; success?: string };
			setSave(key, r.error ?? savedAt());
		}, 900);
	};

	const lintTouch = (id: string, i: number, body: string) => {
		const key = `${id}:${i}`;
		setLintStale({ ...lintStale(), [key]: true });
		clearTimeout(lintTimers[key]);
		lintTimers[key] = setTimeout(async () => {
			const res = await fetch("/api/lint", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: body, surface: "email" }),
			});
			if (res.ok) {
				setTouchLint({ ...touchLint(), [key]: await res.json() });
				setLintStale({ ...lintStale(), [key]: false });
			}
		}, 700);
	};

	const editCompanyField = (id: string, patch: RowEdit) => {
		setRowEdits({ ...rowEdits(), [id]: { ...rowEdits()[id], ...patch } });
		const key = `r:${id}`;
		clearTimeout(saveTimers[key]);
		setSave(key, "saving…");
		saveTimers[key] = setTimeout(async () => {
			const cur = rowEdits()[id];
			if (!cur) return;
			// a half-typed step must not silently coerce to 1 server-side
			if (cur.sequenceStep !== undefined && !(Number.isInteger(Number(cur.sequenceStep)) && Number(cur.sequenceStep) >= 1)) {
				setSave(key, "incomplete step — not saved");
				return;
			}
			const src = campaigns()?.flatMap((c) => c.companies).find((x) => x.id === id);
			const fd = new FormData();
			fd.set("id", id);
			fd.set("contact_email", cur.contactEmail ?? src?.contactEmail ?? "");
			fd.set("sequence_step", cur.sequenceStep ?? String(src?.sequenceStep ?? 1));
			fd.set("next_send_at", cur.nextSendAt ?? toInputValue(src?.nextSendAt ?? null));
			fd.set("next_email_note", cur.nextEmailNote ?? src?.nextEmailNote ?? "");
			const r = (await updateCompany(withInstantIso(fd))) as { error?: string; success?: string };
			setSave(key, r.error ?? savedAt());
		}, 900);
	};

	const store: CampaignStore = {
		openMap,
		meta: metaEdits,
		rows: rowEdits,
		saveState,
		touchLint,
		lintStale,
		touches: touchesFor,
		toggleOpen: (id, open) => setOpenMap({ ...openMap(), [id]: open }),
		editMetaField,
		saveTouches,
		lintTouch,
		editCompanyField,
	};

	return (
		<Layout user={user()}>
			<Title>Campaigns — Mad Cactus</Title>
			<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", gap: "16px", "margin-bottom": "32px" }}>
				<div>
					<h1 class="page-title">Outreach Campaigns</h1>
					<p class="page-subtitle" style={{ "margin-bottom": "0" }}>
						Email sequences and their target lists — who's in each campaign, when the next email goes out, and what it should say.
						The board on Outreach tracks people; this tracks the campaign.
					</p>
				</div>
				<CreateDialog
					label="New campaign"
					title="New campaign"
					onSubmit={(fd) => createCampaign(fd) as Promise<{ error?: string; success?: string }>}
				>
					<div class="form-group">
						<label for="campaign_name">Campaign name *</label>
						<input type="text" id="campaign_name" name="name" required />
					</div>
					<div class="form-group">
						<label for="campaign_description">What this campaign is for</label>
						<input type="text" id="campaign_description" name="description" />
					</div>
				</CreateDialog>
			</div>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={campaigns()?.length} fallback={<p class="muted">No campaigns yet — create one above.</p>}>
					<For each={campaigns()}>{(c) => <Campaign campaign={c} store={store} />}</For>
				</Show>
			</Suspense>
		</Layout>
	);
}
