# LinkedIn sourcing + connect automations (Orca browser loop)

Two Orca automations drive the logged-in LinkedIn session inside Orca's
embedded browser. A human fit review sits between them.

```
Automation A (daily ~07:30)          You (dashboard)           Automation B (after review)
scrape ~10 ICP candidates  ──────▶  review /admin/outreach, ──▶  read /invite-queue,
POST /api/outreach/candidates        toggle "Approve fit"       send ≤5 invites, abort on
                                     (icpApproved = yes)        CAPTCHA/login wall/banner,
                                                                POST /api/outreach/invited
```

## One-time setup

1. Set `DASHBOARD_URL` and `ADMIN_API_KEY` (an admin, memberless `mc_` key
   from /admin/api-keys) in the automation's environment or the repo `.env`.
2. Save the LinkedIn people-search URL (title: CEO/Founder/Owner, Midwest
   geo, target industries) in the automation prompt where marked.
3. Register the automations:

```bash
orca automations create --name "LinkedIn source" --trigger weekdays --time 07:30 \
  --repo id:<repoId> --provider claude --prompt "$(cat scripts/linkedin-source.prompt.md)"
orca automations create --name "LinkedIn connect" --trigger weekdays --time 11:00 \
  --repo id:<repoId> --provider claude --prompt "$(cat scripts/linkedin-connect.prompt.md)"
```

Schedule B comfortably after your usual review time. B only ever sees rows
you approved, and it caps itself at 5 invites per run.

## Safety rails (both automations)

- Hard abort on any CAPTCHA, login wall, "your account is restricted" banner,
  or an unexpected markup change — report the failure and stop. No retries
  against a suspicious page.
- B sends at most 5 invites per run (server response also names this `cap`).
- Randomized delays between invites (30–90s). No DM templates — notes are
  written by you at review time or left blank.
- Rows stay in `candidate` until the dashboard confirms receipt. A crashed
  run loses nothing.
