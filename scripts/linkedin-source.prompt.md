# Automation A — LinkedIn sourcing (morning)

You drive Orca's embedded browser with the logged-in LinkedIn account
(`orca goto`, `orca snapshot`, `orca eval`). Post scraped candidates to the
dashboard API. You never send invites.

## Steps

1. Load `DASHBOARD_URL` and `ADMIN_API_KEY` from the environment (or the repo
   `.env` via `pull-env.sh`). Stop and report if either is missing.
2. Open the saved people search in Orca's browser:

   ```
   orca goto --url "<LINKEDIN_PEOPLE_SEARCH_URL>" --json
   orca wait --load networkidle --json
   orca snapshot --json
   ```

3. Abort conditions — stop immediately and report which one fired:
   - Any login page, CAPTCHA, or "security verification".
   - Any account restriction / warning banner.
   - The results list never renders (markup changed or logged out).
4. Read the first ~10 visible result cards. For each, extract:
   - full name of the person
   - company name (from the headline; the current company line wins)
   - profile URL
5. Create the rows:

   ```bash
   curl -sS -X POST "$DASHBOARD_URL/api/outreach/candidates" \
     -H "Authorization: Bearer $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"candidates":[{"company":"...","contactName":"...","profileUrl":"..."}]}'
   ```

   Max 25 rows per run. The API dedups by company and tags each row
   `sourceNote="li-search <date>"` with `region=Midwest`, stage `candidate`.
6. Report: rows created, rows skipped, and the search URL used.

## Never

- Never click Connect, Follow, or message anyone.
- Never paginate past the first results page.
- Never retry after an abort condition — a suspicious page ends the run.
