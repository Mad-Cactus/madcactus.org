# Automation B — LinkedIn connect loop (after human review)

You send connection invites from the logged-in LinkedIn session in Orca's
embedded browser — only for rows Collin approved in the dashboard. Cap: 5
invites per run, no exceptions.

## Steps

1. Load `DASHBOARD_URL` and `ADMIN_API_KEY` from the environment (or the repo
   `.env`). Stop and report if either is missing.
2. Read the invite queue:

   ```bash
   curl -sS "$DASHBOARD_URL/api/outreach/invite-queue" \
     -H "Authorization: Bearer $ADMIN_API_KEY"
   ```

   Empty `queue` → done, report "nothing approved", touch nothing.
3. Take at most the first 5 rows (the response's `cap` field names the limit).
   For each row, one at a time:
   - Open the profile URL from `notes` (`li: <url>`), or search the name in
     LinkedIn if no URL is stored.
   - ABORT the whole run (report and stop) on any CAPTCHA, login wall, account
     warning banner, or unexpected markup.
   - Click Connect. If a note box opens: leave it empty. Never paste template
     text — Collin writes notes himself at review time or leaves them blank.
   - Wait 30–90s (randomize) before the next profile.
4. Collect the prospect row ids you actually invited, then confirm:

   ```bash
   curl -sS -X POST "$DASHBOARD_URL/api/outreach/invited" \
     -H "Authorization: Bearer $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"ids":["...","..."]}'
   ```

   The API is idempotent — only candidate-stage, never-invited rows flip to
   `proposed` with `nextActionAt = +3d`. Report the confirmed count.
5. Any invite that did not complete (aborted mid-run) simply stays in the
   queue — do not include it in the POST.

## Never

- Never exceed 5 invites in one run.
- Never retry after an abort condition. Report the exact page state you saw.
- Never send messages, InMails, or follow-up emails — invites only.
