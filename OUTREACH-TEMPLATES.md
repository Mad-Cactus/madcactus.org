# Outreach templates — moved to the dashboard

The frozen rung-1 templates now live in the Mad Cactus dashboard as a versioned
doc, editable in the UI:

**"Outreach templates — Rung-1 findings" — doc id `a63c4637-af63-4c9d-9ecf-8d72f0ff6db5`** (genre `template`)

The dispatcher reads it fresh with `get_doc` on every run. Every edit is
versioned and word-diffed (`madcactus_get_doc_diff`), and the voice engine
pairs agent writes with Collin's edits to learn — the same machinery the
newsletter and posts already use.

This file remains only as the seed record of what went into doc version 1
(commit history has the full original). Do not update it; update the doc.
