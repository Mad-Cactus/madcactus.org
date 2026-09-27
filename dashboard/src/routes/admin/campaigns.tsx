import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import CreateDialog from "~/components/CreateDialog";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";
import {
	getCampaignsQuery,
	createCampaignAction,
	deleteCampaignAction,
	addCampaignCompanyAction,
	updateCampaignCompanyAction,
	deleteCampaignCompanyAction,
	setCampaignTemplatesAction,
	type CampaignTemplatesResult,
} from "~/lib/admin-queries";
import { stageLabel, type CampaignCompany, type CampaignTouch, type OutreachStage } from "~/db/schema";
import type { CompanySendStats } from "~/lib/campaign-stats";
import { fillTemplate, templateSlots } from "~/lib/campaign-fill";
import { fmtDate } from "~/lib/video-summary";

/** getCampaignsQuery row: company + its Gmail-grounded send/reply state. */
type CampaignCompanyWithStats = CampaignCompany & { sendStats: CompanySendStats | null };

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
}) {
	const save = useAction(setCampaignTemplatesAction);
	const [touches, setTouches] = createSignal<CampaignTouch[]>(
		props.campaign.templates.length > 0 ? [...props.campaign.templates] : [{ step: 1, subject: "", body: "" }],
	);
	const [previewFor, setPreviewFor] = createSignal<number | null>(null);
	const [previewCompany, setPreviewCompany] = createSignal<string>("");
	const [error, setError] = createSignal("");
	const [violations, setViolations] = createSignal<{ step: number; message: string }[]>([]);
	const [message, setMessage] = createSignal("");

	const selectedCompany = () =>
		props.campaign.companies.find((c) => c.id === previewCompany()) ?? null;

	const setTouch = (i: number, patch: Partial<CampaignTouch>) =>
		setTouches((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

	async function handleSave(e: Event) {
		e.preventDefault();
		setError("");
		setViolations([]);
		setMessage("");
		const fd = new FormData(e.target as HTMLFormElement);
		const r = (await save(fd)) as CampaignTemplatesResult;
		if ("error" in r) {
			setError(r.error);
			setViolations(r.violations ?? []);
		} else setMessage(r.success);
	}

	return (
		<form onSubmit={handleSave} style={{ "margin-top": "16px" }}>
			<input type="hidden" name="campaign_id" value={props.campaign.id} />
			<input type="hidden" name="touch_count" value={touches().length} />
			<div style={{ display: "flex", "align-items": "baseline", gap: "10px" }}>
				<h3 style={{ margin: "0", "font-size": "14px", "font-weight": "600" }}>Templates — the frozen copy, on this campaign</h3>
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
						<input type="hidden" name={`touch_${i()}_step`} value={t.step} />
						<div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
							<span class="muted" style={{ "font-size": "12px", "min-width": "64px" }}>touch {t.step}</span>
							<input
								type="text"
								name={`touch_${i()}_subject`}
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
								<button
									type="button"
									class="btn btn-sm"
									onClick={() => setTouches((ts) => ts.filter((_, j) => j !== i()))}
								>
									✕
								</button>
							</Show>
						</div>
						<textarea
							name={`touch_${i()}_body`}
							placeholder={"Email body — {{slots}} for the per-company fill"}
							value={t.body}
							onInput={(e) => setTouch(i(), { body: e.currentTarget.value })}
							rows={t.body.split("\n").length + 2}
							style={{ width: "100%", "margin-top": "8px", "font-family": "var(--font-mono, monospace)", "font-size": "12px" }}
						/>
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
						<For each={violations().filter((v) => v.step === t.step)}>
							{(v) => (
								<div class="login-error" style={{ "font-size": "12px", "margin-top": "6px" }}>voice lint: {v.message}</div>
							)}
						</For>
					</div>
				)}
			</For>
			<div style={{ display: "flex", gap: "8px", "margin-top": "10px", "align-items": "center" }}>
				<button
					type="button"
					class="btn btn-sm"
					onClick={() => setTouches((ts) => [...ts, { step: ts.length + 1, subject: "", body: "" }])}
				>
					Add touch
				</button>
				<button type="submit" class="btn btn-primary btn-sm">Save templates</button>
				<span class="muted" style={{ "font-size": "12px" }}>Saved copy is voice-linted — violations reject the whole save.</span>
			</div>
			<Show when={error()}>
				<p class="login-error" style={{ "font-size": "12px", margin: "8px 0 0" }}>{error()}</p>
			</Show>
			<Show when={message()}>
				<p class="muted" style={{ "font-size": "12px", margin: "8px 0 0" }}>{message()}</p>
			</Show>
		</form>
	);
}

function CampaignRow(props: { company: CampaignCompanyWithStats }) {
	const update = useAction(updateCampaignCompanyAction);
	const remove = useAction(deleteCampaignCompanyAction);
	const [error, setError] = createSignal("");
	return (
		<div style={{ display: "grid", gap: "4px", padding: "10px 0", "border-bottom": "1px solid rgba(127, 127, 127, 0.15)" }}>
			<form
				onSubmit={async (e) => {
					e.preventDefault();
					setError("");
					const r = (await update(withInstantIso(new FormData(e.target as HTMLFormElement)))) as { error?: string };
					if (r.error) setError(r.error);
				}}
				style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "align-items": "center" }}
			>
				<input type="hidden" name="id" value={props.company.id} />
				<span style={{ "font-weight": "600", "min-width": "160px" }}>{props.company.companyName}</span>
				<input
					type="email"
					name="contact_email"
					placeholder="contact email"
					value={props.company.contactEmail ?? ""}
					style={{ width: "200px" }}
					spellcheck={false}
				/>
				<label class="muted" style={{ "font-size": "12px" }}>
					step <input type="number" name="sequence_step" min="1" value={props.company.sequenceStep} style={{ width: "52px" }} />
				</label>
				<input type="datetime-local" name="next_send_at" value={toInputValue(props.company.nextSendAt)} />
				<input
					type="text"
					name="next_email_note"
					placeholder="what the next email should say"
					value={props.company.nextEmailNote ?? ""}
					style={{ flex: "1", "min-width": "180px" }}
				/>
				<button type="submit" class="btn btn-sm">Save</button>
				<button
					type="button"
					class="btn btn-sm"
					onClick={async () => {
						const fd = new FormData();
						fd.set("id", props.company.id);
						await remove(fd);
					}}
				>
					✕
				</button>
			</form>
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
			<Show when={error()}>
				<span class="login-error" style={{ "font-size": "12px" }}>{error()}</span>
			</Show>
		</div>
	);
}

function Campaign(props: {
	campaign: {
		id: string;
		name: string;
		description: string | null;
		templates: CampaignTouch[];
		companies: CampaignCompanyWithStats[];
		prospects: { id: string; company: string; stage: string }[];
	};
}) {
	const addCampaignCompany = useAction(addCampaignCompanyAction);
	const removeCampaign = useAction(deleteCampaignAction);
	const c = () => props.campaign;
	return (
		<details class="card" style={{ padding: "20px", "margin-bottom": "16px" }} open>
			<summary style={{ cursor: "pointer", display: "flex", "align-items": "baseline", gap: "10px" }}>
				<h2 style={{ margin: "0", "font-family": "var(--font-serif)", "font-weight": "400", "font-size": "20px", display: "inline" }}>{c().name}</h2>
				<span class="muted" style={{ "font-size": "12px" }}>
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
			<Show when={c().description}>
				<p class="muted" style={{ "font-size": "13px", "margin": "6px 0 0" }}>{c().description}</p>
			</Show>

			<TemplatesPanel campaign={{ id: c().id, templates: c().templates, companies: c().companies }} />

			<div style={{ "margin-top": "16px" }}>
				<h3 style={{ margin: "0 0 4px", "font-size": "14px", "font-weight": "600" }}>Companies</h3>
				<For each={c().companies}>
					{(company) => <CampaignRow company={company} />}
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

	return (
		<Layout user={user()}>
			<Title>Campaigns — Mad Cactus</Title>
			<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "gap": "16px", "margin-bottom": "32px" }}>
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
					<For each={campaigns()}>{(c) => <Campaign campaign={c} />}</For>
				</Show>
			</Suspense>
		</Layout>
	);
}
