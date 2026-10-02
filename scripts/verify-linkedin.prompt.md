# Verify tech_team stage — LinkedIn people search

Work a funnel stage queue with the Orca browser. You verify ONE stage: `tech_team`.

**Setup:** the queue is at `GET <BASE>/api/funnels/runs/<RUN_ID>/queue?stage=tech_team`
(auth: `Authorization: Bearer <FUNNEL_API_KEY>`). It returns only items whose
earlier stages all passed and that have no tech_team result yet.

**For each item:**
1. Open `https://www.linkedin.com/company/<company>/people/` (or search the
   company in LinkedIn, People tab).
2. Search each title: `CTO`, `VP Engineering`, `IT Director`, `software engineer`,
   `developer`, `data engineer`.
3. Count total hits across the titles.

**Verdict:**
- 0–2 hits → `pass` (no real tech team)
- 3+ hits → `fail` (real tech team — gatekeeper risk)
- POST to `<BASE>/api/funnels/results`:
  `{"itemId": "...", "stage": "tech_team", "verdict": "pass"|"fail",
    "evidenceUrl": "<linkedin people URL>", "note": "3 tech-title hits",
    "method": "agent"}`

**Abort conditions (stop and report immediately):**
- LinkedIn login wall you cannot pass
- CAPTCHA or verification challenge
- "You've been restricted" / account-limitation banner
- Company page not found → record `fail`? NO — skip the company silently and
  note it in your report; a missing page is not evidence of a tech team.

Never retry a blocked page. One blocked page = stop the whole run and report.
