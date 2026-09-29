#!/usr/bin/env bash
# Funnel smoke test — drives the full item lifecycle against a running dashboard.
#
#   FUNNEL_API_BASE=http://localhost:3000 FUNNEL_API_KEY=mc_... ./scripts/funnel-smoke.sh
#
# Steps: create run → import 3 fake IN freight rows (hq_state auto-pass) →
# queue at industry_type → pass → queue at headcount → fail one → it leaves
# later queues → drive one to all-pass → prospect promoted icp_approved=true →
# redo tech_team → fail → icp_approved now false.
set -euo pipefail
BASE="${FUNNEL_API_BASE:-http://localhost:3000}"
KEY="${FUNNEL_API_KEY:?FUNNEL_API_KEY (mc_…) required}"
AUTH="Authorization: Bearer $KEY"
CT="Content-Type: application/json"

say() { echo "== $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

funnel_id=$(curl -sf -H "$AUTH" "$BASE/api/funnels" | python3 -c 'import sys,json;print(json.load(sys.stdin)["funnels"][0]["id"])')
say "funnel $funnel_id"

run_id=$(curl -sf -X POST -H "$AUTH" -H "$CT" -d "{\"funnelId\":\"$funnel_id\",\"source\":\"paste\",\"note\":\"smoke $(date +%s)\"}" "$BASE/api/funnels" | python3 -c 'import sys,json;print(json.load(sys.stdin)["run"]["id"])')
say "run $run_id"

# import: 3 fake Indiana freight companies — hq_state auto-passes, one with industryType so industry_type auto-passes too
curl -sf -X POST -H "$AUTH" -H "$CT" "$BASE/api/funnels/runs/$run_id/items" -d '{"items":[
	{"companyName":"Smoke Brokerage LLC","city":"Indianapolis","state":"IN","rawData":{"industryType":"freight brokerage"}},
	{"companyName":"Smoke 3PL Inc","city":"Fishers","state":"IN"},
	{"companyName":"Smoke Carrier Co","city":"Muncie","state":"IN"}
]}' | python3 -m json.tool

q() { curl -sf -H "$AUTH" "$BASE/api/funnels/runs/$run_id/queue?stage=$1" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("\n".join(i["companyName"]+"\t"+i["id"] for i in d["items"]))'; }

say "queue industry_type (expect 3)"
[ "$(q industry_type | wc -l | tr -d ' ')" = "3" ] || fail "expected 3 in industry_type queue"

iid=$(q industry_type | grep 'Smoke Brokerage' | cut -f2)
curl -sf -X POST -H "$AUTH" -H "$CT" "$BASE/api/funnels/results" -d "{\"itemId\":\"$iid\",\"stage\":\"industry_type\",\"verdict\":\"pass\",\"note\":\"brokerage\",\"method\":\"human\"}" >/dev/null
say "queue headcount (expect Smoke Brokerage after its industry pass)"
q headcount | grep -q 'Smoke Brokerage' || fail "Smoke Brokerage missing from headcount queue"

# fail Smoke 3PL at industry_type → must leave all later queues
iid3=$(q industry_type | grep 'Smoke 3PL' | cut -f2)
curl -sf -X POST -H "$AUTH" -H "$CT" "$BASE/api/funnels/results" -d "{\"itemId\":\"$iid3\",\"stage\":\"industry_type\",\"verdict\":\"fail\",\"note\":\"not freight\"}" >/dev/null
q headcount | grep -q 'Smoke 3PL' && fail "failed item still in headcount queue" || echo "ok: failed item left later queues"

# drive Smoke Brokerage through the remaining stages → auto-promote
for stage in headcount revenue_band tech_team owner_led; do
	curl -sf -X POST -H "$AUTH" -H "$CT" "$BASE/api/funnels/results" -d "{\"itemId\":\"$iid\",\"stage\":\"$stage\",\"verdict\":\"pass\",\"note\":\"smoke\",\"method\":\"human\"}" >/dev/null
done
say "prospect row"
prospect_id=$(curl -sf -H "$AUTH" "$BASE/api/funnels/runs/$run_id" | python3 -c '
import sys,json
d=json.load(sys.stdin)
item=[i for i in d["items"] if i["companyName"]=="Smoke Brokerage LLC"][0]
assert item["prospectId"], "no prospectId after 6/6"
print(item["prospectId"])')
say "promoted prospect $prospect_id"

# redo tech_team → result gone, item back in tech_team queue, icp still true
trid=$(curl -sf -H "$AUTH" "$BASE/api/funnels/runs/$run_id" | python3 -c '
import sys,json
d=json.load(sys.stdin)
item=[i for i in d["items"] if i["companyName"]=="Smoke Brokerage LLC"][0]
r=[x for x in d["results"] if x["itemId"]==item["id"] and x["stage"]=="tech_team"][0]
print(r["id"])')
curl -sf -X POST -H "$AUTH" "$BASE/api/funnels/results/$trid/redo" >/dev/null
q tech_team | grep -q 'Smoke Brokerage' || fail "redo did not re-queue tech_team"

# fail tech_team → icp_approved flips false (read via DB — the flag lives on
# the prospect, not the run)
 curl -sf -X POST -H "$AUTH" -H "$CT" "$BASE/api/funnels/results" -d "{\"itemId\":\"$iid\",\"stage\":\"tech_team\",\"verdict\":\"fail\",\"note\":\"CTO found\"}" >/dev/null
if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null; then
	icp=$(psql "$DATABASE_URL" -tAc "select icp_approved from outreach_prospects where id='$prospect_id'")
	[ "$icp" = "f" ] || fail "expected icp_approved=false after fail, got $icp"
	echo "ok: icp_approved flipped to false"
else
	echo "NOTE: set DATABASE_URL + psql to auto-assert icp_approved=false; prospect id $prospect_id"
fi
say "smoke OK"
