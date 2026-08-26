# Marketing Site

Astro static site for madcactus.org. Serves index, newsletter, scorecard, and IU case study pages.

## Development

```sh
bun install
bun dev        # localhost:4321
bun run build  # outputs to dist/
```

## Environment

Copy `.env.example` to `.env` and fill in:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PUBLIC_POSTHOG_KEY`
- `PUBLIC_POSTHOG_HOST`

## PostHog Tracking

Events tracked globally (via `PostHog.astro` click listener):

| Event | Trigger |
|-------|---------|
| `cta_scorecard` | Scorecard CTA clicks |
| `cta_calendar` | Any cal.com link |
| `cta_email` | Any mailto: link |
| `scorecard_navigate` | Click to /scorecard (includes `from` page) |
| `newsletter_navigate` | Click to /newsletter (includes `from` page) |
| `newsletter_signup` | Newsletter page form submit |
| `newsletter_signup_home` | Homepage newsletter band form submit |
| `scorecard_email_submit` | Scorecard email gate submit |
| `scorecard_complete` | Scorecard results shown (includes `score`) |
| `case_study_click` | IU case study card click |
| `newsletter_landed` | Newsletter page load (includes traffic source) |

### Tracking traffic sources

The newsletter page captures `newsletter_landed` on load with `source`, `referrer`, and UTM params. To attribute email clicks correctly, **add UTM params to every link you put in an email or social post**:

```
https://madcactus.org/newsletter?utm_source=newsletter&utm_medium=email&utm_campaign=issue-01
```

Copy-paste templates:

| Where you're posting | URL |
|----------------------|-----|
| Email / newsletter | `https://madcactus.org/newsletter?utm_source=newsletter&utm_medium=email&utm_campaign=issue-01` |
| LinkedIn | `https://madcactus.org/newsletter?utm_source=linkedin&utm_medium=social` |
| X / Twitter | `https://madcactus.org/newsletter?utm_source=twitter&utm_medium=social` |
| Scorecard from email | `https://madcactus.org/scorecard?utm_source=newsletter&utm_medium=email&utm_campaign=issue-01` |

Without UTMs, email and direct traffic are indistinguishable because email clients strip referrer headers.

## Images

Hero images live in `src/assets/` and use Astro's `<Image>` component for automatic WebP optimization and responsive sizing. Images in `public/` are served as-is (use for SVGs and icons only).
