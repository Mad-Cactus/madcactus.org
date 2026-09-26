# Rung-1 email templates — frozen copy, slots only

The dispatcher fills the `{{slots}}` and changes nothing else. Every slot that
holds a number must be verified from a live source the same morning. If a slot
cannot be filled with a verified fact, that send does not go out — it is logged
under FAILURES instead. No adjectives, no added sentences, no sign-offs beyond
what is written here.

Slots used across templates:
- `{{first_name}}` — the contact's first name
- `{{company}}` — company name
- `{{watch_sentence}}` — one clause naming the public data watched, e.g.
  "customs shipment records, carrier safety files, and diesel prices"
- `{{finding_1}}` / `{{finding_2}}` / `{{finding_3}}` — one line each: a count
  with a name attached, a change or trend, the money line
- `{{link}}` — the tracked /l/ slug for this company's teaser page
- `{{owner_role}}` — e.g. "Steve" or "your head of operations"

## Touch 1 — day 0  (rung1-touch1.md)

```
Hi {{first_name}},

My name is Collin. I built a research tool for {{company}}'s team and wanted
to send it over.

It watches {{watch_sentence}}.

This week:
- {{finding_1}}
- {{finding_2}}
- {{finding_3}}

Full list, updates Mondays: {{link}}

It's built for {{company}}. It updates itself and stays up either way. No
reply needed.

P.S. If you're not the right person for this, could you point me to
{{owner_role}}? It's a gift either way.

Thank you,
Collin Pfeifer
```

## Touch 2 — +5 days  (rung1-touch2.md)

```
Hi {{first_name}},

One update since last week: {{finding_1}}.

{{finding_2}} as well.

The list re-ranks itself weekly: {{link}}

Still no catch. It stays up either way.

Collin Pfeifer
```

## Touch 3 — +12 days, final  (rung1-touch3.md)

```
Hi {{first_name}},

Last note from me. {{finding_1}} — the full list is here if you want it:
{{link}}

I'll stop here. You'll get the monthly teardown (one email a month, no pitch)
unless you say stop — just reply "no" and I'll take you off.

Either way, the tool stays up.

Collin Pfeifer
```

## Teaser page body — the /t/ doc markdown

```
# {{company}} — this week's numbers

- {{finding_1}}
- {{finding_2}}
- {{finding_3}}

Updates every Monday.

Wired into your Slack, docs, and meetings, your team just asks — that's the
work I do.
```

## Loom script (rung 2)

Not templated per send — fill from the canonical script, dashboard doc
`676185a0-9585-4ccd-810f-e0c1b021f8a4` ("Loom script: Koola Logistics send"):
screen cues, findings block with verified numbers, Claude-connector demo, two
role questions, the no-close close.
