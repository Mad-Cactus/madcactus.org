-- Seed: writing lessons for agents (from hardikpandya/stop-slop, MIT).
-- Second corpus doc beside "Voice lessons" — agents read both before
-- drafting email or docs for Collin. Future voice lessons land as new
-- text_versions of these docs; humans edit, the history teaches.

INSERT INTO "docs" ("title", "markdown", "status")
SELECT
	'AI-slop rules',
	'# AI-slop rules

Patterns that mark text as machine-written. Never ship them in anything a client reads.

## Core rules

1. Cut throat-clearing. State the point first.
2. No formulaic structures ("not X, it''s Y", negative lists, dramatic fragments).
3. Active voice only. Name the human doing the thing.
4. Be specific. No vague declaratives ("the implications are significant").
5. Put the reader in the room. "You" beats "people". Specifics beat abstractions.
6. Vary rhythm. Mix sentence lengths. Two items beat three. No em-dashes.
7. Trust the reader. No softening, no hand-holding.
8. If it sounds like a pull-quote, rewrite it.

## Kill list: phrases

- Openers: "Here''s the thing:", "Here''s what/why X", "It turns out", "Let me be clear", "The truth is,", "I''ll be honest", "Can we talk about"
- Emphasis crutches: "Full stop.", "Let that sink in.", "This matters because", "Make no mistake"
- Adverbs and fillers: really, just, literally, genuinely, honestly, simply, actually, truly, fundamentally, importantly, crucially; "at its core", "at the end of the day", "it''s worth noting", "when it comes to", "in today''s X", "the reality is"
- Meta-commentary: "Plot twist:", "Spoiler:", "But that''s another post", "X is a feature, not a bug", "The rest of this essay...", "Let me walk you through...", "As we''ll see..."
- Vague declaratives: "The reasons are structural", "The stakes are high", "This is genuinely hard", "This is what X actually looks like"

## Kill list: structures

- Binary contrast: "Not because X. Because Y." / "The answer isn''t X, it''s Y" / "not just X but also Y". State Y directly.
- Negative listing: "Not a X... Not a Y... A Z." State Z.
- Dramatic fragmentation: "X. That''s it. That''s the tweet." / "X. And Y. And Z." Use complete sentences.
- Rhetorical setups: "What if [reframe]?", "Think about it:", "And that''s okay."
- False agency: complaints don''t "become" fixes, decisions don''t "emerge", data doesn''t "tell us", markets don''t "reward". Name the person who did it.
- Passive voice: "mistakes were made" → name who made them.
- Wh- openers (What/When/Where/Why/How starting sentences) and paragraphs starting with "So" or "Look,".
- Three-item lists: use two. Em-dashes: use commas or periods. Lazy extremes (every, always, never, nobody): use the specific.

## Plain-language swaps

| Avoid | Use |
|-------|-----|
| navigate (challenges) | handle, address |
| unpack | explain, examine |
| lean into | accept |
| landscape | situation, field |
| game-changer | important |
| double down | commit |
| deep dive | analysis |
| moving forward | next, from now |
| circle back | return to, revisit |
| on the same page | aligned, agreed |

## Before delivering, check

Adverbs? Passive voice? Inanimate actor? Throat-clearing opener? "Not X, it''s Y"? Three matching sentences? Punchy paragraph ending? Em-dash? Vague "significant/deep/structural" claim?
Each yes: fix it, then deliver.',
	'final'
WHERE NOT EXISTS (SELECT 1 FROM "docs" WHERE "title" = 'AI-slop rules');--> statement-breakpoint
INSERT INTO "text_versions" ("entity", "entity_id", "version", "author", "content")
SELECT 'doc', d."id", 1, 'agent', d."markdown"
FROM "docs" d
WHERE d."title" = 'AI-slop rules' AND NOT EXISTS (
	SELECT 1 FROM "text_versions" tv WHERE tv."entity" = 'doc' AND tv."entity_id" = d."id"
);--> statement-breakpoint
-- Point the brain's doc tools at it via description text already shipped in
-- brain-mcp.ts; nothing else to wire. Agents discover it through list_docs.
