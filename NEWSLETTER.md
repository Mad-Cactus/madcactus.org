# The Cactus Dispatch — Operations

Weekly AI/automation teardown newsletter. Name: **The Cactus Dispatch**.

## One-time setup

### Resend (sending infra)

> **Status (2026-09-08): domain `madcactus.org` is verified in Resend** — SPF, DKIM, and DMARC records are live in Squarespace DNS. Sending is unblocked.

The signup endpoint (`dashboard/src/routes/api/newsletter.ts`) is already built and adds contacts to a Resend Audience. Provision:

1. **Create account** at resend.com
2. **Verify domain** `madcactus.org` — add the DNS records Resend gives you (SPF, DKIM, DMARC). Takes ~15 min to propagate.
3. **Create a Segment** — name it "Cactus Dispatch" (Segments replaced Audiences in Resend's UI). Copy the **Segment ID** and set it on Fly:
   ```sh
   flyctl secrets set RESEND_SEGMENT_ID=xxxxxx --app madcactus-dashboard
   ```
   Signups via `POST /api/newsletter` are added to this segment automatically (with a `source` property: `newsletter` or `scorecard`).
4. **Create API key** — scopes: `contacts.write`, `emails.send`
5. **Set the secret on Fly** (dashboard app):
   ```sh
   flyctl secrets set RESEND_API_KEY=re_xxxxxxx --app madcactus-dashboard
   ```
6. **Test the signup** — hit `https://madcactus.org/api/newsletter` with a real email, confirm it appears in the Resend Audience.

Until step 5 is done, the signup form returns `RESEND_API_KEY not configured` (500). That's expected.

### Signup form wiring

Two places capture emails, both POST to the same endpoint:

| Page | Route | Status |
|------|-------|--------|
| Newsletter landing | `/newsletter` | Hero signup form |
| Homepage newsletter band | `/` | Inline band signup |
| Scorecard results gate | `/scorecard` | "Get your detailed action plan" |

All call `POST https://madcactus.org/api/newsletter` with `{ email }`. The endpoint handles dedup (duplicate email → success). CORS is open (`*`).

### Email vs web: one doc, two channels

The web archive (`/newsletter/<id>`) and the Resend broadcast render the SAME
markdown through `markdownToHtml(md, channel)`. Channel differences live in
markers and code, not in duplicated docs:

- **Subject front-matter** — a leading `Subject: ...` line sets the email
  subject and never renders as body copy (the `Subject:` word at the top of
  issue 01's body was this bug).
- **`<!-- email-only -->` ... `<!-- /email-only -->`** — renders in the email,
  hidden on the web (e.g. "reply to this email" offers — replying makes no
  sense on a web page).
- **`<!-- web-only -->` ... `<!-- /web-only -->`** — the inverse.
- **Email footer** — the standard footer (boilerplate + reply prompt) is
  appended by code in `publish.ts` (`EMAIL_FOOTER_HTML`); keep it out of the
  doc. The web page shows its own scorecard CTA below the article instead.
- **Blockquote prompts** — in email mode blockquotes render as bordered boxes
  (Gmail collapses `<blockquote>` as trimmed quoted content, which hid issue
  01's copy-paste prompt). Web keeps real blockquotes.

### Welcome email

`POST /api/newsletter` (newsletter signups, not scorecard) immediately sends a
**plain-text** confirmation: "you just got added to The Cactus Dispatch." Plain
text on purpose — it lands in the primary inbox and warms up deliverability
before the first HTML issue arrives. Best-effort; signup never fails because
of it.

### Open tracking

Resend broadcasts track opens per contact (Resend dashboard → Broadcasts →
open rate, and per-contact activity). No code needed — check rates there after
each send. Treat as directional, not exact (Apple Mail privacy proxy inflates
opens).

### UTM tracking for links

Always add UTM params to links in emails and social posts. Without them, email clicks are indistinguishable from direct traffic (email clients strip referrer headers).

Copy-paste templates:

| Where | URL |
|------|-----|
| Email | `https://madcactus.org/newsletter?utm_source=newsletter&utm_medium=email&utm_campaign=issue-01` |
| LinkedIn | `https://madcactus.org/newsletter?utm_source=linkedin&utm_medium=social` |
| X / Twitter | `https://madcactus.org/newsletter?utm_source=twitter&utm_medium=social` |
| Scorecard from email | `https://madcactus.org/scorecard?utm_source=newsletter&utm_medium=email&utm_campaign=issue-01` |

---

## Teardown format (the template)

Every issue follows the same structure. Write in markdown, paste into Resend's editor or send via API.

### Subject line
`Teardown #[N]: [tension-driven hook with a number]`

Lead with the tension and a number. A CEO scrolling their inbox should feel the problem before they open.

### Body structure

**TL;DR** (1-2 sentences, immediately after subject)
The Hormozi "reward for opening." Value in 5 seconds: what was built, the result, and a link to the reusable asset (GitHub repo or prompt). Front-loaded so a reader who never scrolls still gets the value.

**Beat 1 — The tension** (2-3 sentences)
The business problem any CEO recognizes. Not the tech, the pain.

**Beat 2 — What we did** (3-5 sentences)
The story, generalized. "A company was struggling with X" — not the client name. What was built, at what altitude, what it proved. Name tools (coding agents, Supabase, Resend), never implementation minutiae.

**Beat 3 — The pattern** (2-3 sentences)
Why this matters for YOUR business. The insight abstracted into a reusable pattern. Pull the reader out of the client story so they see themselves in it. "If your sales team is doing [common problem], coding agents can build [tool] in [timeframe]."

**Beat 4 — What broke** (3-5 sentences)
General AI lessons, not client-specific bugs. "Coding agents hallucinate field names unless you give them a real example." The reader learns how to use AI better, not how you debugged a config. This is your differentiator beat — the verification honesty builds trust.

**Beat 5 — What happened** (2-3 sentences)
The outcome. The business result. How the needle moved.

**Beat 6 — The blueprint** (the actionable beat)
A copy-paste prompt the reader can hand to Claude/Codex/pi today. The lesson from Beat 4 must be baked into the prompt itself (not just described around it). Ship a link to a GitHub repo with full code and sample data.

**Beat 7 — The numbers**
- Build time, cost, what it replaced — abstracted from the client.
- Only real measurements. No invented numbers.

**P.S.** (every issue)
The second-most-read part of any email. Include:
- A reply trigger for deliverability + lead qualification: "Reply '[keyword]' and I'll send you [thing]."
- The scorecard link (only on issues 4+, after give-give-give ratio is met — see below).

---

### Rules

- **Generalize the specific.** The story is real, but the lesson must work for any reader. Anonymize clients. Abstract niches into patterns.
- **Receipts over rhetoric.** Every claim has a number or it gets cut.
- **Every issue ships a blueprint + GitHub link.** This is the value prop.
- **The audience is not technical.** Write for a CEO who uses Claude, not a developer who reads Hacker News.
- **Every issue has a P.S.** With a reply trigger for deliverability.
- **Sprinkle growth/business** when relevant, but AI/automation is the spine.

### Give:ask ratio

Minimum 3:1. Three pure-give issues, then one issue with an explicit ask (scorecard, audit, or direct offer). Track this. Most newsletters die because they either never ask (no revenue) or ask too early (audience churns).

Issue 1 is pure give. The P.S. reply trigger qualifies interest without a hard ask.

---

## Publishing workflow (weekly)

1. **Write** the teardown in the dashboard editor. The **Email preview** and
   **Web preview** tabs render the real thing: email = the exact HTML in an
   isolated frame (same bytes as the send), web = the actual marketing page
   components at `/admin/docs/issue-preview/<id>`.
2. **Send** — hit **Publish now** (goes out within 60s via the scheduler) or
   pick a time and **Schedule**.
3. **Fixing a published issue** — just edit the markdown and save. Human saves
   keep status=published and the site SSRs from the DB, so the web page updates
   instantly. This never re-sends the email. "View live page ↗" opens the
   public URL to confirm.
4. **Create the GitHub repo** — README + prompt + sample data. Stub is fine. The repo is its own lead magnet (people who star it self-identify as your audience).
5. **Cross-post** (same day):
   - **LinkedIn:** Take the tension hook as the first line. Compress "What we did" into 3 sentences. Post the prompt as a screenshot or carousel. Link to the full issue in the first comment. The "What broke" section is your highest-engagement beat for social.
   - **X / Twitter:** Thread version of the above.
5. **Archive** — add the issue to the `/newsletter` archive section.

### Cadence
Same day every week. Tuesday or Thursday mornings (US) convert best for B2B.

### Conversion funnel

```
Teardown (free, awareness)
    → Scorecard (free, qualified)
        → Audit (free, 1-to-1)
            → Consulting engagement (core offer)
```

The scorecard's "no email required to start" is intentional — commitment escalation works. The audit is where you prove value 1-to-1.
