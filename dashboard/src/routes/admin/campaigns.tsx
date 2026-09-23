import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";
import {
	getCampaignsQuery,
	createCampaignAction,
	deleteCampaignAction,
	addCampaignCompanyAction,
	updateCampaignCompanyAction,
	deleteCampaignCompanyAction,
} from "~/lib/admin-queries";
import { stageLabel, type CampaignCompany, type OutreachStage } from "~/db/schema";
import { fmtDate } from "~/lib/video-summary";

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

function CampaignRow(props: { company: CampaignCompany }) {
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
			<Show when={props.company.nextSendAt}>
				<span class="muted" style={{ "font-size": "12px" }}>
					next send: {fmtDate(props.company.nextSendAt)}
				</span>
			</Show>
			<Show when={error()}>
				<span class="login-error" style={{ "font-size": "12px" }}>{error()}</span>
			</Show>
		</div>
	);
}

function Campaign(props: { campaign: { id: string; name: string; description: string | null; companies: CampaignCompany[]; prospects: { id: string; company: string; stage: string }[] } }) {
	const addCampaignCompany = useAction(addCampaignCompanyAction);
	const removeCampaign = useAction(deleteCampaignAction);
	const [error, setError] = createSignal("");
	const [message, setMessage] = createSignal("");
	const c = () => props.campaign;
	return (
		<div class="card" style={{ padding: "20px", "margin-bottom": "16px" }}>
			<div style={{ display: "flex", "align-items": "baseline", gap: "10px" }}>
				<h2 style={{ margin: "0", "font-family": "var(--font-serif)", "font-weight": "400", "font-size": "20px" }}>{c().name}</h2>
				<span class="muted" style={{ "font-size": "12px" }}>
					{c().companies.length} target{c().companies.length === 1 ? "" : "s"} · {c().prospects.length} on board
				</span>
				<button
					type="button"
					class="btn btn-sm"
					style={{ "margin-left": "auto" }}
					onClick={async () => {
						if (!confirm(`Delete campaign "${c().name}"? Its target list goes with it; board prospects keep their stages.`)) return;
						const fd = new FormData();
						fd.set("id", c().id);
						await removeCampaign(fd);
					}}
				>
					Delete campaign
				</button>
			</div>
			<Show when={c().description}>
				<p class="muted" style={{ "font-size": "13px", "margin": "6px 0 0" }}>{c().description}</p>
			</Show>

			<div style={{ "margin-top": "12px" }}>
				<For each={c().companies}>
					{(company) => <CampaignRow company={company} />}
				</For>
				<Show when={!c().companies.length}>
					<p class="muted" style={{ "font-size": "13px" }}>No targets yet — add the first company below.</p>
				</Show>
			</div>

			<form
				onSubmit={async (e) => {
					e.preventDefault();
					setError("");
					setMessage("");
					const fd = new FormData(e.target as HTMLFormElement);
					fd.set("campaign_id", c().id);
					const r = (await addCampaignCompany(withInstantIso(fd))) as { error?: string; success?: string };
					if (r.error) setError(r.error);
					else {
						setMessage(r.success ?? "Added.");
						(e.target as HTMLFormElement).reset();
					}
				}}
				style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "margin-top": "14px", "align-items": "center" }}
			>
				<input type="text" name="company_name" placeholder="Company *" required />
				<input type="email" name="contact_email" placeholder="Contact email" style={{ width: "200px" }} spellcheck={false} />
				<input type="datetime-local" name="next_send_at" />
				<input type="text" name="next_email_note" placeholder="What the first/next email should say" style={{ flex: "1", "min-width": "180px" }} />
				<button type="submit" class="btn btn-primary btn-sm">Add company</button>
			</form>
			<Show when={error()}>
				<p class="login-error" style={{ "font-size": "12px" }}>{error()}</p>
			</Show>
			<Show when={message()}>
				<p class="muted" style={{ "font-size": "12px" }}>{message()}</p>
			</Show>

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
		</div>
	);
}

export default function AdminCampaigns() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const campaigns = createAsync(() => getCampaignsQuery(), { deferStream: true });
	const createCampaign = useAction(createCampaignAction);

	const [error, setError] = createSignal("");
	const [message, setMessage] = createSignal("");

	async function handleCreate(e: Event) {
		e.preventDefault();
		setError("");
		setMessage("");
		const res = (await createCampaign(new FormData(e.target as HTMLFormElement))) as { error?: string; success?: string };
		if (res.error) setError(res.error);
		else {
			setMessage(res.success ?? "Created.");
			(e.target as HTMLFormElement).reset();
		}
	}

	return (
		<Layout user={user()}>
			<Title>Campaigns — Mad Cactus</Title>
			<h1 class="page-title">Outreach Campaigns</h1>
			<p class="page-subtitle">
				Email sequences and their target lists — who's in each campaign, when the next email goes out, and what it should say.
				The board on Outreach tracks people; this tracks the campaign.
			</p>

			<details style={{ "margin-bottom": "24px" }}>
				<summary style={{ cursor: "pointer", "font-weight": "600" }}>New campaign</summary>
				<form onSubmit={handleCreate} style={{ display: "grid", gap: "8px", "max-width": "640px", "margin-top": "12px" }}>
					<input type="text" name="name" placeholder="Campaign name *" required />
					<input type="text" name="description" placeholder="What this campaign is for" />
					<button type="submit" class="btn btn-primary" style={{ "justify-self": "start" }}>Create</button>
				</form>
			</details>
			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>
			<Show when={message()}>
				<p class="muted">{message()}</p>
			</Show>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={campaigns()?.length} fallback={<p class="muted">No campaigns yet — create one above.</p>}>
					<For each={campaigns()}>{(c) => <Campaign campaign={c} />}</For>
				</Show>
			</Suspense>
		</Layout>
	);
}
