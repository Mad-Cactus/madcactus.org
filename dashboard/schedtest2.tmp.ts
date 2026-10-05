// enable a schedule for the Freight funnel with FMCSA discovery (interval 7d), run once, then DISABLE it
// so nothing autonomous fires until Collin opts in from the UI.
import { eq } from "drizzle-orm";
import { db } from "./src/db";
import { funnelSchedules, funnels } from "./src/db/schema";
import { runScheduledFunnels } from "./src/lib/funnel-scheduler";
const [f] = await db.select().from(funnels).where(eq(funnels.name, "Freight ICP")).limit(1);
await db.insert(funnelSchedules).values({ funnelId: f.id, enabled: true, discoverySource: "fmcsa" }).onConflictDoUpdate({ target: funnelSchedules.funnelId, set: { enabled: true, discoverySource: "fmcsa" } });
const r = await runScheduledFunnels();
console.log("run (enabled, discovery+enrich):", JSON.stringify(r));
await db.update(funnelSchedules).set({ enabled: false }).where(eq(funnelSchedules.funnelId, f.id));
console.log("schedule disabled again — opt in from the Schedule tab");
