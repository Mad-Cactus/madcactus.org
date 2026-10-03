# Verify a stage via the open web (owner_led, revenue_band, industry_type)

Work a funnel stage queue with web search (Orca web agent). Verify ONE stage.

**Setup:** queue at `GET <BASE>/api/funnels/runs/<RUN_ID>/queue?stage=<STAGE>`
(auth: `Authorization: Bearer <FUNNEL_API_KEY>`).

**Per stage, the gate and where to look:**

- `owner_led` — founder/CEO still running it, not a PE roll-up. Look at the
  company site's About/Leadership page, LinkedIn, IBJ/press. Fail if: recently
  acquired by a PE roll-up, an interim CEO, or corporate IT is centralized.
- `revenue_band` — $10-70M with rev/employee sanity $150-500k. Look at IBJ
  Largest Private Companies, Inc. 5000, ZoomInfo/CompWorth/D&B free profiles.
  Record the estimate + source in `note`.
- `industry_type` — freight brokerage / 3PL / knowledge-heavy carrier. The
  company site + FMCSA authority type. Fail on: pure asset-light trucking with
  no brokerage ops is NOT auto-fail — judge knowledge-heavy per ICP.md.

**Verdict POST to `<BASE>/api/funnels/results`:**
`{"itemId": "...", "stage": "<STAGE>", "verdict": "pass"|"fail",
  "evidenceUrl": "<the page that settled it>", "note": "<what you found>",
  "method": "agent"}`

**Abort conditions (stop and report immediately):**
- CAPTCHA or aggressive bot wall on 2+ sites in a row
- Paywall blocks every revenue source (record nothing; report the gap)

A company with no findable evidence: skip it silently and list it in your
report. Absence of evidence is not a fail.
