# Mad Cactus ICP

**Who:** Owner-operated Indiana companies, $30-70M revenue, knowledge-heavy work, with no CTO and no full-time developers. The AI opportunity is real but nobody technical is in the building.

**Why this band:** Below $30M there's no budget and no pain. Above $70M most have at least a small dev team or an IT director who becomes the gatekeeper (and says no). $30-70M with owner-led decisions = the CEO *is* the buyer and feels the scatter personally.

## Hard filters (must pass all)

| Filter | Test | Fail → |
| --- | --- | --- |
| Indiana HQ | Address/city, not name tokens (Franklin, Anderson etc. exist nationwide) | drop |
| $30-70M revenue | IBJ/Inc/Buzzfile/ZoomInfo estimate; sanity-check rev/employee $150-500k | drop |
| Owner-operated | Founder/CEO still running it, not PE roll-up with shared corporate IT | drop |
| No real tech team | LinkedIn people search: ≤2 hits for CTO/VP Engineering/IT Director/"software engineer"/"developer" | drop |
| Knowledge-heavy | Their product is judgment, relationships, data-wrangling, compliance — not physical goods or software | deprioritize |

## Industries, ranked by brain-reuse

The three shipped brains are templates. A new target in the same industry = swap the data sources, keep the skeleton.

1. **Freight brokerage / 3PL / logistics** — koola-brain (Shipper Radar: public bills of lading + FMCSA vetting) copies almost verbatim to any IN freight broker or carrier.
2. **Mid-size law firms** — flora-brain (regulatory radar: USCIS trends, Visa Bulletin, court/policy data) re-points per practice area: immigration → family → personal injury → business litigation.
3. **Government affairs / public affairs / political consulting** — mo-strategies-brain (Congress + FEC + Federal Register watch) copies verbatim to any lobbying or public-affairs firm.
4. **Insurance brokerage** — benefits/Medicare/Medicare-adjacent regulatory watch + rate data (ESG Insurance profile).
5. **Staffing firms** — labor-market + compliance data (NCW profile).
6. **Specialty construction / manufacturing services** — permits, tariffs, materials-price data. Lower brain-reuse, still valid.

## Where to find the lists

Ranked by signal-per-hour. Everything below is free or cheap unless noted.

**Cross-industry, already paying off (keep using):**
- IBJ Data Center / Book of Lists (ibj.com/lists) — Largest Private Companies, Fast 25, Largest Law Firms, Largest Accounting Firms, Corporate 100. Paid but the single best IN filter; free snippets + annual features cover most.
- Inc. 5000 (filter: Indiana) — revenue + 3-yr growth, free.
- TechPoint Mira Awards, IBJ Forty Under 40 — owner-led success signals.

**Freight/logistics:**
- FMCSA company census (keyless) — carrier counts, authority status, fleet size per company.
- ImportYeti — public bills of lading; search `q="indiana"` gives 100% IN-precision consignees (filter countryCode US, match address not name). Same data source as koola-brain's radar.
- FreightWaves Ratings by state, Transport Topics top-100 segments.

**Legal:**
- IBJ Largest Indianapolis-Area Law Firms (annual PDF).
- Best Lawyers / Best Law Firms rankings, Indiana Lawyer publication.
- Court data itself: firms appearing repeatedly in high-value commercial dockets = successful + scattered.

**Government affairs / consulting:**
- Indiana lobbyist registry (free, state-published) — every firm registered to lobby in IN.
- IBJ "Lobbyists" topic coverage; The Manifest / Clutch Indianapolis public-affairs directories.

**Revenue/headcount fill-in for private companies (the $30-70M check):**
- Buzzfile (free tier: state + industry + employee-range filters — best bulk pre-filter).
- ZoomInfo / Mergr / CompWorth free profile pages for spot estimates.
- D&B free business profiles as tiebreaker.

## 5-minute tech-gap verification (per company)

1. LinkedIn company page → People tab → search titles: `CTO`, `VP Engineering`, `IT Director`, `software engineer`, `developer`, `data engineer`. **0-2 hits = qualify.** A real tech org has 5+ per 100 employees.
2. Check total headcount. 50-250 employees + $30-70M = right size.
3. Careers page / Indeed: no engineering postings = confirmed. **Postings saying "hiring first developer" = strongest possible timing signal.**
4. Website: no product/engineering pages, template vendor sites, no GitHub org.
5. Any dev-adjacent person found → check seniority. One sysadmin doing IT support ≠ a tech team.

Score 5 min/company by hand; batch 20 in an hour. Automatable later via Clay/Apollo title-headcount filters — don't build until manual volume demands it.

## Scorecard (0-3 each, work anything ≥10)

| Signal | 3 | 0 |
| --- | --- | --- |
| Industry brain-reuse | Same as shipped brain | New skeleton needed |
| Visible success | Fast 25 / Inc 5000 / awards | Unknown |
| Visible scatter | Public chaos signals (growth, hiring, ops mess) | None visible |
| Owner access | Founder/CEO reachable, no gatekeepers | Layered exec team |
| Timing | Hiring first dev / just lost a system / compliance crunch | Nothing pressing |

## Weekly loop (feeds ASPTR-212)

1. Pull one list (rotate freight → legal → gov affairs → insurance).
2. Hard-filter to Indiana + $30-70M + owner-led (Buzzfile/Inc/IBJ).
3. 5-min tech-gap verification on survivors.
4. Score, take top 5.
5. Build brains on public data, Loom, send. Gift = the setup; business = everything after.
